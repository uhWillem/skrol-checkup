import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { googleLoginEnabled, type Config } from "./config.js";
import { finishLogin, logoutCookie, passwordSessionCookie, safeNext, sessionUser, startLogin } from "./google-login.js";
import type { JobStore } from "./jobs.js";
import { findingsCsv, renderPdf, reportFileName, reportHtml } from "./report.js";
import type { Job } from "./types.js";

// Dashboard op /dashboard: lopende en vorige check-ups bekijken, annuleren en het rapport downloaden.
// Beveiligd met een Google-login (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en DASHBOARD_EMAILS), of anders met
// HTTP Basic Auth: de browser vraagt het wachtwoord uit DASHBOARD_PASSWORD (de gebruikersnaam maakt niet uit).

export const DASHBOARD_PATH = "/dashboard";
const JOB_ID = /^job_\d{8}_[0-9a-f]{8}$/;

/** Na zoveel foute wachtwoorden binnen het venster krijgt een adres even geen toegang meer. */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; until: number }>();

/** PDF's één voor één maken: elk rapport start een Chromium, en de VPS draait ook de check-ups. */
let pdfQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = pdfQueue.then(task, task);
  pdfQueue = run.catch(() => undefined);
  return run;
}

function clientIp(req: IncomingMessage): string {
  // Achter de proxy van Coolify: het laatste adres in x-forwarded-for is wat de proxy zelf zag.
  const forwarded = req.headers["x-forwarded-for"];
  const list = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.at(-1) ?? req.socket.remoteAddress ?? "onbekend";
}

function blocked(ip: string): boolean {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const entry = failures.get(ip);
  if (!entry || Date.now() > entry.until) failures.set(ip, { count: 1, until: Date.now() + FAILURE_WINDOW_MS });
  else entry.count++;
}

/** Vergelijkt via een hash, zodat ook de lengte van het wachtwoord niet uitlekt. */
function samePassword(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function passwordFrom(req: IncomingMessage): string | null {
  const match = (req.headers.authorization ?? "").match(/^Basic\s+([A-Za-z0-9+/=]+)\s*$/i);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon === -1 ? null : decoded.slice(colon + 1);
}

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function redirect(res: ServerResponse, location: string, setCookies: string[] = []): void {
  res.writeHead(302, { ...BASE_HEADERS, location, ...(setCookies.length ? { "set-cookie": setCookies } : {}) });
  res.end();
}

/** Leest een klein formulier (application/x-www-form-urlencoded). */
function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error("formulier te groot"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(new URLSearchParams(body)));
    req.on("error", reject);
  });
}

function sendHtml(res: ServerResponse, status: number, html: (nonce: string) => string, setCookies: string[] = []): void {
  const nonce = randomBytes(16).toString("base64");
  res.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    ...(setCookies.length ? { "set-cookie": setCookies } : {}),
  });
  res.end(html(nonce));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Wat het dashboard van een job nodig heeft; de volledige samenvatting blijft op de server. */
function view(job: Job) {
  return {
    id: job.id,
    url: job.url,
    liveDomain: job.liveDomain,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    error: job.error,
    summary: job.summary
      ? { pages: job.summary.pages, pagesWithErrors: job.summary.pagesWithErrors, findings: job.summary.findings, byHint: job.summary.byHint }
      : undefined,
  };
}

