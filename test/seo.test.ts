import { test } from "node:test";
import assert from "node:assert/strict";
import { disallowsAll, looksPlural, parseSeo, seoDrafts, type SeoEntry, type SeoPage, type SeoContext } from "../src/seo.js";

const HEAD = `<!doctype html><html lang="nl" data-wf-page="p-home" data-wf-site="s1"><head>
  <meta charset="utf-8">
  <title> Webdesign in Gent &amp; omstreken | Klant </title>
  <meta content="Wij bouwen sites." name="description">
  <meta name="robots" content="noindex">
  <link rel="canonical" href="https://www.klant.be/">
  <meta property="og:image" content="https://cdn.example/og.png">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"WebSite"}]}</script>
  <script type="application/ld+json">{ kapot </script>
  <script>(function(w,d,s,l,i){j.src='https://www.googletagmanager.com/gtm.js?id='+i})(window,document,'script','dataLayer','GTM-AB12CD');</script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XYZ"></script>
</head><body><nav></nav><main><div class="faq_item">Vraag</div><a href="/over">Over</a><a href="https://elders.be/x">x</a></main></body></html>`;

test("parseSeo leest titel, description, robots, canonical, OG, schema, GTM en trackers", () => {
  const seo = parseSeo(HEAD, "https://staging.webflow.io/");
  assert.equal(seo.title, "Webdesign in Gent & omstreken | Klant");
  assert.equal(seo.description, "Wij bouwen sites.");
  assert.equal(seo.robots, "noindex");
  assert.equal(seo.canonical, "https://www.klant.be/");
  assert.equal(seo.ogImage, "https://cdn.example/og.png");
  assert.deepEqual(seo.jsonLd.map((b) => b.valid), [true, false]);
  assert.deepEqual(seo.jsonLd[0].types.sort(), ["Organization", "WebSite"]);
  assert.equal(seo.wfPage, "p-home");
  assert.deepEqual(seo.landmarks, { main: 1, nav: 1, footer: 0 });
  assert.deepEqual(seo.gtmIds, ["GTM-AB12CD"]);
  assert.deepEqual(seo.directTrackers, ["Google Analytics (gtag.js)"]);
  assert.equal(seo.faq, true);
  assert.deepEqual(seo.links, ["https://staging.webflow.io/over", "https://elders.be/x"]);
});

test("parseSeo zonder head-gegevens", () => {
  const seo = parseSeo("<html><body><p>Leeg</p></body></html>", "https://x.webflow.io/a");
  assert.equal(seo.title, null);
  assert.equal(seo.description, null);
  assert.deepEqual(seo.jsonLd, []);
  assert.deepEqual(seo.gtmIds, []);
});

test("disallowsAll herkent de robots.txt van een niet-geïndexeerd subdomein", () => {
  assert.equal(disallowsAll("User-agent: *\nDisallow: /"), true);
  assert.equal(disallowsAll("User-agent: Googlebot\nUser-agent: *\nDisallow: / # alles"), true);
  assert.equal(disallowsAll("User-agent: *\nDisallow: /admin"), false);
  assert.equal(disallowsAll("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /"), false);
  assert.equal(disallowsAll(""), false);
});

test("looksPlural", () => {
  for (const p of ["/projecten", "/evenementen-events", "/partners-realisaties", "/services"]) assert.equal(looksPlural(p), true, p);
  for (const p of ["/blog", "/project", "/nieuws", "/ondersteuning/zorgproeftuin/project", "/campus"]) assert.equal(looksPlural(p), false, p);
});

function page(over: Partial<SeoPage> = {}): SeoPage {
  return {
    title: "Pagina | Klant",
    description: "Een beschrijving.",
    robots: null,
    canonical: null,
    ogImage: null,
    jsonLd: [],
    wfPage: null,
    wfCollection: null,
    landmarks: { main: 1, nav: 1, footer: 1 },
    gtmIds: ["GTM-AB12CD"],
    directTrackers: [],
    faq: false,
    links: [],
    ...over,
  };
}

const CTX: SeoContext = {
  startPath: "/",
  onWebflowIo: true,
  robotsTxt: "User-agent: *\nDisallow: /",
  sitemap: { found: true, paths: ["/", "/over", "/blog/a", "/blog/b", "/blog/c", "/projecten/x", "/projecten/y"], hosts: ["www.klant.be"], deadPaths: [] },
};

function keys(drafts: ReturnType<typeof seoDrafts>): string[] {
  // De sleutels van CMS-bevindingen eindigen op de template-ID; die laten we weg.
  return drafts.map((d) => `${d.draft.info.id}|${d.draft.info.id === "cms-seo" ? d.draft.key.replace(/\|[^|]+$/, "") : d.draft.key}`).sort();
}

test("seoDrafts: een nette site geeft niets", () => {
  const entries: SeoEntry[] = [
    { path: "/", seo: page({ title: "Home | Klant", wfPage: "p1", jsonLd: [{ valid: true, types: ["Organization"] }] }) },
    { path: "/over", seo: page({ title: "Over ons | Klant", description: "Over Klant.", wfPage: "p2" }) },
    { path: "/blog/a", seo: page({ title: "A | Klant", description: "A.", wfPage: "pb", ogImage: "a.png" }) },
    { path: "/blog/b", seo: page({ title: "B | Klant", description: "B.", wfPage: "pb", ogImage: "b.png" }) },
  ];
  assert.deepEqual(keys(seoDrafts(entries, CTX)), []);
});

