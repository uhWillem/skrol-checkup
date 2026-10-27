import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { Browser, BrowserContext } from "playwright";
import { guardedContext, launchChromium } from "../src/browser.js";
import { navigationDrafts } from "../src/navigation.js";
import { UrlGuard } from "../src/url-guard.js";
import { startExternal, startSite, testConfig } from "./helpers.js";

let site: { server: Server; origin: string };
let external: { server: Server; origin: string };
let browser: Browser;
let context: BrowserContext;

before(async () => {
  external = await startExternal();
  site = await startSite(external.origin);
  const config = await testConfig();
  browser = await launchChromium(config);
  context = await guardedContext(browser, config, new UrlGuard(config.allowedDomains, config.allowPrivateNetworks));
});

after(async () => {
  await browser.close();
  site.server.close();
  external.server.close();
});

test("navigatie in orde: geen bevindingen", async () => {
  const drafts = await navigationDrafts(context, `${site.origin}/nav-goed`, 15_000);
  assert.deepEqual(drafts.map((d) => d.message), []);
});

test("navigatie die verdwijnt bij naar beneden scrollen en terugkomt bij naar boven scrollen: in orde", async () => {
  const drafts = await navigationDrafts(context, `${site.origin}/nav-verdwijnt`, 15_000);
  assert.deepEqual(drafts.map((d) => d.message), []);
});

test("navigatie fout: niet sticky, pagina scrolt mee, menu past niet, logo", async () => {
  const drafts = await navigationDrafts(context, `${site.origin}/nav-fout`, 15_000);
  const byCheck = new Map(drafts.map((d) => [d.info.id, d]));
  assert.deepEqual([...byCheck.keys()].sort(), ["logo-format", "logo-link", "nav-menu-fit", "nav-scroll-lock", "nav-sticky"], drafts.map((d) => d.message).join("\n"));
  assert.equal(byCheck.get("nav-sticky")?.label, "na te kijken");
  assert.equal(byCheck.get("nav-menu-fit")?.info.hint, "hoog");
  assert.ok(Number(byCheck.get("nav-menu-fit")?.evidence?.hidden) > 0);
  assert.match(String(byCheck.get("logo-link")?.message), /\/over/);
  assert.match(String(byCheck.get("logo-format")?.message), /logo\.png/);
});
