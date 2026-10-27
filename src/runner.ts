import { createHash } from "node:crypto";
import type { Page } from "playwright";
import type { Config } from "./config.js";
import { guardedContext, launchChromium } from "./browser.js";
import { isLikelyHtml, normalizeDomain, normalizeLinkUrl, normalizePageUrl, pathOf, readSitemap } from "./discover.js";
import { checkLink, fetchWithGuard, mapLimit, type LinkStatus } from "./links.js";
import { fontDrafts, hoverDraft, layoutDrafts, overflowDrafts, pageDrafts, styleDefaultDrafts, type Draft } from "./checks.js";
import { navigationDrafts } from "./navigation.js";
import { migrationDrafts } from "./migration.js";
import { folderOf, parseSeo, seoDrafts, type SeoPage } from "./seo.js";
import { readWebflow, webflowDrafts, webflowSummary } from "./webflow.js";
import {
  AUTO_SCROLL,
  COLLECT_PAGE_DATA,
  hoverSignatureScript,
  hoverStaticScript,
  type HoverStatic,
  LIST_HOVER_TARGETS,
  MARK_PAIRS,
  MEASURE_LAYOUT,
  MEASURE_OVERFLOW,
  STYLE_DEFAULTS,
  type HoverTarget,
  type RawLayout,
  type RawStyleDefaults,
  type RawLink,
  type RawOverflow,
  type RawPageData,
} from "./page-scripts.js";
import {
  CHECKS,
  MIGRATION_CHECKS,
  WEBFLOW_CHECKS,
  type CheckupSummary,
  type Finding,
  type Hint,
  type MigrationSummary,
  type PageResult,
  type WebflowSummary,
} from "./types.js";
import { matchesDomain, type UrlGuard } from "./url-guard.js";

export interface Progress {
  pagesDone: number;
  pagesFound: number;
  phase: string;
}

export interface CheckupOptions {
  /** Live domein van de klant, bv. "klant.be". Leeg = uit sitemap.xml halen als dat kan. */
  liveDomain?: string;
  /** Enkel voor tests: waar de oude site staat, in plaats van https://www.{live domein}. */
  oldSiteCandidates?: string[];
}

export interface CheckupResult {
  startUrl: string;
  pages: PageResult[];
  findings: Finding[];
  summary: CheckupSummary;
}

const HINT_ORDER: Record<Hint, number> = { hoog: 0, midden: 1, laag: 2 };
const EMPTY_LINK_EXEMPT = /\b(w-lightbox|w-dropdown-toggle|w-nav-button|w-tab-link|w-slider-arrow|w-slider-dot)\b/;

interface LinkOccurrence {
  link: RawLink;
  page: string;
}

function findingId(check: string, key: string): string {
  return createHash("sha1").update(`${check}|${key}`).digest("hex").slice(0, 10);
}

class FindingSet {
  private map = new Map<string, Finding>();

  add(draft: Draft, page: string): void {
    const mapKey = `${draft.info.id}|${draft.key}`;
    const existing = this.map.get(mapKey);
    if (existing) {
      if (!existing.pages.includes(page)) existing.pages.push(page);
      return;
    }
    const { info, key: _key, hint, ...rest } = draft;
    this.map.set(mapKey, {
      id: findingId(info.id, draft.key),
      check: info.id,
      item: info.item,
      category: info.category,
      hint: hint ?? info.hint,
      pages: [page],
      browser: "chromium",
      ...rest,
    });
  }

  list(): Finding[] {
    return [...this.map.values()].sort(
      (a, b) => HINT_ORDER[a.hint] - HINT_ORDER[b.hint] || a.check.localeCompare(b.check) || a.pages[0].localeCompare(b.pages[0]),
    );
  }
}

/** Hoeveel nieuwe soorten links en knoppen per pagina op hover getest worden. */
const HOVER_PER_PAGE = 10;

/**
 * Verandert er iets aan het element (of zijn ::before/::after en afstammelingen) als de muis erover gaat?
 * null: kon niet getest worden, bv. omdat er een pop-up over het element ligt.
 */
async function hoverChanges(page: Page, selector: string): Promise<boolean | null> {
  const locator = page.locator(selector).first();
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 2_000 });
    await page.mouse.move(1, 1);
    await page.waitForTimeout(250);
    const before = await page.evaluate(hoverSignatureScript(selector));
    if (before === null) return null;
    await locator.hover({ timeout: 2_000 });
    await page.waitForTimeout(450);
    const after = await page.evaluate(hoverSignatureScript(selector));
    await page.mouse.move(1, 1);
    return before !== after;
  } catch {
    return null;
  }
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
}