test("seoDrafts: titels, descriptions, CMS, schema, structuur, indexering, sitemap, domein, GTM en slugs", () => {
  const blog = (path: string, extra: Partial<SeoPage> = {}): SeoEntry => ({
    path,
    seo: page({ title: "Blog | Klant", description: "Blogpost.", wfPage: "pb", ...extra }),
  });
  const entries: SeoEntry[] = [
    { path: "/", seo: page({ title: "Home", wfPage: "p1", directTrackers: ["Hotjar"], gtmIds: [] }) },
    { path: "/over", seo: page({ title: null, description: null, wfPage: "p2", landmarks: { main: 0, nav: 1, footer: 0 }, gtmIds: [] }) },
    { path: "/contact", seo: page({ title: "Contact | Klant", description: "Dubbel.", wfPage: "p3", robots: "noindex, nofollow", gtmIds: [] }) },
    { path: "/team", seo: page({ title: "Team | Klant", description: "Dubbel.", wfPage: "p4", jsonLd: [{ valid: false, types: [], error: "x" }], faq: true, gtmIds: [] }) },
    { path: "/lang", seo: page({ title: "Een heel lange titel die echt veel te lang is voor de zoekresultaten | Klant", description: "Lang.", wfPage: "p5", gtmIds: [] }) },
    blog("/blog/a", { gtmIds: [] }),
    blog("/blog/b", { gtmIds: [] }),
    blog("/blog/c", { gtmIds: [] }),
    { path: "/projecten/x", seo: page({ title: "X | Klant", description: null, wfPage: "pp", gtmIds: [] }) },
    { path: "/projecten/y", seo: page({ title: "Y | Klant", description: null, wfPage: "pp", gtmIds: [] }) },
  ];
  const ctx: SeoContext = { ...CTX, robotsTxt: null, sitemap: { ...CTX.sitemap, hosts: ["klant.be"], deadPaths: ["/oud"] } };
  const drafts = seoDrafts(entries, ctx);
  assert.deepEqual(keys(drafts), [
    "cms-seo|description-missing",
    "cms-seo|description-static",
    "cms-seo|og-missing",
    "cms-seo|og-missing",
    "cms-seo|title-static",
    "cms-slugs|/projecten",
    "default-domain|no-www",
    "gtm|direct|Hotjar",
    "gtm|missing",
    "indexing|webflow-io",
    "noindex|noindex",
    "page-structure|no-footer",
    "page-structure|no-main",
    "schema|faq",
    "schema|home",
    "schema|invalid",
    "seo-description|duplicate|dubbel.",
    "seo-description|missing",
    "seo-title|long",
    "seo-title|missing",
    "seo-title|page-name",
    "sitemap|dead",
    "sitemap|not-listed",
  ]);
  const find = (id: string, key: string) => drafts.find((d) => d.draft.info.id === id && d.draft.key.startsWith(key))!;
  assert.deepEqual(find("cms-seo", "title-static").pages, ["/blog/a", "/blog/b", "/blog/c"]);
  assert.equal(find("cms-seo", "title-static").draft.hint, "hoog");
  assert.match(find("cms-seo", "title-static").draft.message, /\/blog\/…/);
  assert.deepEqual(find("seo-title", "missing").pages, ["/over"]);
  assert.deepEqual(find("seo-title", "page-name").pages, ["/"]);
  assert.deepEqual(find("sitemap", "not-listed").pages, ["/team", "/lang"]);
  assert.deepEqual(find("noindex", "noindex").pages, ["/contact"]);
  assert.equal(find("noindex", "noindex").draft.label, "na te kijken");
});

test("seoDrafts: een titel van een gekopieerd project is hoog", () => {
  const entries: SeoEntry[] = [
    { path: "/", seo: page({ title: "Copy of Klant", wfPage: "p1", jsonLd: [{ valid: true, types: ["Organization"] }] }) },
    { path: "/over", seo: page({ title: "Over ons | Klant", description: "Over.", wfPage: "p2" }) },
  ];
  const drafts = seoDrafts(entries, { ...CTX, sitemap: { ...CTX.sitemap, paths: ["/", "/over"] } });
  const copy = drafts.find((d) => d.draft.key === "copy");
  assert.equal(copy?.draft.hint, "hoog");
  assert.deepEqual(copy?.pages, ["/"]);
});

test("seoDrafts: CMS-pagina's met dezelfde titel maar niet het hele template = dubbele titel", () => {
  const entries: SeoEntry[] = [
    { path: "/blog/a", seo: page({ title: "Zelfde | Klant", wfPage: "pb", ogImage: "a.png", description: "A" }) },
    { path: "/blog/b", seo: page({ title: "Zelfde | Klant", wfPage: "pb", ogImage: "b.png", description: "B" }) },
    { path: "/blog/c", seo: page({ title: "Ander | Klant", wfPage: "pb", ogImage: "c.png", description: "C" }) },
  ];
  const drafts = seoDrafts(entries, { ...CTX, sitemap: { ...CTX.sitemap, paths: ["/blog/a", "/blog/b", "/blog/c"] } });
  assert.deepEqual(keys(drafts), ["seo-title|duplicate|zelfde | klant"]);
});
