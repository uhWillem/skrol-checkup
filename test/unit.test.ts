import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp, matchesDomain, UrlGuard } from "../src/url-guard.js";
import { normalizeDomain, normalizePageUrl, readSitemap } from "../src/discover.js";
import { componentOf, inputIssues, isFilenameLike, overflowDrafts, pageDrafts, testPageWord } from "../src/checks.js";
import type { RawPageData } from "../src/page-scripts.js";
import { authorized } from "../src/server.js";

test("matchesDomain: wildcard en kaal domein", () => {
  assert.equal(matchesDomain("klant.webflow.io", ["*.webflow.io"]), true);
  assert.equal(matchesDomain("webflow.io.evil.com", ["*.webflow.io"]), false);
  assert.equal(matchesDomain("www.klant.be", ["klant.be"]), true);
  assert.equal(matchesDomain("shop.klant.be", ["klant.be"]), false);
  assert.equal(matchesDomain("evilklant.be", ["klant.be"]), false);
});

test("isPrivateIp: interne adressen worden herkend", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1", "0.0.0.0"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "160.79.104.10", "2a00:1450:4001::1", "172.32.0.1"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("UrlGuard: localhost en IP-literals worden geblokkeerd", async () => {
  const guard = new UrlGuard(["*.webflow.io"], false);
  assert.equal(await guard.resolvesToPrivate("localhost"), true);
  assert.equal(await guard.resolvesToPrivate("127.0.0.1"), true);
  assert.equal(await guard.resolvesToPrivate("[::1]"), true);
  assert.equal(guard.isAllowedPage("https://klant.webflow.io/"), true);
  assert.equal(guard.isAllowedPage("https://google.com/"), false);
  assert.equal(guard.isAllowedPage("file:///etc/passwd"), false);
});

test("normalizePageUrl: zonder hash, zoekparameters en slash op het einde", () => {
  assert.equal(normalizePageUrl("https://a.webflow.io/blog/?page=2#top"), "https://a.webflow.io/blog");
  assert.equal(normalizePageUrl("https://a.webflow.io/"), "https://a.webflow.io/");
  assert.equal(normalizePageUrl("mailto:x@y.be"), null);
});

test("readSitemap: paden van het live domein worden op het staging-domein gezet", async () => {
  const xml = "<urlset><url><loc>https://www.klant.be/over</loc></url><url><loc>https://www.klant.be/file.pdf</loc></url></urlset>";
  const { pages, hosts } = await readSitemap("https://klant.webflow.io", async () => xml);
  assert.deepEqual(pages, ["https://klant.webflow.io/over"]);
  assert.deepEqual(hosts, ["www.klant.be"]);
});

test("isFilenameLike", () => {
  for (const alt of ["IMG_1234.jpg", "hero-image-2x", "DSC0001", "DSC00028 (1)-min", "screenshot 3", "PXL_20240101_120000", "image", "Foto 2", "untitled"]) {
    assert.equal(isFilenameLike(alt), true, alt);
  }
  for (const alt of ["Team aan het werk in Gent", "Logo", "Skrol logo", "PXL", "IMG Studio", "Covid-19", "Leen Stulens"]) {
    assert.equal(isFilenameLike(alt), false, alt);
  }
});

test("testPageWord: test- en kopiepagina's, geen woorden die er toevallig op lijken", () => {
  assert.equal(testPageWord("/partners-realisaties/test-realisatie-02"), "test");
  assert.equal(testPageWord("/evenementen-events/extra-event-test"), "test");
  assert.equal(testPageWord("/over-copy"), "copy");
  assert.equal(testPageWord("/test2"), "test");
  for (const path of ["/", "/blog/testimonials", "/contest", "/diensten/copywriting"]) assert.equal(testPageWord(path), null, path);
});

test("componentOf: selector zonder volgnummers", () => {
  assert.equal(componentOf("div.list > div.item:nth-of-type(3) > a.logo > img"), "div.list > div.item > a.logo > img");
});

test("normalizeDomain: kaal domein uit URL of hostnaam", () => {
  assert.equal(normalizeDomain("https://www.In4care.be/zorgvinding"), "in4care.be");
  assert.equal(normalizeDomain("klant.be"), "klant.be");
  assert.equal(normalizeDomain("www.klant.be."), "klant.be");
  for (const bad of ["", "geen domein", "localhost"]) assert.equal(normalizeDomain(bad), null, bad);
});

test("badge: op .webflow.io na te kijken, op een eigen domein een zekere bug", () => {
  const data: RawPageData = {
    title: "T",
    lang: "nl",
    headings: [{ level: 1, text: "T", visible: true, selector: "h1" }],
    images: [],
    textHits: [],
    forms: [],
    emptyStates: [],
    icons: ["/favicon.png"],
    touchIcons: ["/webclip.png"],
    hasBadge: true,
    links: [],
  };
  const staging = pageDrafts(data, "/", { onWebflowIo: true });
  const live = pageDrafts(data, "/", { onWebflowIo: false });
  assert.equal(staging.length, 1);
  assert.equal(staging[0].label, "na te kijken");
  assert.equal(live.length, 1);
  assert.equal(live[0].label, undefined);
});

test("inputIssues: standaardnaam en verkeerd type", () => {
  const issues = inputIssues({
    dataName: "Contact",
    name: null,
    selector: "form",
    successText: null,
    errorText: null,
    inputs: [
      { name: "Field 2", type: "text", tag: "input", id: "", placeholder: "", label: "Bedrijf", selector: "a" },
      { name: "email", type: "text", tag: "input", id: "email", placeholder: "", label: "E-mail", selector: "b" },
      { name: "Telefoon", type: "tel", tag: "input", id: "", placeholder: "", label: "Telefoon", selector: "c" },
    ],
  });
  assert.deepEqual(issues.map((i) => i.selector), ["a", "b"]);
});

test("overflowDrafts: scrollen en verborgen overloop", () => {
  const m = (canScrollX: boolean, hiddenByOverflow: boolean) => ({ viewportWidth: 390, scrollWidth: 600, canScrollX, hiddenByOverflow, offenders: [{ selector: "div.x", right: 600, width: 600 }] });
  const drafts = overflowDrafts([{ width: 390, m: m(true, false) }, { width: 360, m: m(true, false) }, { width: 768, m: m(false, true) }], "/p");
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].viewport, 360);
  assert.equal(drafts[1].label, "na te kijken");
});

test("authorized: API-sleutel via header of Bearer", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as never;
  assert.equal(authorized(req({}), ""), true);
  assert.equal(authorized(req({}), "geheim"), false);
  assert.equal(authorized(req({ "x-api-key": "geheim" }), "geheim"), true);
  assert.equal(authorized(req({ authorization: "Bearer geheim" }), "geheim"), true);
  assert.equal(authorized(req({ authorization: "Bearer fout" }), "geheim"), false);
});
