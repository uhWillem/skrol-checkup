import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { isTitleCase, readWebflow, sameClock, webflowDrafts, webflowSummary, type WebflowData } from "../src/webflow.js";
import { runCheckup } from "../src/runner.js";
import { UrlGuard } from "../src/url-guard.js";
import { startExternal, startSite, testConfig } from "./helpers.js";

const TOKEN = "wf-test-token-ABC";
const LOREM = "Dolor enim eu tortor urna sed duis nulla. Aliquam vestibulum, nulla odio nisl vitae mi tincidunt.";

const SITE = { id: "site1", displayName: "Klant", shortName: "klant-staging", timeZone: "America/New_York", customDomains: [{ url: "www.klant.be" }, { url: "127.0.0.1" }] };
const PAGES = [
  { id: "p1", title: "Home", slug: "", publishedPath: "/" },
  { id: "p2", title: "Over ons", slug: "over", publishedPath: "/over" },
  { id: "p3", title: "Onze Diensten", slug: "diensten", publishedPath: "/diensten", draft: true },
  { id: "p4", title: "Blog Posts Template", slug: "detail_blog", collectionId: "col-blog" },
  { id: "p5", title: "oud", slug: "oud", archived: true },
  { id: "p6", title: "Style Guide", slug: "style-guide", publishedPath: "/style-guide", draft: true },
];
const FIELDS = [
  { id: "f1", slug: "name", displayName: "Name", type: "PlainText", isRequired: true, isEditable: true },
  { id: "f2", slug: "slug", displayName: "Slug", type: "PlainText", isRequired: true, isEditable: true },
  { id: "f3", slug: "intro", displayName: "Intro", type: "PlainText", isRequired: false, isEditable: true, helpText: "Korte samenvatting voor de kaart." },
  { id: "f4", slug: "afbeelding", displayName: "Afbeelding", type: "Image", isRequired: false, isEditable: true },
  { id: "f5", slug: "video", displayName: "Video", type: "VideoLink", isRequired: false, isEditable: true },
  { id: "f6", slug: "uitgelicht", displayName: "Uitgelicht", type: "Switch", isRequired: false, isEditable: true },
  { id: "f7", slug: "alt", displayName: "Afbeelding Alt-tekst", type: "PlainText", isRequired: false, isEditable: true, helpText: "Beschrijf de afbeelding." },
];
const img = { fileId: "x", url: "https://cdn.example/a.png", alt: null };
const BLOG_ITEMS = [
  { id: "i1", fieldData: { name: "Eerste post", slug: "eerste-post", intro: "Echte tekst over het project.", afbeelding: img, uitgelicht: true } },
  { id: "i2", fieldData: { name: "Tweede post", slug: "tweede-post", intro: LOREM, afbeelding: img } },
  { id: "i3", fieldData: { name: "Test post", slug: "test-post", intro: "Iets.", afbeelding: null } },
  { id: "i4", isDraft: true, fieldData: { name: "Vierde post", slug: "vierde-post", intro: "Nog een echte tekst.", afbeelding: img } },
  { id: "i5", isArchived: true, fieldData: { name: "Weg", slug: "weg", intro: LOREM } },
];

let api: Server;
let base: string;
let calls: string[];
let rateLimitOnce: boolean;

before(async () => {
  api = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    calls.push(url.pathname + url.search);
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.writeHead(401, { "content-type": "application/json" }).end('{"message":"Unauthorized"}');
    if (rateLimitOnce && url.pathname === "/v2/sites/site1/collections") {
      rateLimitOnce = false;
      return res.writeHead(429, { "retry-after": "0" }).end();
    }
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const json = (body: unknown) => res.writeHead(200, { "content-type": "application/json", "x-ratelimit-remaining": "50" }).end(JSON.stringify(body));
    // Kleine pagina's (2 per keer), zodat de paginering getest wordt; de echte API geeft er 100.
    const paged = (key: string, all: unknown[]) => {
      const size = Math.min(limit, 2);
      return json({ [key]: all.slice(offset, offset + size), pagination: { limit: size, offset, total: all.length } });
    };
    if (url.pathname === "/v2/sites") return json({ sites: [{ id: "other", shortName: "andere-site" }, SITE] });
    if (url.pathname === "/v2/sites/site1/pages") return paged("pages", PAGES);
    if (url.pathname === "/v2/sites/site1/collections") return json({ collections: [{ id: "col-blog" }, { id: "col-team" }] });
    if (url.pathname === "/v2/collections/col-blog") return json({ id: "col-blog", displayName: "Blogposts", slug: "blog", fields: FIELDS });
    if (url.pathname === "/v2/collections/col-team") return json({ id: "col-team", displayName: "Team", slug: "team", fields: FIELDS.slice(0, 3) });
    if (url.pathname === "/v2/collections/col-blog/items") return paged("items", BLOG_ITEMS);
    if (url.pathname === "/v2/collections/col-team/items") return paged("items", [BLOG_ITEMS[0]]);
    return res.writeHead(404).end();
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});