export async function handleDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  store: JobStore,
  config: Config,
  /** Publiek adres van de server, voor de terugkeer-URL van Google. */
  baseUrl: string,
): Promise<void> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  let user: string | undefined;

  if (googleLoginEnabled(config)) {
    const withPassword = !!config.dashboardPassword;
    let signedIn = sessionUser(req, config);
    // Het reservewachtwoord werkt ook als Basic Auth, bv. voor scripts (curl -u x:wachtwoord).
    const given = withPassword ? passwordFrom(req) : null;
    if (!signedIn && given !== null) {
      const ip = clientIp(req);
      if (blocked(ip)) return sendJson(res, 429, { error: "Te veel foute wachtwoorden. Probeer het over een kwartier opnieuw." });
      if (samePassword(given, config.dashboardPassword)) signedIn = { password: true };
      else recordFailure(ip);
    }
    if (path === `${DASHBOARD_PATH}/login` && method === "GET") {
      const next = safeNext(url.searchParams.get("next"));
      if (signedIn) return redirect(res, next);
      const notice = url.searchParams.has("uit") ? "Je bent uitgelogd." : undefined;
      const error = config.dashboardEmails.length === 0 && !withPassword ? "Er mag nog niemand inloggen: DASHBOARD_EMAILS is leeg." : undefined;
      return sendHtml(res, 200, (nonce) => loginPage(nonce, next, { notice, error, withPassword }));
    }
    if (path === `${DASHBOARD_PATH}/login/wachtwoord` && method === "POST") {
      if (!withPassword) return sendJson(res, 404, { error: "niet gevonden" });
      const ip = clientIp(req);
      const form = await readForm(req).catch(() => new URLSearchParams());
      const next = safeNext(form.get("next"));
      if (blocked(ip)) {
        return sendHtml(res, 429, (nonce) => loginPage(nonce, next, { error: "Te veel foute wachtwoorden. Probeer het over een kwartier opnieuw.", withPassword, open: true }));
      }
      if (!samePassword(form.get("wachtwoord") ?? "", config.dashboardPassword)) {
        recordFailure(ip);
        return sendHtml(res, 401, (nonce) => loginPage(nonce, next, { error: "Dat wachtwoord klopt niet.", withPassword, open: true }));
      }
      return redirect(res, next, [passwordSessionCookie(config, baseUrl)]);
    }
    if (path === `${DASHBOARD_PATH}/login/google` && method === "GET") {
      const { location, setCookie } = startLogin(config, baseUrl, safeNext(url.searchParams.get("next")));
      return redirect(res, location, [setCookie]);
    }
    if (path === `${DASHBOARD_PATH}/auth/callback` && method === "GET") {
      const result = await finishLogin(req, url, config, baseUrl);
      if (!result.ok) return sendHtml(res, result.status, (nonce) => loginPage(nonce, "/dashboard", { error: result.error, withPassword }), result.setCookies);
      return redirect(res, result.next, result.setCookies);
    }
    if (path === `${DASHBOARD_PATH}/logout` && method === "GET") {
      return redirect(res, `${DASHBOARD_PATH}/login?uit=1`, [logoutCookie(baseUrl)]);
    }
    if (!signedIn) {
      if (path.startsWith(`${DASHBOARD_PATH}/api/`)) return sendJson(res, 401, { error: "Niet ingelogd." });
      return redirect(res, `${DASHBOARD_PATH}/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    }
    user = "email" in signedIn ? signedIn.email : "Ingelogd met het wachtwoord";
  } else if (config.dashboardPassword) {
    const ip = clientIp(req);
    if (blocked(ip)) {
      res.writeHead(429, { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8", "retry-after": "900" });
      return void res.end("Te veel foute wachtwoorden. Probeer het over een kwartier opnieuw.");
    }
    const given = passwordFrom(req);
    if (given === null || !samePassword(given, config.dashboardPassword)) {
      // De eerste aanvraag van een browser komt altijd zonder wachtwoord; die telt niet als poging.
      if (given !== null) recordFailure(ip);
      res.writeHead(401, {
        ...BASE_HEADERS,
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": 'Basic realm="Skrol check-up", charset="UTF-8"',
      });
      return void res.end("Wachtwoord vereist.");
    }
  } else return sendJson(res, 404, { error: "niet gevonden" });

  if (path === DASHBOARD_PATH && (method === "GET" || method === "HEAD")) {
    return sendHtml(res, 200, (nonce) => (method === "HEAD" ? "" : dashboardPage(nonce, user)));
  }

  if (path === `${DASHBOARD_PATH}/api/jobs` && method === "GET") {
    return sendJson(res, 200, { jobs: store.list().map(view) });
  }

  const cancel = path.match(/^\/dashboard\/api\/jobs\/([^/]+)\/cancel$/);
  if (cancel && method === "POST") {
    // Een eigen header kan een andere site niet meesturen zonder toestemming (CORS): zo kan een link of
    // formulier elders geen check-up annuleren met het wachtwoord dat de browser onthouden heeft.
    if (req.headers["x-dashboard"] !== "1") return sendJson(res, 403, { error: "verzoek niet vanuit het dashboard" });
    const id = cancel[1];
    const job = JOB_ID.test(id) ? store.get(id) : undefined;
    if (!job) return sendJson(res, 404, { error: "Onbekende check-up." });
    if (!(await store.cancel(id))) return sendJson(res, 409, { error: "Deze check-up is al afgelopen.", job: view(job) });
    return sendJson(res, 200, { job: view(job) });
  }

  const download = path.match(/^\/dashboard\/jobs\/([^/]+)\/(rapport\.pdf|bevindingen\.csv)$/);
  if (download && (method === "GET" || method === "HEAD")) {
    const id = download[1];
    const job = JOB_ID.test(id) ? store.get(id) : undefined;
    if (!job) return sendJson(res, 404, { error: "Onbekende check-up." });
    const result = job.status === "done" ? await store.result(id) : undefined;
    if (!result) return sendJson(res, 409, { error: "Enkel een afgeronde check-up heeft een rapport." });
    const pdf = download[2] === "rapport.pdf";
    let body: Buffer;
    try {
      body = pdf
        ? await oneAtATime(() => renderPdf(reportHtml(job, result), `Check-up ${new URL(result.startUrl).hostname}`, config))
        : Buffer.from(findingsCsv(result), "utf8");
    } catch (error) {
      return sendJson(res, 500, { error: `Rapport maken mislukt: ${(error as Error).message.split("\n")[0]}` });
    }
    res.writeHead(200, {
      ...BASE_HEADERS,
      "content-type": pdf ? "application/pdf" : "text/csv; charset=utf-8",
      "content-length": body.length,
      "content-disposition": `attachment; filename="${reportFileName(job, pdf ? "pdf" : "csv")}"`,
    });
    return void res.end(method === "HEAD" ? undefined : body);
  }

  return sendJson(res, 404, { error: "niet gevonden" });
}

function loginPage(nonce: string, next: string, message: { notice?: string; error?: string; withPassword?: boolean; open?: boolean }): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Inloggen | Skrol check-ups</title>
<link rel="icon" href="data:,">
<style nonce="${nonce}">
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #1d2126; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
  main { max-width: 520px; margin: 0 auto; padding: 18vh 24px 64px; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.015em; }
  p { color: #646b75; margin: 0 0 28px; }
  .message { color: #1d2126; background: #f5f6f8; padding: 10px 14px; border-radius: 6px; }
  .message.bad { color: #b4372c; background: #fbeceb; }
  a.google { display: inline-flex; align-items: center; gap: 10px; padding: 10px 18px; border-radius: 6px; border: 1px solid #cfd3d9; color: #1d2126; text-decoration: none; font-weight: 500; }
  a.google:hover { border-color: #9da3ab; }
  a.google svg { width: 18px; height: 18px; }
  details { margin-top: 36px; }
  summary { cursor: pointer; color: #646b75; font-size: 14px; }
  summary:hover { color: #1d2126; }
  form { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  label { flex-basis: 100%; font-size: 14px; color: #646b75; }
  input[type="password"] { font: inherit; font-size: 15px; padding: 8px 10px; border: 1px solid #cfd3d9; border-radius: 6px; flex: 1; min-width: 200px; }
  button { font: inherit; font-size: 15px; padding: 8px 16px; border-radius: 6px; border: 1px solid #1d2126; background: #1d2126; color: #fff; cursor: pointer; }
  :focus-visible { outline: 2px solid #2f62d6; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1>Check-ups</h1>
  <p>Log in met je Google-account om de check-ups van de Skrol-browsertool te volgen, te stoppen en het rapport te downloaden.</p>
  ${message.error ? `<p class="message bad" role="alert">${esc(message.error)}</p>` : ""}
  ${message.notice ? `<p class="message" role="status">${esc(message.notice)}</p>` : ""}
  <a class="google" href="/dashboard/login/google?next=${esc(encodeURIComponent(next))}">
    <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>
    Inloggen met Google
  </a>
  ${
    message.withPassword
      ? `<details${message.open ? " open" : ""}>
    <summary>Inloggen met het reservewachtwoord</summary>
    <form method="post" action="/dashboard/login/wachtwoord">
      <input type="hidden" name="next" value="${esc(next)}">
      <label for="wachtwoord">Wachtwoord (DASHBOARD_PASSWORD in Coolify)</label>
      <input type="password" id="wachtwoord" name="wachtwoord" autocomplete="current-password" required${message.open ? " autofocus" : ""}>
      <button type="submit">Inloggen</button>
    </form>
  </details>`
      : ""
  }
</main>
</body>
</html>`;
}

function dashboardPage(nonce: string, user?: string): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Skrol check-ups</title>
<link rel="icon" href="data:,">
<style nonce="${nonce}">
  :root {
    --ink: #1d2126; --muted: #646b75; --line: #e3e5e8; --soft: #f5f6f8;
    --run: #2f62d6; --run-soft: #eef3fd; --bad: #b4372c;
    --hoog: #d93b30; --midden: #f08c00; --laag: #e3bd2d;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
  main { max-width: 1160px; margin: 0 auto; padding: 40px 24px 72px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px 24px; flex-wrap: wrap; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0; letter-spacing: -0.015em; }
  .intro { color: var(--muted); margin: 6px 0 36px; max-width: 68ch; }
  .updated { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .updated .user { margin-left: 14px; color: var(--ink); }
  .updated a { margin-left: 10px; }
  h2 { font-size: 18px; margin: 0; }
  h2 .count { color: var(--muted); font-weight: 400; }
  section { margin-bottom: 44px; }
  .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  a { color: var(--run); }
  .notice { margin: -20px 0 28px; padding: 10px 14px; border-radius: 6px; background: var(--soft); }
  .notice.bad { background: #fbeceb; color: var(--bad); }
  .notice:empty { display: none; }

  .active { list-style: none; margin: 0; padding: 0; }
  .active li { display: flex; align-items: center; gap: 20px; padding: 16px 18px; border-radius: 8px; background: var(--soft); }
  .active li + li { margin-top: 8px; }
  .active li.running { background: var(--run-soft); }
  .active .main { flex: 1; min-width: 0; }
  .active .line { color: var(--muted); font-size: 14px; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .bar { height: 5px; margin-top: 10px; border-radius: 3px; background: #d9e2f6; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--run); transition: width 0.6s ease; }
  .none { color: var(--muted); margin: 0; }

  .site { color: var(--ink); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
  .site:hover { text-decoration: underline; }
  .small { color: var(--muted); font-size: 13px; }

  button { font: inherit; font-size: 14px; padding: 7px 14px; border-radius: 6px; border: 1px solid #cfd3d9; background: #fff; color: var(--ink); cursor: pointer; white-space: nowrap; }
  button:hover { border-color: #9da3ab; }
  button.armed { background: var(--bad); border-color: var(--bad); color: #fff; }
  button:disabled { opacity: 0.6; cursor: default; }
  :focus-visible { outline: 2px solid var(--run); outline-offset: 2px; }

  input[type="search"] { font: inherit; font-size: 14px; padding: 7px 10px; width: 240px; max-width: 100%; border: 1px solid #cfd3d9; border-radius: 6px; }

  .table-wrap { overflow-x: auto; }
  table { width: 100%; min-width: 860px; border-collapse: collapse; }
  th { text-align: left; font-size: 13px; font-weight: 600; color: var(--muted); padding: 8px 12px; border-bottom: 1px solid var(--ink); white-space: nowrap; }
  td { padding: 12px; border-bottom: 1px solid var(--line); vertical-align: top; font-variant-numeric: tabular-nums; }
  th:first-child, td:first-child { padding-left: 0; }
  .num { text-align: right; }
  .when { white-space: nowrap; }

  .dots { display: flex; gap: 14px; white-space: nowrap; }
  .dots span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: -0.5px; }
  .dots .hoog::before { background: var(--hoog); }
  .dots .midden::before { background: var(--midden); }
  .dots .laag::before { background: var(--laag); }
  .dots .zero { color: #a3a8af; }

  .status { display: inline-block; font-size: 13px; padding: 1px 9px; border-radius: 999px; white-space: nowrap; background: var(--soft); }
  .status.done { background: #e5f3eb; color: #1a6a43; }
  .status.failed { background: #fbeceb; color: var(--bad); }
  .status.cancelled { color: var(--muted); }
  .err { color: var(--bad); font-size: 13px; margin-top: 4px; max-width: 34ch; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .downloads { white-space: nowrap; }
  .downloads a { font-weight: 500; text-decoration: none; margin-right: 14px; }
  .downloads a:hover { text-decoration: underline; }

  @media (max-width: 640px) {
    main { padding: 28px 16px 56px; }
    h1 { font-size: 26px; }
    .active li { flex-wrap: wrap; gap: 12px; }
    /* Op een gsm wordt elke check-up een blok met de kolomnaam voor elke waarde. */
    table { min-width: 0; }
    thead { display: none; }
    tr, td { display: block; }
    tr { padding: 14px 0; border-bottom: 1px solid var(--line); }
    td { display: flex; gap: 12px; padding: 3px 0; border: none; }
    td.num { text-align: left; }
    td:empty { display: none; }
    td[data-label]::before { content: attr(data-label); flex: 0 0 96px; color: var(--muted); font-size: 13px; padding-top: 2px; }
    td:first-child { margin-bottom: 6px; }
  }
  @media (prefers-reduced-motion: reduce) { .bar span { transition: none; } }
</style>
</head>
<body>
<main>
  <header>
    <h1>Check-ups</h1>
    <span class="updated"><span id="updated"></span>${user ? ` <span class="user">${esc(user)}</span> <a href="/dashboard/logout">Uitloggen</a>` : ""}</span>
  </header>
  <p class="intro">Alle check-ups van de Skrol-browsertool. Een nieuwe check-up start je in Claude met de skill webflow-checkup; hier volg je ze op, stop je er een en download je het rapport.</p>
  <p class="notice" id="notice" role="status" aria-live="polite"></p>

  <section aria-labelledby="active-title">
    <div class="section-head"><h2 id="active-title">Nu bezig</h2></div>
    <div id="active"></div>
  </section>

  <section aria-labelledby="history-title">
    <div class="section-head">
      <h2 id="history-title">Vorige check-ups <span class="count" id="history-count"></span></h2>
      <input type="search" id="filter" placeholder="Zoek op site" aria-label="Zoek op site">
    </div>
    <div id="history"></div>
  </section>
</main>
<script nonce="${nonce}">
"use strict";
const STATUS = { queued: "In de wachtrij", running: "Bezig", done: "Klaar", failed: "Mislukt", cancelled: "Geannuleerd" };
const DAY = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const DAY_YEAR = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const TIME = new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const armed = new Map();
let jobs = [];
let timer = null;

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false || child === "") continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function host(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function safeUrl(url) {
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:" ? u.href : null; } catch { return null; }
}

function date(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return (d.getFullYear() === new Date().getFullYear() ? DAY : DAY_YEAR).format(d);
}

function duration(from, to) {
  if (!from || !to) return "";
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  if (s < 60) return s + " s";
  const m = Math.round(s / 60);
  return m < 60 ? m + " min" : Math.floor(m / 60) + " u " + (m % 60) + " min";
}

function pages(n) {
  return n + (n === 1 ? " pagina" : " pagina's");
}

function notice(text, bad) {
  const node = document.getElementById("notice");
  node.textContent = text || "";
  node.className = "notice" + (bad ? " bad" : "");
}

function siteCell(job) {
  const href = safeUrl(job.url);
  return el("div", {},
    href ? el("a", { class: "site", href, target: "_blank", rel: "noopener noreferrer" }, host(job.url)) : el("span", { class: "site" }, job.url),
    job.liveDomain ? el("div", { class: "small" }, "Live domein: " + job.liveDomain) : null,
    el("div", { class: "small", title: "Job-ID, zoals Claude het gebruikt" }, job.id));
}

function cancelButton(job) {
  const isArmed = armed.has(job.id);
  const button = el("button", { type: "button", class: isArmed ? "armed" : "" }, isArmed ? "Klik nog eens om te annuleren" : "Annuleren");
  button.addEventListener("click", async () => {
    if (!armed.has(job.id)) {
      armed.set(job.id, setTimeout(() => { armed.delete(job.id); render(); }, 4000));
      render();
      return;
    }
    clearTimeout(armed.get(job.id));
    armed.delete(job.id);
    button.disabled = true;
    button.textContent = "Bezig met annuleren";
    try {
      const res = await fetch("/dashboard/api/jobs/" + encodeURIComponent(job.id) + "/cancel", { method: "POST", headers: { "x-dashboard": "1" } });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) { location.href = "/dashboard/login?next=%2Fdashboard"; return; }
      if (res.ok) notice("Check-up van " + host(job.url) + " geannuleerd.");
      else notice("Annuleren lukte niet: " + (body.error || "fout " + res.status), true);
    } catch (e) {
      notice("Annuleren lukte niet: de server antwoordt niet.", true);
    }
    load();
  });
  return button;
}

function activeLine(job) {
  if (job.status === "queued") return "In de wachtrij sinds " + date(job.createdAt);
  const p = job.progress || {};
  const parts = [p.phase ? p.phase.charAt(0).toUpperCase() + p.phase.slice(1) : "Bezig"];
  if (p.pagesDone) parts.push(p.pagesDone + " van " + pages(p.pagesFound));
  parts.push("gestart " + date(job.startedAt));
  return parts.join(", ");
}

function bar(pct) {
  // Via de CSSOM: de CSP laat geen style-attributen toe.
  const fill = el("span", {});
  fill.style.width = pct + "%";
  return fill;
}

function renderActive(active) {
  const root = document.getElementById("active");
  if (active.length === 0) {
    root.replaceChildren(el("p", { class: "none" }, "Er loopt nu geen check-up."));
    return;
  }
  root.replaceChildren(el("ul", { class: "active" }, active.map((job) => {
    const p = job.progress || {};
    const pct = job.status === "running" && p.pagesFound ? Math.min(100, Math.round((p.pagesDone / p.pagesFound) * 100)) : 0;
    return el("li", { class: job.status },
      el("div", { class: "main" },
        siteCell(job),
        el("div", { class: "line" }, activeLine(job)),
        job.status === "running"
          ? el("div", { class: "bar", role: "progressbar", "aria-label": "Pagina's gecontroleerd", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct }, bar(pct))
          : null),
      cancelButton(job));
  })));
}

function findingsCell(job) {
  const s = job.summary;
  if (!s) return "";
  const dot = (hint, label) => el("span", { class: hint + (s.byHint[hint] ? "" : " zero"), title: s.byHint[hint] + " " + label }, s.byHint[hint]);
  return el("div", { class: "dots", "aria-label": s.byHint.hoog + " hoog, " + s.byHint.midden + " midden, " + s.byHint.laag + " laag" },
    dot("hoog", "hoog"), dot("midden", "midden"), dot("laag", "laag"));
}

function pagesCell(job) {
  if (job.summary) return el("div", {}, job.summary.pages, job.summary.pagesWithErrors ? el("div", { class: "small" }, job.summary.pagesWithErrors + " met fout") : null);
  return job.progress && job.progress.pagesDone ? String(job.progress.pagesDone) : "";
}

function statusCell(job) {
  return el("div", {},
    el("span", { class: "status " + job.status }, STATUS[job.status] || job.status),
    job.status === "failed" && job.error ? el("div", { class: "err", title: job.error }, job.error) : null);
}

function downloadsCell(job) {
  if (job.status !== "done") return "";
  const base = "/dashboard/jobs/" + encodeURIComponent(job.id);
  return el("div", { class: "downloads" },
    el("a", { href: base + "/rapport.pdf", title: "Rapport als PDF" }, "PDF"),
    el("a", { href: base + "/bevindingen.csv", title: "Alle bevindingen als CSV, voor Excel of Google Sheets" }, "CSV"));
}

function renderHistory(history) {
  const root = document.getElementById("history");
  const query = document.getElementById("filter").value.trim().toLowerCase();
  const shown = query ? history.filter((job) => job.url.toLowerCase().includes(query) || (job.liveDomain || "").includes(query)) : history;
  document.getElementById("history-count").textContent = history.length ? "(" + history.length + ")" : "";
  if (history.length === 0) {
    root.replaceChildren(el("p", { class: "none" }, "Nog geen afgeronde check-ups."));
    return;
  }
  if (shown.length === 0) {
    root.replaceChildren(el("p", { class: "none" }, "Geen check-ups voor \\u201C" + query + "\\u201D."));
    return;
  }
  root.replaceChildren(el("div", { class: "table-wrap" }, el("table", {},
    el("thead", {}, el("tr", {},
      el("th", { scope: "col" }, "Site"),
      el("th", { scope: "col" }, "Gestart"),
      el("th", { scope: "col" }, "Duur"),
      el("th", { scope: "col", class: "num" }, "Pagina's"),
      el("th", { scope: "col" }, "Bevindingen"),
      el("th", { scope: "col" }, "Status"),
      el("th", { scope: "col" }, "Rapport"))),
    el("tbody", {}, shown.map((job) => el("tr", {},
      el("td", {}, siteCell(job)),
      el("td", { class: "when", "data-label": "Gestart" }, date(job.startedAt || job.createdAt)),
      el("td", { class: "when", "data-label": "Duur" }, duration(job.startedAt, job.finishedAt)),
      el("td", { class: "num", "data-label": "Pagina's" }, pagesCell(job)),
      el("td", { "data-label": "Bevindingen" }, findingsCell(job)),
      el("td", { "data-label": "Status" }, statusCell(job)),
      el("td", { "data-label": "Rapport" }, downloadsCell(job))))))));
}

function render() {
  renderActive(jobs.filter((j) => j.status === "running" || j.status === "queued").reverse());
  renderHistory(jobs.filter((j) => j.status !== "running" && j.status !== "queued"));
}

async function load() {
  clearTimeout(timer);
  try {
    const res = await fetch("/dashboard/api/jobs", { cache: "no-store" });
    if (res.status === 401) {
      location.href = "/dashboard/login?next=%2Fdashboard";
      return;
    }
    if (!res.ok) throw new Error("fout " + res.status);
    jobs = (await res.json()).jobs;
    document.getElementById("updated").textContent = "Bijgewerkt om " + TIME.format(new Date());
    if (document.getElementById("notice").classList.contains("bad")) notice("");
    render();
  } catch (e) {
    notice("De check-ups konden niet opgehaald worden (" + e.message + "). Het dashboard probeert het opnieuw.", true);
  }
  const busy = jobs.some((j) => j.status === "running" || j.status === "queued");
  timer = setTimeout(load, document.hidden ? 30000 : busy ? 3000 : 15000);
}

document.getElementById("filter").addEventListener("input", render);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
load();
</script>
</body>
</html>`;
}