export async function runCheckup(
  startInput: string,
  config: Config,
  guard: UrlGuard,
  onProgress: (p: Progress) => void = () => undefined,
  options: CheckupOptions = {},
): Promise<CheckupResult> {
  const startUrl = normalizePageUrl(startInput);
  if (!startUrl) throw new Error(`Ongeldige URL: ${startInput}`);
  if (!guard.isAllowedPage(startUrl)) {
    throw new Error(`Domein niet toegestaan: ${new URL(startUrl).hostname}. Voeg het toe aan ALLOWED_DOMAINS.`);
  }
  if (await guard.resolvesToPrivate(new URL(startUrl).hostname)) throw new Error("Intern adres geblokkeerd.");
  const origin = new URL(startUrl).origin;
  const startHost = new URL(startUrl).hostname;
  const onWebflowIo = matchesDomain(startHost, ["*.webflow.io"]);

  const findings = new FindingSet();
  const pages: PageResult[] = [];
  const pageStatus = new Map<string, number | null>();
  const occurrences: LinkOccurrence[] = [];
  const fontRequests = new Map<string, string>();
  const hoverDone = new Set<string>();
  const hoverAttempts = new Map<string, number>();
  /** SEO-gegevens per pad, uit de HTML die de server teruggaf. */
  const seoPages = new Map<string, SeoPage>();

  onProgress({ pagesDone: 0, pagesFound: 1, phase: "sitemap lezen" });
  const sitemap = await readSitemap(origin, async (url) => {
    try {
      const res = await fetchWithGuard(url, "GET", config, guard);
      return res.status === 200 ? res.body ?? null : null;
    } catch {
      return null;
    }
  });

  // Live domein: opgegeven, of het domein uit de sitemap als dat niet de staging-site zelf is.
  let liveDomain: string | undefined;
  let liveDomainSource: CheckupSummary["liveDomainSource"];
  if (options.liveDomain) {
    const given = normalizeDomain(options.liveDomain);
    if (!given) throw new Error(`Ongeldig live domein: ${options.liveDomain}`);
    liveDomain = given;
    liveDomainSource = "opgegeven";
  } else {
    const fromSitemap = sitemap.hosts
      .map(normalizeDomain)
      .find((h): h is string => !!h && !matchesDomain(startHost, [h]) && !matchesDomain(h, ["*.webflow.io"]));
    if (fromSitemap) {
      liveDomain = fromSitemap;
      liveDomainSource = "sitemap";
    }
  }

  const queue: string[] = [startUrl];
  const seen = new Set<string>([startUrl]);
  for (const url of sitemap.pages) {
    if (!seen.has(url)) {
      seen.add(url);
      queue.push(url);
    }
  }
  let stoppedAtMaxPages = false;
  let active = 0;
  let started = 0;

  const browser = await launchChromium(config);
  try {
    const context = await guardedContext(browser, config, guard);

    const visit = async (url: string): Promise<void> => {
      const path = pathOf(url);
      const page = await context.newPage();
      page.on("response", (res) => {
        const u = res.url();
        // Enkel fonts van de pagina zelf: een ingesloten video (YouTube) laadt eigen fonts.
        if (res.frame() !== page.mainFrame()) return;
        if ((res.request().resourceType() === "font" || /\/\/fonts\.googleapis\.com\//i.test(u)) && !fontRequests.has(u)) fontRequests.set(u, path);
      });
      try {
        await page.setViewportSize(config.viewports[0]);
        let status: number | null = null;
        let error: string | undefined;
        let html: string | null = null;
        try {
          const response = await page.goto(url, { waitUntil: "load", timeout: config.pageTimeoutMs });
          status = response?.status() ?? null;
          html = response ? await response.text().catch(() => null) : null;
        } catch (e) {
          error = (e as Error).message.split("\n")[0];
        }
        const finalUrl = page.url();
        const result: PageResult = { url, path, status, finalUrl, error };
        pages.push(result);
        pageStatus.set(url, error ? null : status);
        if (error || status === null || status >= 400) return;
        if (new URL(finalUrl).origin !== origin) return;
        if (html) {
          try {
            seoPages.set(pathOf(finalUrl), parseSeo(html, finalUrl));
          } catch (e) {
            result.analysisError = `seo: ${(e as Error).message.split("\n")[0]}`;
          }
        }
        await settle(page);
        // Eén keer door de pagina scrollen: lazy afbeeldingen laden en scroll-animaties spelen af.
        await page.evaluate(AUTO_SCROLL).catch(() => undefined);
        await settle(page);

        let data: RawPageData;
        try {
          data = (await page.evaluate(COLLECT_PAGE_DATA)) as RawPageData;
        } catch (e) {
          result.analysisError = (e as Error).message.split("\n")[0];
          return;
        }
        for (const draft of pageDrafts(data, path, { onWebflowIo })) findings.add(draft, path);

        // Stijl en hover, op de brede viewport.
        try {
          const styles = (await page.evaluate(STYLE_DEFAULTS)) as RawStyleDefaults;
          for (const draft of styleDefaultDrafts(styles)) findings.add(draft, path);
          const targets = (await page.evaluate(LIST_HOVER_TARGETS)) as HoverTarget[];
          let tested = 0;
          for (const target of targets) {
            if (tested >= HOVER_PER_PAGE) break;
            const attempts = hoverAttempts.get(target.component) ?? 0;
            if (hoverDone.has(target.component) || attempts >= 3) continue;
            hoverAttempts.set(target.component, attempts + 1);
            const changed = await hoverChanges(page, target.selector);
            if (changed === null) continue;
            hoverDone.add(target.component);
            tested++;
            if (changed) continue;
            // Niets zien veranderen is niet genoeg: kijk ook in de CSS en naar Webflow-interacties.
            const statik = (await page.evaluate(hoverStaticScript(target.selector))) as HoverStatic | null;
            if (statik && !statik.cssHoverRule && !statik.interaction) findings.add(hoverDraft(target, statik), path);
          }
          await page.evaluate("window.scrollTo(0, 0)");
        } catch (e) {
          result.analysisError = (e as Error).message.split("\n")[0];
        }

        // Een fout in de lay-outmetingen mag de rest van de pagina niet tegenhouden.
        try {
          await page.evaluate(MARK_PAIRS);
          const overflow: Array<{ width: number; m: RawOverflow }> = [];
          const layout: Array<{ width: number; l: RawLayout }> = [];
          for (const viewport of config.viewports) {
            await page.setViewportSize(viewport);
            await page.waitForTimeout(300);
            overflow.push({ width: viewport.width, m: (await page.evaluate(MEASURE_OVERFLOW)) as RawOverflow });
            layout.push({ width: viewport.width, l: (await page.evaluate(MEASURE_LAYOUT)) as RawLayout });
          }
          for (const draft of overflowDrafts(overflow, path)) findings.add(draft, path);
          for (const draft of layoutDrafts(layout, path)) findings.add(draft, path);
        } catch (e) {
          result.analysisError = (e as Error).message.split("\n")[0];
        }

        for (const link of data.links) {
          occurrences.push({ link, page: path });
          const target = normalizePageUrl(link.href);
          if (!target || new URL(target).origin !== origin || !isLikelyHtml(target) || seen.has(target)) continue;
          seen.add(target);
          queue.push(target);
        }
      } finally {
        await page.close().catch(() => undefined);
      }
    };

    const worker = async (): Promise<void> => {
      for (;;) {
        const next = queue.shift();
        if (!next) {
          if (active === 0) return;
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        if (started >= config.maxPages) {
          stoppedAtMaxPages = true;
          queue.length = 0;
          if (active === 0) return;
          continue;
        }
        started++;
        active++;
        try {
          await visit(next);
        } finally {
          active--;
          onProgress({ pagesDone: pages.length, pagesFound: seen.size, phase: "pagina's controleren" });
        }
      }
    };
    await Promise.all(Array.from({ length: config.pageConcurrency }, worker));

    onProgress({ pagesDone: pages.length, pagesFound: seen.size, phase: "navigatie controleren" });
    try {
      for (const draft of await navigationDrafts(context, startUrl, config.pageTimeoutMs)) findings.add(draft, pathOf(startUrl));
    } catch (e) {
      const start = pages.find((p) => p.url === startUrl);
      if (start) start.analysisError = `navigatie: ${(e as Error).message.split("\n")[0]}`;
    }
    await context.close();
  } finally {
    await browser.close();
  }

  const startPage = pages.find((p) => p.url === startUrl);
  if (!startPage || startPage.error || startPage.status === null || startPage.status >= 400) {
    throw new Error(`Startpagina niet bereikbaar: ${startPage?.error ?? `HTTP ${startPage?.status}`}`);
  }

  for (const { draft, page } of fontDrafts(fontRequests)) findings.add(draft, page);

  // SEO over de hele site.
  onProgress({ pagesDone: pages.length, pagesFound: seen.size, phase: "SEO controleren" });
  const robots = await fetchWithGuard(new URL("/robots.txt", origin).toString(), "GET", config, guard).catch(() => null);
  const deadPaths = sitemap.pages.filter((u) => {
    const s = pageStatus.get(u);
    return s === null || (typeof s === "number" && s >= 400);
  });
  const siteDrafts = seoDrafts(
    [...seoPages].map(([path, seo]) => ({ path, seo })),
    {
      startPath: pathOf(startUrl),
      onWebflowIo,
      robotsTxt: robots && robots.status === 200 ? (robots.body ?? "") : null,
      sitemap: { found: sitemap.found, paths: sitemap.pages.map(pathOf), hosts: sitemap.hosts, deadPaths: deadPaths.map(pathOf) },
    },
  );
  for (const { draft, pages: on } of siteDrafts) for (const p of on) findings.add(draft, p);
  const skipped: Array<{ check: string; reason: string }> = [];

  // Webflow-lezer: CMS, paginanamen, drafts en tijdzone uit de Webflow API.
  let webflow: WebflowSummary | undefined;
  onProgress({ pagesDone: pages.length, pagesFound: seen.size, phase: "Webflow lezen" });
  const wf = await readWebflow(config, startHost).catch((e: Error) => ({ skipped: `fout bij het lezen van Webflow: ${e.message.split("\n")[0]}` }));
  if ("skipped" in wf) for (const check of WEBFLOW_CHECKS) skipped.push({ check, reason: wf.skipped });
  else {
    webflow = webflowSummary(wf);
    // Waar de CMS-pagina's van elke collectie staan, volgens de crawl (data-wf-collection op de pagina).
    const byCollection = new Map<string, string[]>();
    for (const [p, seo] of seoPages) if (seo.wfCollection) byCollection.set(seo.wfCollection, [...(byCollection.get(seo.wfCollection) ?? []), p]);
    const collectionFolders = new Map([...byCollection].map(([id, paths]) => [id, folderOf(paths)] as const));
    for (const { draft, pages: on } of webflowDrafts(wf, { startPath: pathOf(startUrl), liveDomain, collectionFolders })) {
      for (const p of on) findings.add(draft, p);
    }
  }

  // Migratie: de oude site op het live domein vergelijken met de nieuwe.
  let migration: MigrationSummary | undefined;
  if (liveDomain) {
    onProgress({ pagesDone: pages.length, pagesFound: seen.size, phase: "oude site vergelijken" });
    const result = await migrationDrafts(
      liveDomain,
      origin,
      seoPages,
      pageStatus,
      config,
      guard,
      (done, total) => onProgress({ pagesDone: pages.length, pagesFound: seen.size, phase: `oude site vergelijken (${done}/${total})` }),
      options.oldSiteCandidates,
    ).catch((e: Error) => ({ skipped: `fout bij het lezen van de oude site: ${e.message.split("\n")[0]}` }));
    if ("skipped" in result) for (const check of MIGRATION_CHECKS) skipped.push({ check, reason: result.skipped });
    else {
      migration = result.summary;
      for (const { draft, pages: on } of result.drafts) for (const p of on) findings.add(draft, p);
    }
  } else {
    for (const check of MIGRATION_CHECKS) skipped.push({ check, reason: "geen live domein opgegeven of in de sitemap gevonden" });
  }

  onProgress({ pagesDone: pages.length, pagesFound: seen.size, phase: "links controleren" });
  await checkAllLinks(occurrences, origin, liveDomain, pageStatus, config, guard, findings);

  const list = findings.list();
  const summary: CheckupSummary = {
    pages: pages.length,
    pagesWithErrors: pages.filter((p) => p.error || (p.status ?? 0) >= 400).length,
    findings: list.length,
    byHint: { hoog: 0, midden: 0, laag: 0 },
    byCheck: {},
    stoppedAtMaxPages,
    ...(pages.some((p) => p.analysisError) ? { analysisErrors: pages.filter((p) => p.analysisError).length } : {}),
    ...(liveDomain ? { liveDomain, liveDomainSource } : {}),
    ...(migration ? { migration } : {}),
    ...(webflow ? { webflow } : {}),
    ...(skipped.length > 0 ? { skipped } : {}),
  };
  for (const f of list) {
    summary.byHint[f.hint]++;
    summary.byCheck[f.check] = (summary.byCheck[f.check] ?? 0) + 1;
  }
  onProgress({ pagesDone: pages.length, pagesFound: seen.size, phase: "klaar" });
  return { startUrl, pages, findings: list, summary };
}

type LinkKind = "internal" | "live" | "external";

async function checkAllLinks(
  occurrences: LinkOccurrence[],
  origin: string,
  liveDomain: string | undefined,
  pageStatus: Map<string, number | null>,
  config: Config,
  guard: UrlGuard,
  findings: FindingSet,
): Promise<void> {
  // checkUrl: wat er echt opgevraagd wordt. Een link naar het live domein wordt op de nieuwe site gecontroleerd,
  // want na de lancering draait die site op dat domein.
  const targets = new Map<string, { kind: LinkKind; checkUrl: string; pages: Set<string>; texts: Set<string> }>();

  for (const { link, page } of occurrences) {
    const raw = link.raw.trim();
    if (raw === "" || raw === "#" || /^javascript:/i.test(raw)) {
      if (EMPTY_LINK_EXEMPT.test(link.className) || link.role === "button") continue;
      findings.add(
        {
          info: CHECKS.emptyLinks,
          key: `${link.selector}|${raw}`,
          element: link.selector,
          message: `Link zonder bestemming (href="${raw}")${link.text ? ` met tekst "${link.text}"` : ""}.`,
          evidence: { href: raw, text: link.text },
        },
        page,
      );
      continue;
    }
    if (/^(mailto|tel|sms):/i.test(raw) || raw.startsWith("#")) continue;
    const url = normalizeLinkUrl(link.href);
    if (!url) continue;
    const u = new URL(url);
    let kind: LinkKind = "external";
    let checkUrl = url;
    if (u.origin === origin) kind = "internal";
    else if (liveDomain && matchesDomain(u.hostname, [liveDomain])) {
      kind = "live";
      checkUrl = new URL(u.pathname + u.search, origin).toString();
    }
    const entry = targets.get(url) ?? { kind, checkUrl, pages: new Set<string>(), texts: new Set<string>() };
    entry.pages.add(page);
    if (link.text) entry.texts.add(link.text);
    targets.set(url, entry);
  }

  const urls = [...targets.keys()];
  const results = await mapLimit(urls, config.linkConcurrency, async (url): Promise<LinkStatus> => {
    const entry = targets.get(url)!;
    if (entry.kind !== "external") {
      const asPage = normalizePageUrl(entry.checkUrl);
      const known = asPage ? pageStatus.get(asPage) : undefined;
      if (typeof known === "number") {
        return { url, verdict: known >= 400 ? "broken" : "ok", status: known, finalUrl: entry.checkUrl, reason: known >= 400 ? `HTTP ${known}` : undefined };
      }
    }
    const status = await checkLink(entry.checkUrl, config, guard);
    return { ...status, url };
  });

  for (const result of results) {
    if (result.verdict === "ok") continue;
    const entry = targets.get(result.url)!;
    const shown = entry.kind === "internal" ? pathOf(result.url) : result.url;
    const review = result.verdict === "review";
    let message: string;
    if (review) message = `Link naar ${shown} kon niet zeker gecontroleerd worden (${result.reason}).`;
    else if (entry.kind === "live") {
      message = `Link naar het live domein (${result.url}) werkt niet na de lancering: ${pathOf(entry.checkUrl)} bestaat niet op de nieuwe site (${result.reason}).`;
    } else message = `${entry.kind === "internal" ? "Interne" : "Externe"} link naar ${shown} werkt niet (${result.reason}).`;
    const draft: Draft = {
      info: CHECKS.brokenLinks,
      key: result.url,
      hint: review ? "laag" : entry.kind === "external" ? "midden" : "hoog",
      label: review ? "na te kijken" : undefined,
      message,
      evidence: {
        url: result.url,
        ...(entry.kind === "live" ? { checkedUrl: entry.checkUrl } : {}),
        status: result.status,
        reason: result.reason,
        finalUrl: result.finalUrl,
        linkTexts: [...entry.texts].slice(0, 5),
      },
    };
    for (const page of entry.pages) findings.add(draft, page);
  }
}