after(() => api.close());

test("isTitleCase", () => {
  for (const n of ["Home", "Over Ons", "Algemene Voorwaarden", "Case Studies", "Voor en Na", "404", "Blog Posts Template"]) assert.equal(isTitleCase(n), true, n);
  for (const n of ["Over ons", "Word lid", "contact", "Case studies"]) assert.equal(isTitleCase(n), false, n);
});

test("sameClock: Brussel en Amsterdam lopen gelijk, New York niet", () => {
  assert.equal(sameClock("Europe/Brussels", "Europe/Amsterdam"), true);
  assert.equal(sameClock("Europe/Brussels", "America/New_York"), false);
  assert.equal(sameClock("Europe/Brussels", "Europe/London"), false);
  assert.equal(sameClock("Geen/Zone", "Europe/Brussels"), false);
});

test("readWebflow: kiest de site aan de shortName, pagineert en wacht bij een 429", async () => {
  calls = [];
  rateLimitOnce = true;
  const config = await testConfig({ WEBFLOW_TOKENS: `ongeldig, ${TOKEN}`, WEBFLOW_API_BASE: base });
  const data = await readWebflow(config, "klant-staging.webflow.io");
  assert.ok(!("skipped" in data), JSON.stringify(data));
  assert.equal(data.site.id, "site1");
  assert.equal(data.pages?.length, 6);
  assert.deepEqual(data.collections?.map((c) => [c.collection.displayName, c.items.length]), [["Blogposts", 5], ["Team", 1]]);
  assert.deepEqual(data.errors, []);
  assert.ok(calls.filter((c) => c.startsWith("/v2/sites/site1/collections")).length === 2, "na de 429 opnieuw geprobeerd");
  assert.deepEqual(webflowSummary(data), { site: "Klant", timeZone: "America/New_York", pages: 5, collections: 2, items: 5 });
});

test("readWebflow: zonder token, met een ander domein of een fout token wordt het overgeslagen", async () => {
  const none = await readWebflow(await testConfig({ WEBFLOW_API_BASE: base }), "klant-staging.webflow.io");
  assert.ok("skipped" in none && /geen Webflow-token/.test(none.skipped));
  const other = await readWebflow(await testConfig({ WEBFLOW_TOKENS: TOKEN, WEBFLOW_API_BASE: base }), "iemand-anders.webflow.io");
  assert.ok("skipped" in other && /hoort bij iemand-anders\.webflow\.io/.test(other.skipped));
  const wrong = await readWebflow(await testConfig({ WEBFLOW_TOKENS: "fout", WEBFLOW_API_BASE: base }), "klant-staging.webflow.io");
  assert.ok("skipped" in wrong && /1 gaf een fout/.test(wrong.skipped));
  assert.ok(!JSON.stringify(wrong).includes("fout\""), "het token zelf staat niet in de reden");
});

test("readWebflow: een eigen domein herkent de tool aan de custom domains", async () => {
  const data = await readWebflow(await testConfig({ WEBFLOW_TOKENS: TOKEN, WEBFLOW_API_BASE: base }), "klant.be");
  assert.ok(!("skipped" in data));
  assert.equal(data.site.id, "site1");
});

