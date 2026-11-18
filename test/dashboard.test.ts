import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../src/server.js";
import { findingsCsv, soortOf, SOORTEN } from "../src/report.js";
import { CHECKS } from "../src/types.js";
import type { CheckupResult } from "../src/runner.js";
import { startExternal, startSite, testConfig } from "./helpers.js";

const PASSWORD = "test-wachtwoord";
const AUTH = { authorization: `Basic ${Buffer.from(`skrol:${PASSWORD}`).toString("base64")}` };

let site: { server: Server; origin: string };
let external: { server: Server; origin: string };
let slow: { server: Server; origin: string };
let app: Awaited<ReturnType<typeof startServer>>;
let base: string;
let doneJob: string;

/** Een trage site met een lange rij pagina's, zodat een check-up lang genoeg loopt om ze te annuleren. */
function startSlowSite(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const n = Number(new URL(req.url ?? "/", "http://x").pathname.match(/\d+/)?.[0] ?? 0);
    const links = Array.from({ length: 5 }, (_, i) => `<a href="/p${n * 5 + i + 1}">Pagina ${n * 5 + i + 1}</a>`).join(" ");
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html lang="nl"><head><title>Pagina ${n}</title></head><body><nav>${links}</nav><main><h1>Pagina ${n}</h1></main><footer></footer></body></html>`);
    }, 400);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}` });
    });
  });
}

async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`time-out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function get(path: string, headers: Record<string, string> = AUTH) {
  return fetch(`${base}${path}`, { headers, redirect: "manual" });
}

function cancel(id: string, headers: Record<string, string> = { ...AUTH, "x-dashboard": "1" }) {
  return fetch(`${base}/dashboard/api/jobs/${id}/cancel`, { method: "POST", headers });
}

before(async () => {
  external = await startExternal();
  site = await startSite(external.origin);
  slow = await startSlowSite();
  const config = await testConfig({ DASHBOARD_PASSWORD: PASSWORD, MCP_PATH: "/mcp-test", JOB_CONCURRENCY: "1" });
  config.port = 0;
  config.host = "127.0.0.1";
  app = await startServer(config, { oldSiteCandidates: ["http://127.0.0.1:1/"] });
  base = `http://127.0.0.1:${app.port}`;
  const job = await app.store.start(`${site.origin}/`);
  doneJob = job.id;
  await waitFor(() => app.store.get(job.id)?.status !== "queued" && app.store.get(job.id)?.status !== "running", 180_000, "check-up van de testsite");
  assert.equal(app.store.get(job.id)?.status, "done", app.store.get(job.id)?.error);
});

after(() => {
  app.http.close();
  site.server.close();
  external.server.close();
  slow.server.close();
});

test("zonder wachtwoord vraagt het dashboard om in te loggen", async () => {
  const res = await get("/dashboard", {});
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /^Basic realm="Skrol check-up"/);
  const api = await get("/dashboard/api/jobs", {});
  assert.equal(api.status, 401);
});

test("een fout wachtwoord wordt geweigerd", async () => {
  const res = await get("/dashboard", { authorization: `Basic ${Buffer.from("skrol:fout").toString("base64")}` });
  assert.equal(res.status, 401);
});

test("met het wachtwoord toont het de pagina, met een strikte CSP", async () => {
  const res = await get("/dashboard");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const csp = res.headers.get("content-security-policy") ?? "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, csp);
  const html = await res.text();
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.ok(html.includes("Check-ups"));
});

test("/ verwijst naar het dashboard", async () => {
  const res = await get("/", {});
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/dashboard");
});

test("de lijst toont de afgeronde check-up met haar samenvatting", async () => {
  const res = await get("/dashboard/api/jobs");
  assert.equal(res.status, 200);
  const { jobs } = (await res.json()) as { jobs: Array<{ id: string; status: string; summary?: { findings: number; byHint: Record<string, number> } }> };
  const job = jobs.find((j) => j.id === doneJob);
  assert.equal(job?.status, "done");
  assert.ok((job?.summary?.findings ?? 0) > 0);
  assert.ok(job?.summary?.byHint.hoog !== undefined);
});

test("CSV met alle bevindingen", async () => {
  const res = await get(`/dashboard/jobs/${doneJob}/bevindingen.csv`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="checkup-127\.0\.0\.1-\d{4}-\d{2}-\d{2}\.csv"/);
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
  assert.ok(text.startsWith("﻿Soort;Prioriteit;Na te kijken;Bevinding"));
  const result = await app.store.result(doneJob);
  assert.ok(text.split("\r\n").length >= (result?.findings.length ?? 0) + 1);
});

