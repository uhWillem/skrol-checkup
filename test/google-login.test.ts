import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { startServer } from "../src/server.js";
import { emailAllowed } from "../src/google-login.js";
import { testConfig } from "./helpers.js";

// Een nagemaakte Google: /auth wordt nooit echt geopend, /token wisselt een code in voor een ID-token.
const ACCOUNTS: Record<string, string> = { "code-daan": "daan@skrol.be", "code-vreemd": "iemand@gmail.com" };
let google: Server;
let googleOrigin: string;
let lastTokenRequest: URLSearchParams | undefined;
let app: Awaited<ReturnType<typeof startServer>>;
let base: string;

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

before(async () => {
  google = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/token") return res.writeHead(404).end();
      const p = new URLSearchParams(body);
      lastTokenRequest = p;
      const email = ACCOUNTS[p.get("code") ?? ""];
      if (!email || p.get("client_id") !== "test-client" || p.get("client_secret") !== "test-geheim" || !p.get("code_verifier")) {
        return res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
      }
      const claims = { iss: "https://accounts.google.com", aud: "test-client", exp: Math.floor(Date.now() / 1000) + 3600, email, email_verified: true };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.handtekening` }));
    });
  });
  await new Promise<void>((resolve) => google.listen(0, "127.0.0.1", resolve));
  const address = google.address();
  googleOrigin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const config = await testConfig({
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-geheim",
    DASHBOARD_EMAILS: "daan@skrol.be, Willem.Verdoodt@gmail.com",
    GOOGLE_AUTH_URL: `${googleOrigin}/auth`,
    GOOGLE_TOKEN_URL: `${googleOrigin}/token`,
    // Met een Google-login telt het wachtwoord niet meer.
    DASHBOARD_PASSWORD: "pw",
  });
  config.port = 0;
  config.host = "127.0.0.1";
  app = await startServer(config);
  base = `http://127.0.0.1:${app.port}`;
});

after(() => {
  app.http.close();
  google.close();
});

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers, redirect: "manual" });
const pair = (setCookie: string) => setCookie.split(";")[0];

async function login(code: string, next = "/dashboard") {
  const start = await get(`/dashboard/login/google?next=${encodeURIComponent(next)}`);
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location")!);
  const loginCookie = pair(start.headers.getSetCookie()[0]);
  const callback = await get(`/dashboard/auth/callback?code=${code}&state=${location.searchParams.get("state")}`, { cookie: loginCookie });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("checkup_sessie=") && !c.includes("Max-Age=0"));
  return { location, callback, session };
}

test("zonder login: naar de loginpagina, ook met het wachtwoord", async () => {
  const page = await get("/dashboard");
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/dashboard/login?next=%2Fdashboard");
  assert.equal((await get("/dashboard/api/jobs")).status, 401);
  const pdf = await get("/dashboard/jobs/job_20261118_aaaaaaaa/rapport.pdf");
  assert.equal(pdf.headers.get("location"), "/dashboard/login?next=%2Fdashboard%2Fjobs%2Fjob_20261118_aaaaaaaa%2Frapport.pdf");
  const basic = await get("/dashboard", { authorization: `Basic ${Buffer.from("x:pw").toString("base64")}` });
  assert.equal(basic.status, 302);
});

test("de loginpagina toont de knop", async () => {
  const res = await get("/dashboard/login?next=%2Fdashboard");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("Inloggen met Google"));
  assert.ok(html.includes('href="/dashboard/login/google?next=%2Fdashboard"'));
});