test("webflowDrafts: tijdzone, paginanamen, drafts, helpteksten, aantal items, opvultekst en lege velden", async () => {
  const data = (await readWebflow(await testConfig({ WEBFLOW_TOKENS: TOKEN, WEBFLOW_API_BASE: base }), "klant-staging.webflow.io")) as WebflowData;
  const drafts = webflowDrafts(data, { startPath: "/", liveDomain: "klant.be", collectionFolders: new Map([["col-blog", "/blog"]]) });
  const byKey = new Map(drafts.map((d) => [`${d.draft.info.id}|${d.draft.key}`, d]));
  assert.deepEqual([...byKey.keys()].sort(), [
    "cms-content|col-blog",
    "cms-fields|alt|col-blog",
    "cms-fields|help|col-blog",
    "cms-fields|unused|col-blog",
    "cms-items|col-team",
    "conditional-visibility|col-blog",
    "draft-pages|draft",
    "page-names|title-case",
    "timezone|wrong",
  ]);
  assert.match(byKey.get("timezone|wrong")!.draft.message, /America\/New_York.*Europe\/Brussels/);
  assert.deepEqual(byKey.get("page-names|title-case")!.pages, ["/over"]);
  assert.deepEqual(byKey.get("draft-pages|draft")!.pages, ["/diensten"]);
  // Opvultekst en een testnaam; het gearchiveerde item telt niet mee.
  assert.deepEqual(byKey.get("cms-content|col-blog")!.pages, ["/blog/tweede-post", "/blog/test-post"]);
  assert.equal(byKey.get("cms-content|col-blog")!.draft.info.hint, "hoog");
  // Afbeelding leeg in 1 van 4 actieve items; video in geen enkel item ingevuld; een switch telt niet.
  assert.match(byKey.get("conditional-visibility|col-blog")!.draft.message, /"Afbeelding" is leeg in 1 van de 4 items/);
  assert.match(byKey.get("cms-fields|unused|col-blog")!.draft.message, /"Video"/);
  assert.match(byKey.get("cms-fields|help|col-blog")!.draft.message, /3 van de 5 velden/);
  assert.equal(byKey.get("cms-fields|alt|col-blog")!.draft.hint, "midden");
  assert.match(byKey.get("cms-fields|alt|col-blog")!.draft.message, /lege alt-tekst/);
  assert.match(byKey.get("cms-items|col-team")!.draft.message, /1 item;/);
  // Bevindingen over een collectie zonder CMS-pagina's hangen aan de startpagina.
  assert.deepEqual(byKey.get("cms-items|col-team")!.pages, ["/"]);
  assert.deepEqual(byKey.get("cms-fields|help|col-blog")!.pages, ["/blog/eerste-post"]);
});

test("webflowDrafts: tijdzone zonder bekend domein is na te kijken, een gelijklopende zone is in orde", () => {
  const data: WebflowData = { site: { id: "s", timeZone: "Europe/Amsterdam" }, pages: [], collections: [], errors: [] };
  assert.deepEqual(webflowDrafts(data, { startPath: "/", liveDomain: "klant.be", collectionFolders: new Map() }), []);
  const unknown = webflowDrafts(data, { startPath: "/", collectionFolders: new Map() });
  assert.equal(unknown[0].draft.label, "na te kijken");
  const missing = webflowDrafts({ ...data, site: { id: "s" } }, { startPath: "/", collectionFolders: new Map() });
  assert.equal(missing[0].draft.key, "missing");
});

test("check-up met de Webflow-lezer: bevindingen en samenvatting", async () => {
  const external = await startExternal();
  const site = await startSite(external.origin);
  try {
    const config = await testConfig({ WEBFLOW_TOKENS: TOKEN, WEBFLOW_API_BASE: base });
    const guard = new UrlGuard(config.allowedDomains, config.allowPrivateNetworks);
    const result = await runCheckup(`${site.origin}/`, config, guard, undefined, { oldSiteCandidates: ["http://127.0.0.1:1/"] });
    assert.deepEqual(result.summary.webflow, { site: "Klant", timeZone: "America/New_York", pages: 5, collections: 2, items: 5 });
    assert.ok(!(result.summary.skipped ?? []).some((s) => s.check === "timezone"));
    const zone = result.findings.find((f) => f.check === "timezone");
    assert.match(zone?.message ?? "", /klant\.be wijst op Europe\/Brussels/);
    // De CMS-pagina /cms hoort bij col-blog (data-wf-collection), dus de items staan in de hoofdmap.
    const content = result.findings.find((f) => f.check === "cms-content");
    assert.deepEqual(content?.pages, ["/tweede-post", "/test-post"]);
    assert.ok(!JSON.stringify(result).includes(TOKEN), "het token staat nergens in het resultaat");
  } finally {
    site.server.close();
    external.server.close();
  }
});
