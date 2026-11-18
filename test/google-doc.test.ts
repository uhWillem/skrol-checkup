import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../src/server.js";
import { DRIVE_SCOPE } from "../src/google-login.js";
import { reportDocHtml, reportDocTitle } from "../src/report.js";
import type { CheckupResult } from "../src/runner.js";
import type { Job } from "../src/types.js";
import { testConfig } from "./helpers.js";

// Een nagemaakte Google: /token geeft een ID-token (login) of een access token (Drive), /upload maakt een "doc".
const LOGIN_CODES: Record<string, string> = { "code-daan": "daan@skrol.be" };
const DRIVE_CODES: Record<string, { token: string; scope: string }> = {
  "code-drive": { token: "token-drive", scope: `openid email ${DRIVE_SCOPE}` },
  "code-zonder-drive": { token: "token-zonder", scope: "openid email" },
  "code-drive-uit": { token: "token-api-uit", scope: DRIVE_SCOPE },
};
const DONE = "job_20261118_aaaaaaaa";
const RUNNING = "job_20261118_bbbbbbbb";

let google: Server;
let googleOrigin: string;
let uploads: Array<{ auth: string; query: URLSearchParams; contentType: string; body: string }> = [];
let app: Awaited<ReturnType<typeof startServer>>;
let base: string;

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

const job: Job = {
  id: DONE,
  url: "https://klant.webflow.io",
  status: "done",
  createdAt: "2026-11-18T10:00:00.000Z",
  startedAt: "2026-11-18T10:00:01.000Z",
  finishedAt: "2026-11-18T10:03:00.000Z",
  progress: { pagesDone: 2, pagesFound: 2, phase: "klaar" },
  summary: {
    pages: 2,
    pagesWithErrors: 0,
    findings: 2,
    byHint: { hoog: 1, midden: 0, laag: 1 },
    byCheck: { "heading-1": 1, gtm: 1 },
    stoppedAtMaxPages: false,
  },
};
const result: CheckupResult = {
  startUrl: "https://klant.webflow.io/",
  pages: [
    { url: "https://klant.webflow.io/", path: "/", status: 200, finalUrl: "https://klant.webflow.io/" },
    { url: "https://klant.webflow.io/over", path: "/over", status: 200, finalUrl: "https://klant.webflow.io/over" },
  ],
  findings: [
    { id: "a1", check: "heading-1", item: "Heading 1", category: "SEO", hint: "hoog", browser: "chromium", message: "Geen h1 op deze pagina.", pages: ["/over"] },
    { id: "b2", check: "gtm", item: "GTM Set Up", category: "Tracking", hint: "laag", label: "na te kijken", browser: "chromium", message: "Geen Google Tag Manager gevonden.", pages: ["/"] },
  ],
  summary: job.summary!,
};