test("inloggen met een toegelaten account, met state en PKCE", async () => {
  const { location, callback, session } = await login("code-daan");
  assert.equal(location.origin + location.pathname, `${googleOrigin}/auth`);
  assert.equal(location.searchParams.get("client_id"), "test-client");
  assert.equal(location.searchParams.get("redirect_uri"), `${base}/dashboard/auth/callback`);
  assert.equal(location.searchParams.get("scope"), "openid email");
  const verifier = lastTokenRequest?.get("code_verifier") ?? "";
  assert.equal(location.searchParams.get("code_challenge"), createHash("sha256").update(verifier).digest("base64url"));

  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/dashboard");
  assert.ok(session);
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);
  assert.match(session, /Path=\/dashboard/);

  const page = await get("/dashboard", { cookie: pair(session) });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("daan@skrol.be"));
  assert.ok(html.includes('href="/dashboard/logout"'));
  assert.equal((await get("/dashboard/api/jobs", { cookie: pair(session) })).status, 200);
  // Al ingelogd: de loginpagina stuurt meteen door.
  assert.equal((await get("/dashboard/login", { cookie: pair(session) })).headers.get("location"), "/dashboard");
});

test("na het inloggen terug naar de gevraagde pagina, maar nooit buiten het dashboard", async () => {
  assert.equal((await login("code-daan", "/dashboard/jobs/job_20261118_aaaaaaaa/rapport.pdf")).callback.headers.get("location"), "/dashboard/jobs/job_20261118_aaaaaaaa/rapport.pdf");
  for (const next of ["https://kwaad.example/", "//kwaad.example/", "/dashboardx", "/dashboard\\..\\x"]) {
    assert.equal((await login("code-daan", next)).callback.headers.get("location"), "/dashboard", next);
  }
});

test("een account dat niet in de lijst staat, komt er niet in", async () => {
  const { callback, session } = await login("code-vreemd");
  assert.equal(callback.status, 403);
  assert.equal(session, undefined);
  assert.ok((await callback.text()).includes("iemand@gmail.com heeft geen toegang"));
});

test("een verkeerde state of een ontbrekend logincookie wordt geweigerd", async () => {
  const start = await get("/dashboard/login/google");
  const cookie = pair(start.headers.getSetCookie()[0]);
  const wrong = await get("/dashboard/auth/callback?code=code-daan&state=fout", { cookie });
  assert.equal(wrong.status, 400);
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const noCookie = await get(`/dashboard/auth/callback?code=code-daan&state=${state}`);
  assert.equal(noCookie.status, 400);
  assert.ok(!noCookie.headers.getSetCookie().some((c) => c.startsWith("checkup_sessie=")));
});

test("een aangepast sessiecookie werkt niet", async () => {
  const { session } = await login("code-daan");
  const [body, mac] = pair(session!).split("=")[1].split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  const forged = `${Buffer.from(JSON.stringify({ ...payload, e: "willem.verdoodt@gmail.com" })).toString("base64url")}.${mac}`;
  assert.equal((await get("/dashboard", { cookie: `checkup_sessie=${forged}` })).status, 302);
  assert.equal((await get("/dashboard/api/jobs", { cookie: `checkup_sessie=${forged}` })).status, 401);
});

test("uitloggen wist de sessie", async () => {
  const res = await get("/dashboard/logout");
  assert.equal(res.headers.get("location"), "/dashboard/login?uit=1");
  assert.ok(res.headers.getSetCookie().some((c) => c.startsWith("checkup_sessie=;") && c.includes("Max-Age=0")));
  assert.ok((await (await get("/dashboard/login?uit=1")).text()).includes("Je bent uitgelogd."));
});

test("wie uit DASHBOARD_EMAILS gehaald wordt, is meteen uitgelogd", async () => {
  const { session } = await login("code-daan");
  const config = app.store["config"];
  const before = config.dashboardEmails;
  config.dashboardEmails = ["willem.verdoodt@gmail.com"];
  try {
    assert.equal((await get("/dashboard", { cookie: pair(session!) })).status, 302);
  } finally {
    config.dashboardEmails = before;
  }
});

test("toegelaten adressen en domeinen", () => {
  assert.ok(emailAllowed("Daan@Skrol.be", ["daan@skrol.be"]));
  assert.ok(!emailAllowed("dries@skrol.be", ["daan@skrol.be"]));
  assert.ok(emailAllowed("dries@skrol.be", ["skrol.be"]));
  assert.ok(!emailAllowed("iemand@notskrol.be", ["skrol.be"]));
  assert.ok(!emailAllowed("iemand@gmail.com", []));
});
