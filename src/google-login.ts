import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Config } from "./config.js";

// Inloggen met Google voor het dashboard (OAuth 2.0 met PKCE). Wie in DASHBOARD_EMAILS staat, krijgt een
// ondertekend sessiecookie. Er is geen database: het cookie bevat het e-mailadres en de vervaldatum, ondertekend
// met een sleutel afgeleid van GOOGLE_CLIENT_SECRET. Een ander secret maakt dus alle sessies ongeldig.

export const CALLBACK_PATH = "/dashboard/auth/callback";
const SESSION_COOKIE = "checkup_sessie";
const LOGIN_COOKIE = "checkup_login";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_SECONDS = 10 * 60;
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export function emailAllowed(email: string, allowed: string[]): boolean {
  const e = email.trim().toLowerCase();
  return allowed.some((entry) => (entry.includes("@") ? entry === e : e.endsWith(`@${entry}`)));
}

function signingKey(config: Config): Buffer {
  return createHash("sha256").update(`skrol-checkup-sessie|${config.googleClientSecret}`).digest();
}

function sign(payload: object, config: Config): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", signingKey(config)).update(body).digest("base64url")}`;
}

function unsign<T extends { x: number }>(token: string | undefined, config: Config): T | null {
  const [body, mac, rest] = (token ?? "").split(".");
  if (!body || !mac || rest !== undefined) return null;
  const expected = createHmac("sha256", signingKey(config)).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return typeof payload.x === "number" && payload.x * 1000 > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/dashboard; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/**
 * E-mailadres van wie ingelogd is, of null. Wie intussen uit DASHBOARD_EMAILS gehaald is, is meteen niet
 * meer ingelogd, ook met een geldig cookie.
 */
export function sessionEmail(req: IncomingMessage, config: Config): string | null {
  const session = unsign<{ e: string; x: number }>(readCookie(req, SESSION_COOKIE), config);
  if (!session || typeof session.e !== "string") return null;
  return emailAllowed(session.e, config.dashboardEmails) ? session.e : null;
}

/** Enkel terug naar een pagina van het dashboard: geen open redirect naar een andere site. */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/dashboard(?:[/?][^\s\\]*)?$/.test(next) && !next.startsWith("/dashboard/login") ? next : "/dashboard";
}

/** Begin van de login: naar Google, met een state en een PKCE-sleutel in een kort cookie. */
export function startLogin(config: Config, baseUrl: string, next: string): { location: string; setCookie: string } {
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${baseUrl}${CALLBACK_PATH}`,
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  const payload = { s: state, v: verifier, n: safeNext(next), x: Math.floor(Date.now() / 1000) + LOGIN_SECONDS };
  return {
    location: `${config.googleAuthUrl}?${params}`,
    setCookie: cookie(LOGIN_COOKIE, sign(payload, config), LOGIN_SECONDS, baseUrl.startsWith("https://")),
  };
}

export type LoginResult =
  | { ok: true; email: string; next: string; setCookies: string[] }
  | { ok: false; status: number; error: string; setCookies: string[] };

/** Terug van Google: de code inwisselen, het e-mailadres nakijken en een sessie geven. */
export async function finishLogin(req: IncomingMessage, url: URL, config: Config, baseUrl: string): Promise<LoginResult> {
  const secure = baseUrl.startsWith("https://");
  const clear = [cookie(LOGIN_COOKIE, "", 0, secure)];
  const fail = (status: number, error: string): LoginResult => ({ ok: false, status, error, setCookies: clear });

  const login = unsign<{ s: string; v: string; n: string; x: number }>(readCookie(req, LOGIN_COOKIE), config);
  if (!login || url.searchParams.get("state") !== login.s) return fail(400, "De login is verlopen of ongeldig. Probeer opnieuw.");
  if (url.searchParams.get("error")) return fail(400, "Inloggen bij Google is afgebroken.");
  const code = url.searchParams.get("code");
  if (!code) return fail(400, "Google gaf geen code terug. Probeer opnieuw.");

  let idToken: string | undefined;
  try {
    const res = await fetch(config.googleTokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: `${baseUrl}${CALLBACK_PATH}`,
        grant_type: "authorization_code",
        code_verifier: login.v,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!res.ok || !body.id_token) return fail(502, `Google weigerde de login${body.error ? ` (${body.error})` : ""}. Probeer opnieuw.`);
    idToken = body.id_token;
  } catch {
    return fail(502, "Google antwoordde niet. Probeer opnieuw.");
  }

  // Het ID-token komt rechtstreeks van Google over HTTPS, dus de handtekening hoeft niet nagekeken te worden;
  // de inhoud wel (https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo).
  let claims: { aud?: string; iss?: string; exp?: number; email?: string; email_verified?: boolean | string };
  try {
    claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return fail(502, "Google gaf een ongeldig antwoord. Probeer opnieuw.");
  }
  if (claims.aud !== config.googleClientId || !ISSUERS.includes(claims.iss ?? "") || !claims.exp || claims.exp * 1000 < Date.now()) {
    return fail(502, "Google gaf een ongeldig antwoord. Probeer opnieuw.");
  }
  const email = claims.email?.toLowerCase();
  if (!email || (claims.email_verified !== true && claims.email_verified !== "true")) {
    return fail(403, "Dit Google-account heeft geen bevestigd e-mailadres.");
  }
  if (!emailAllowed(email, config.dashboardEmails)) {
    return fail(403, `${email} heeft geen toegang tot het dashboard. Vraag het aan wie de check-uptool beheert.`);
  }
  const session = sign({ e: email, x: Math.floor(Date.now() / 1000) + SESSION_SECONDS }, config);
  return { ok: true, email, next: login.n, setCookies: [...clear, cookie(SESSION_COOKIE, session, SESSION_SECONDS, secure)] };
}

export function logoutCookie(baseUrl: string): string {
  return cookie(SESSION_COOKIE, "", 0, baseUrl.startsWith("https://"));
}
