import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { runCheckup, type CheckupResult } from "../src/runner.js";
import { UrlGuard } from "../src/url-guard.js";
import { startExternal, startSite, testConfig } from "./helpers.js";

let site: { server: Server; origin: string };
let external: { server: Server; origin: string };
let result: CheckupResult;

const find = (check: string, page?: string) =>
  result.findings.filter((f) => f.check === check && (page === undefined || f.pages.includes(page)));

before(async () => {
  external = await startExternal();
  site = await startSite(external.origin);
  const config = await testConfig();
  const guard = new UrlGuard(config.allowedDomains, config.allowPrivateNetworks);
  result = await runCheckup(`${site.origin}/`, config, guard);
});

after(() => {
  site.server.close();
  external.server.close();
});

test("vindt alle pagina's: via links, via de sitemap, en de kapotte pagina", () => {
  const paths = result.pages.map((p) => p.path).sort();
  assert.deepEqual(paths, ["/", "/bestaat-niet", "/cms", "/formulier", "/fout", "/over", "/over-copy", "/verborgen"]);
  assert.equal(result.summary.pagesWithErrors, 1);
  assert.equal(result.summary.stoppedAtMaxPages, false);
});

test("h1 en headingstructuur", () => {
  assert.equal(find("heading-1").length, 1);
  assert.deepEqual(find("heading-1")[0].pages, ["/fout"]);
  assert.equal(find("heading-1")[0].evidence?.count, 2);
  assert.deepEqual(find("heading-structure").map((f) => f.pages[0]), ["/fout"]);
});

test("alt-teksten: per soort en per onderdeel; decoratief, badge, link met tekst en partnernaam niet", () => {
  const alt = find("image-alt");
  const byProblem = new Map(alt.map((f) => [String(f.evidence?.problem), f]));
  assert.deepEqual([...byProblem.keys()].sort(), ["empty", "filename", "link", "missing"], alt.map((f) => f.message).join("\n"));
  assert.equal(alt.length, 4);
  assert.deepEqual(byProblem.get("missing")?.pages, ["/fout"]);
  assert.match(String(byProblem.get("filename")?.message), /IMG_1234\.jpg/);
  // Dezelfde link-afbeelding op twee pagina's is één bevinding.
  const link = byProblem.get("link")!;
  assert.deepEqual([...link.pages].sort(), ["/fout", "/over-copy"]);
  assert.equal(link.hint, "midden");
  assert.equal(link.label, undefined);
  assert.match(String(link.element), /icoon-link/);
  const empty = byProblem.get("empty")!;
  assert.equal(empty.label, "na te kijken");
  assert.equal(empty.hint, "laag");
  assert.equal(empty.evidence?.count, 1, "enkel /sfeer.jpg: de badge en de knop met tekst tellen niet");
});

test("ontbrekende inhoud: lorem ipsum, standaardteksten en placeholders", () => {
  const content = find("missing-content", "/fout");
  const kinds = content.map((f) => f.message);
  assert.equal(kinds.length, 5, kinds.join("\n"));
  const upload = content.find((f) => f.message.includes("bestandsnaam"));
  assert.equal(upload?.label, "na te kijken");
  assert.match(JSON.stringify(upload?.evidence), /placeholder-p-500\.jpg/);
  assert.ok(kinds.some((m) => m.includes("Lorem ipsum")));
  assert.ok(kinds.some((m) => m.includes("This is some text inside of a div block.")));
  assert.ok(kinds.some((m) => m.includes("\"Heading\"")));
  assert.ok(kinds.some((m) => m.includes("placeholder")));
  assert.equal(find("missing-content", "/cms").length, 1);
});

test("horizontale scroll op mobiel, en verborgen overloop als na te kijken", () => {
  const scroll = find("horizontal-scroll", "/fout");
  assert.equal(scroll.length, 1);
  assert.equal(scroll[0].viewport, 360);
  assert.match(scroll[0].message, /390, 360/);
  assert.match(String(scroll[0].element), /te-breed/);
  const hidden = find("horizontal-scroll", "/cms");
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].label, "na te kijken");
  assert.equal(find("horizontal-scroll", "/").length, 0);
});