test("PDF-rapport", async () => {
  const res = await get(`/dashboard/jobs/${doneJob}/rapport.pdf`);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.subarray(0, 5).toString(), "%PDF-");
  assert.ok(body.length > 5_000);
});

test("zonder Google-login geen Google Doc: de export heeft de OAuth-client nodig", async () => {
  assert.equal((await get(`/dashboard/jobs/${doneJob}/google-doc`)).status, 404);
  assert.ok((await (await get("/dashboard")).text()).includes("const GOOGLE_DOC = false;"));
});

test("annuleren zonder de header van het dashboard wordt geweigerd", async () => {
  const res = await cancel(doneJob, AUTH);
  assert.equal(res.status, 403);
});

test("een job in de wachtrij en een lopende check-up annuleren", async () => {
  const running = await app.store.start(`${slow.origin}/`);
  const queued = await app.store.start(`${slow.origin}/`);
  await waitFor(() => app.store.get(running.id)?.status === "running" && (app.store.get(running.id)?.progress.pagesDone ?? 0) > 0, 30_000, "lopende check-up");
  assert.equal(app.store.get(queued.id)?.status, "queued");

  const list = (await (await get("/dashboard/api/jobs")).json()) as { jobs: Array<{ id: string; status: string }> };
  assert.deepEqual(list.jobs.slice(0, 2).map((j) => j.status), ["queued", "running"]);

  const first = await cancel(queued.id);
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as { job: { status: string } }).job.status, "cancelled");

  const stoppedAt = Date.now();
  const second = await cancel(running.id);
  assert.equal(second.status, 200);
  assert.equal(app.store.get(running.id)?.status, "cancelled");

  // De plaats komt vrij: een nieuwe check-up start meteen, en niet pas als de crawl van de trage site klaar zou zijn.
  const next = await app.store.start(`${slow.origin}/`);
  await waitFor(() => app.store.get(next.id)?.status === "running", 20_000, "volgende check-up start");
  assert.ok(Date.now() - stoppedAt < 20_000);
  assert.equal(app.store.get(queued.id)?.status, "cancelled", "een geannuleerde job in de wachtrij start niet");
  assert.equal((await cancel(next.id)).status, 200);

  // Ook op schijf geannuleerd, zodat het na een herstart zo blijft.
  await new Promise((r) => setTimeout(r, 500));
  const saved = JSON.parse(await readFile(join(app.store["config"].dataDir, "jobs", running.id, "job.json"), "utf8"));
  assert.equal(saved.status, "cancelled");

  assert.equal((await cancel(running.id)).status, 409, "al afgelopen");
  assert.equal((await get(`/dashboard/jobs/${running.id}/rapport.pdf`)).status, 409, "geen rapport zonder resultaat");
  assert.equal((await cancel("job_20260101_deadbeef")).status, 404);
});

test("zonder DASHBOARD_PASSWORD staat het dashboard uit", async () => {
  const config = await testConfig({ MCP_PATH: "/mcp-test" });
  config.port = 0;
  config.host = "127.0.0.1";
  const other = await startServer(config);
  try {
    const res = await fetch(`http://127.0.0.1:${other.port}/dashboard`, { headers: AUTH });
    assert.equal(res.status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${other.port}/`, { redirect: "manual" })).status, 404);
  } finally {
    other.http.close();
  }
});

test("CSV: puntkomma's, aanhalingstekens en formules worden veilig", () => {
  const result: CheckupResult = {
    startUrl: "https://klant.webflow.io/",
    pages: [],
    summary: { pages: 1, pagesWithErrors: 0, findings: 1, byHint: { hoog: 1, midden: 0, laag: 0 }, byCheck: {}, stoppedAtMaxPages: false },
    findings: [
      {
        id: "abc",
        check: "missing-content",
        item: "Missing Content",
        category: "Usability and Design",
        hint: "hoog",
        pages: ["/", "/over"],
        browser: "chromium",
        message: '=HYPERLINK("x"); "lorem"',
      },
    ],
  };
  const lines = findingsCsv(result).slice(1).split("\r\n");
  assert.equal(lines[1].split(";")[0], "Inhoud");
  assert.ok(lines[1].includes(`"'=HYPERLINK(""x""); ""lorem"""`));
  assert.ok(lines[1].includes('"https://klant.webflow.io/\nhttps://klant.webflow.io/over"'));
});

test("elke controle hoort bij een soort uit het rapport", () => {
  const all = SOORTEN.flatMap((s) => s.checks);
  for (const check of Object.values(CHECKS)) assert.notEqual(soortOf(check.id), "Overig", check.id);
  assert.equal(new Set(all).size, all.length, "geen controle in twee soorten");
});