before(async () => {
  google = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "POST" && url.pathname === "/token") {
        const p = new URLSearchParams(body);
        if (p.get("client_id") !== "test-client" || p.get("client_secret") !== "test-geheim" || !p.get("code_verifier")) {
          return res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_client" }));
        }
        const email = LOGIN_CODES[p.get("code") ?? ""];
        if (email) {
          const claims = { iss: "https://accounts.google.com", aud: "test-client", exp: Math.floor(Date.now() / 1000) + 3600, email, email_verified: true };
          return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.x` }));
        }
        const drive = DRIVE_CODES[p.get("code") ?? ""];
        if (drive) return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: drive.token, scope: drive.scope, expires_in: 3599 }));
        return res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
      }
      if (req.method === "POST" && url.pathname === "/upload") {
        const auth = req.headers.authorization ?? "";
        uploads.push({ auth, query: url.searchParams, contentType: req.headers["content-type"] ?? "", body });
        if (auth === "Bearer token-api-uit") {
          const message = "Google Drive API has not been used in project 123 before or it is disabled.";
          return res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: 403, message } }));
        }
        if (auth !== "Bearer token-drive") return res.writeHead(401).end();
        return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "doc123", webViewLink: "https://docs.google.com/document/d/doc123/edit" }));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => google.listen(0, "127.0.0.1", resolve));
  const address = google.address();
  googleOrigin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const config = await testConfig({
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-geheim",
    DASHBOARD_EMAILS: "daan@skrol.be",
    DASHBOARD_PASSWORD: "pw",
    GOOGLE_AUTH_URL: `${googleOrigin}/auth`,
    GOOGLE_TOKEN_URL: `${googleOrigin}/token`,
    GOOGLE_DRIVE_UPLOAD_URL: `${googleOrigin}/upload`,
  });
  // Een afgeronde check-up met rapport, en een die nog loopt (wordt bij het laden "mislukt").
  for (const [j, r] of [[job, result], [{ ...job, id: RUNNING, status: "running" as const, summary: undefined }, undefined]] as const) {
    const dir = join(config.dataDir, "jobs", j.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "job.json"), JSON.stringify(j));
    if (r) await writeFile(join(dir, "result.json"), JSON.stringify(r));
  }
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

async function session(): Promise<string> {
  const start = await get("/dashboard/login/google");
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const callback = await get(`/dashboard/auth/callback?code=code-daan&state=${state}`, { cookie: pair(start.headers.getSetCookie()[0]) });
  return pair(callback.headers.getSetCookie().find((c) => c.startsWith("checkup_sessie=") && !c.includes("Max-Age=0"))!);
}

/** Klikt op "Google Doc" en geeft de state en de cookies voor de terugkeer van Google. */
async function startExport(sessionCookie: string, id = DONE) {
  const res = await get(`/dashboard/jobs/${id}/google-doc`, { cookie: sessionCookie });
  const location = res.headers.get("location") ? new URL(res.headers.get("location")!) : undefined;
  const driveCookie = res.headers.getSetCookie().find((c) => c.startsWith("checkup_drive="));
  return { res, location, state: location?.searchParams.get("state") ?? "", cookie: [sessionCookie, driveCookie ? pair(driveCookie) : ""].filter(Boolean).join("; ") };
}

test("de knop Google Doc staat op het dashboard met de Google-login", async () => {
  const html = await (await get("/dashboard", { cookie: await session() })).text();
  assert.ok(html.includes("const GOOGLE_DOC = true;"));
});

test("rapport als Google Doc: toestemming voor Drive, upload en door naar het doc", async () => {
  uploads = [];
  const { res, location, state, cookie } = await startExport(await session());
  assert.equal(res.status, 302);
  assert.equal(location!.origin + location!.pathname, `${googleOrigin}/auth`);
  assert.equal(location!.searchParams.get("scope"), DRIVE_SCOPE);
  assert.equal(location!.searchParams.get("include_granted_scopes"), "true");
  assert.equal(location!.searchParams.get("login_hint"), "daan@skrol.be");
  assert.equal(location!.searchParams.get("redirect_uri"), `${base}/dashboard/auth/callback`);
  assert.equal(location!.searchParams.get("code_challenge_method"), "S256");
  assert.match(state, /^d\./);
  assert.match(res.headers.getSetCookie().join("\n"), /checkup_drive=.*HttpOnly.*SameSite=Lax/);

  const back = await get(`/dashboard/auth/callback?code=code-drive&state=${state}`, { cookie });
  assert.equal(back.status, 302);
  assert.equal(back.headers.get("location"), "https://docs.google.com/document/d/doc123/edit");
  assert.ok(back.headers.getSetCookie().some((c) => c.startsWith("checkup_drive=;") && c.includes("Max-Age=0")));
  // Een export logt niet opnieuw in en raakt de sessie niet aan.
  assert.ok(!back.headers.getSetCookie().some((c) => c.startsWith("checkup_sessie=")));

  assert.equal(uploads.length, 1);
  const upload = uploads[0];
  assert.equal(upload.auth, "Bearer token-drive");
  assert.equal(upload.query.get("uploadType"), "multipart");
  assert.match(upload.contentType, /^multipart\/related; boundary=/);
  const metadata = JSON.parse(upload.body.split("\r\n\r\n")[1].split("\r\n--")[0]);
  assert.deepEqual(metadata, { name: reportDocTitle(job), mimeType: "application/vnd.google-apps.document" });
  assert.ok(upload.body.includes("content-type: text/html; charset=UTF-8"));
  assert.ok(upload.body.includes("Geen h1 op deze pagina."));
  assert.ok(upload.body.includes("🔴 Hoog"));
  assert.ok(upload.body.includes("⚪ Na te kijken"));

  // De state is na gebruik weg: dezelfde terugkeer nog eens werkt niet.
  const again = await get(`/dashboard/auth/callback?code=code-drive&state=${state}`, { cookie: cookie.split("; ")[0] });
  assert.equal(again.status, 400);
});

test("zonder toestemming voor Drive komt er geen Google Doc", async () => {
  uploads = [];
  const s = await session();
  const denied = await startExport(s);
  const res = await get(`/dashboard/auth/callback?error=access_denied&state=${denied.state}`, { cookie: denied.cookie });
  assert.equal(res.status, 403);
  assert.ok((await res.text()).includes("Zonder toestemming voor Google Drive"));

  const unchecked = await startExport(s);
  const res2 = await get(`/dashboard/auth/callback?code=code-zonder-drive&state=${unchecked.state}`, { cookie: unchecked.cookie });
  assert.equal(res2.status, 403);
  assert.ok((await res2.text()).includes("Vink bij de toestemming Google Drive aan"));
  assert.equal(uploads.length, 0);
});

test("een staat die niet klopt, of geen sessie meer: geen export", async () => {
  const s = await session();
  const { state, cookie } = await startExport(s);
  assert.equal((await get(`/dashboard/auth/callback?code=code-drive&state=d.fout`, { cookie })).status, 400);
  // Zonder sessie naar de loginpagina, ook met een geldige state.
  const noSession = await get(`/dashboard/auth/callback?code=code-drive&state=${state}`, { cookie: cookie.split("; ")[1] });
  assert.equal(noSession.status, 302);
  assert.match(noSession.headers.get("location")!, /^\/dashboard\/login/);
  // Zonder sessie start er ook geen export.
  const start = await get(`/dashboard/jobs/${DONE}/google-doc`);
  assert.match(start.headers.get("location")!, /^\/dashboard\/login\?next=/);
});

test("enkel voor een afgeronde check-up", async () => {
  const s = await session();
  assert.equal((await startExport(s, RUNNING)).res.status, 409);
  assert.equal((await startExport(s, "job_20261118_cccccccc")).res.status, 404);
  assert.equal((await startExport(s, "../../etc")).res.status, 404);
});

test("met het reservewachtwoord kan het ook, zonder login_hint", async () => {
  const auth = { authorization: `Basic ${Buffer.from("x:pw").toString("base64")}` };
  const res = await get(`/dashboard/jobs/${DONE}/google-doc`, auth);
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("location")!).searchParams.get("login_hint"), null);
});

test("staat de Drive API uit, dan zegt de foutpagina dat", async () => {
  const { state, cookie } = await startExport(await session());
  const res = await get(`/dashboard/auth/callback?code=code-drive-uit&state=${state}`, { cookie });
  assert.equal(res.status, 502);
  const html = await res.text();
  assert.ok(html.includes("De Google Drive API staat niet aan"));
  assert.ok(html.includes(`/dashboard/jobs/${DONE}/google-doc`));
});

test("het Google Doc: inline stijlen, bolletjes en links, zonder klassen", () => {
  const html = reportDocHtml(job, result);
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(!html.includes("class="));
  assert.ok(!html.includes("<style"));
  assert.ok(html.includes('<a href="https://klant.webflow.io/over">/over</a>'));
  assert.ok(html.includes("background-color:#f0efec"));
  assert.equal(reportDocTitle(job), "Check-up klant.webflow.io — 18 november 2026");
});
