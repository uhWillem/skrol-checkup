import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { migrationDrafts } from "../src/migration.js";
import { UrlGuard } from "../src/url-guard.js";
import type { Config } from "../src/config.js";
import { startExternal, startSite, testConfig } from "./helpers.js";

const OLD_PAGES: Record<string, string> = {
  "/": `<html><head><title>Welkom | Klant</title><meta name="description" content="Oude home."></head>
        <body><a href="/over">Over</a> <a href="/oud-blog">Blog</a> <a href="https://elders.be/">Elders</a></body></html>`,
  "/over": `<html><head><title>Over ons | Klant</title></head><body><a href="/">Home</a></body></html>`,
  "/diensten/webdesign/": `<html><head><title>Over ons | Klant</title></head><body></body></html>`,
  "/oud-blog": `<html><head><title>Blog | Klant</title></head><body></body></html>`,
};

/** De oude site van de klant, met of zonder sitemap. */
function startOldSite(withSitemap: boolean): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (path === "/sitemap.xml" && withSitemap) {
      const locs = [...Object.keys(OLD_PAGES), "/weg"].map((p) => `<url><loc>${origin}${p}</loc></url>`).join("");
      return res.writeHead(200, { "content-type": "application/xml" }).end(`<?xml version="1.0"?><urlset>${locs}</urlset>`);
    }
    const html = OLD_PAGES[path];
    if (!html) return res.writeHead(404).end("weg");
    return res.writeHead(200, { "content-type": "text/html" }).end(html);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` })),
  );
}

let site: { server: Server; origin: string };
let external: { server: Server; origin: string };
let config: Config;
let guard: UrlGuard;

before(async () => {
  external = await startExternal();
  site = await startSite(external.origin);
  config = await testConfig();
  guard = new UrlGuard(config.allowedDomains, config.allowPrivateNetworks);
});

after(() => {
  site.server.close();
  external.server.close();
});

test("migratie via de sitemap van de oude site: redirects, gewijzigde slugs en andere titels", async () => {
  const old = await startOldSite(true);
  try {
    const result = await migrationDrafts("127.0.0.1", site.origin, new Map(), new Map(), config, guard, undefined, [`${old.origin}/`]);
    assert.ok(!("skipped" in result), JSON.stringify(result));
    assert.deepEqual(result.summary, {
      oldSite: old.origin,
      source: "sitemap",
      oldPages: 4,
      same: 2,
      redirected: 1,
      missing: 1,
      failed: 0,
      truncated: false,
    });
    const byKey = new Map(result.drafts.map((d) => [`${d.draft.info.id}|${d.draft.key}`, d]));
    assert.deepEqual([...byKey.keys()].sort(), ["redirects|missing", "seo-migration|description", "seo-migration|title", "slugs|changed"]);
    assert.deepEqual(byKey.get("redirects|missing")!.pages, ["/oud-blog"]);
    assert.deepEqual(byKey.get("slugs|changed")!.draft.evidence?.redirects, [{ from: "/diensten/webdesign", to: "/over" }]);
    assert.deepEqual(byKey.get("seo-migration|title")!.pages, ["/"]);
    const example = (byKey.get("seo-migration|title")!.draft.evidence?.examples as Array<Record<string, unknown>>)[0];
    assert.deepEqual(example, { oldPath: "/", newPath: "/", old: "Welkom | Klant", new: "Home | Klant" });
  } finally {
    old.server.close();
  }
});

test("migratie zonder sitemap: de oude site wordt via haar links doorlopen", async () => {
  const old = await startOldSite(false);
  try {
    const result = await migrationDrafts("127.0.0.1", site.origin, new Map(), new Map(), config, guard, undefined, [`${old.origin}/`]);
    assert.ok(!("skipped" in result), JSON.stringify(result));
    assert.equal(result.summary.source, "crawl");
    assert.equal(result.summary.oldPages, 3);
    assert.equal(result.summary.missing, 1);
  } finally {
    old.server.close();
  }
});

test("migratie: oude site onbereikbaar", async () => {
  const result = await migrationDrafts("127.0.0.1", site.origin, new Map(), new Map(), config, guard, undefined, ["http://127.0.0.1:1/"]);
  assert.ok("skipped" in result);
});