test("links: kapot intern, kapot extern, na te kijken, en werkende links niet", () => {
  const links = find("broken-links");
  const byUrl = new Map(links.map((f) => [String(f.evidence?.url), f]));
  const internal = byUrl.get(`${site.origin}/bestaat-niet`);
  assert.equal(internal?.hint, "hoog");
  assert.equal(byUrl.get(`${external.origin}/gone`)?.hint, "midden");
  assert.equal(byUrl.get(`${external.origin}/error`)?.hint, "midden");
  assert.equal(byUrl.get(`${external.origin}/blocked`)?.label, "na te kijken");
  assert.equal(byUrl.has(`${external.origin}/ok`), false);
  assert.equal(byUrl.has(`${external.origin}/redirect`), false);
  // Het live domein komt uit de sitemap; links ernaartoe worden op de testsite zelf gecontroleerd.
  assert.equal(result.summary.liveDomain, "klant.be");
  assert.equal(result.summary.liveDomainSource, "sitemap");
  const live = byUrl.get("https://klant.be/oude-pagina");
  assert.equal(live?.hint, "hoog");
  assert.equal(live?.evidence?.checkedUrl, `${site.origin}/oude-pagina`);
  assert.match(String(live?.message), /live domein/);
  assert.equal(byUrl.has("https://www.klant.be/over"), false);
  assert.equal(links.length, 5, links.map((l) => l.message).join("\n"));
  const empty = find("empty-links");
  assert.equal(empty.length, 1, "lightbox-link met # telt niet mee");
  assert.deepEqual(empty[0].pages, ["/fout"]);
});

test("formulieren: standaardmeldingen, naam en velden; het nieuwsbriefformulier is in orde", () => {
  for (const check of ["form-success-message", "form-error-message", "form-name", "form-inputs"]) {
    const found = find(check, "/formulier");
    assert.equal(found.length, 1, check);
    // Bij de velden wijst element naar het eerste foute veld, bij de rest naar het formulier.
    assert.match(String(found[0].element), check === "form-inputs" ? /input#field/ : /email-form/, check);
  }
  const issues = find("form-inputs")[0].evidence?.issues as Array<{ name: string }>;
  assert.deepEqual(issues.map((i) => i.name).sort(), ["Field", "email"]);
});

test("lege collectie met standaardtekst", () => {
  const empty = find("empty-state");
  assert.equal(empty.length, 1);
  assert.deepEqual(empty[0].pages, ["/cms"]);
});

test("testpagina's: kopie herkend aan het adres", () => {
  const testPages = find("test-page");
  assert.equal(testPages.length, 1);
  assert.deepEqual(testPages[0].pages, ["/over-copy"]);
  assert.equal(testPages[0].label, "na te kijken");
});

test("instellingen: badge, taalcode, favicon", () => {
  assert.deepEqual(find("webflow-badge")[0]?.pages, ["/fout"]);
  assert.equal(find("webflow-badge")[0]?.label, undefined, "geen .webflow.io: de badge is een zekere bug");
  assert.deepEqual(find("lang").map((f) => f.pages), [["/formulier"]]);
  const favicon = find("favicon");
  assert.deepEqual(favicon.map((f) => f.message.slice(0, 20)).sort(), ["Geen web clip (apple", "Het Webflow-standaar"]);
  assert.ok(favicon.every((f) => f.pages.length === 1 && f.pages[0] === "/formulier"));
});

test("geen valse meldingen op de propere pagina's", () => {
  for (const page of ["/", "/verborgen"]) {
    const onPage = result.findings.filter((f) => f.pages.includes(page));
    assert.deepEqual(onPage.map((f) => f.message), [], page);
  }
  const onOver = result.findings.filter((f) => f.pages.includes("/over") && f.check !== "broken-links");
  assert.deepEqual(onOver.map((f) => f.message), []);
});

test("bevindingen zijn gesorteerd op prioriteit en hebben een stabiele ID", () => {
  const order = { hoog: 0, midden: 1, laag: 2 };
  const hints = result.findings.map((f) => order[f.hint]);
  assert.deepEqual(hints, [...hints].sort((a, b) => a - b));
  assert.equal(new Set(result.findings.map((f) => f.id)).size, result.findings.length);
});
