import { createHash } from "node:crypto";
import type { Page } from "playwright";
import type { Config } from "./config.js";
import { guardedContext, launchChromium } from "./browser.js";
import { isLikelyHtml, normalizeDomain, normalizeLinkUrl, normalizePageUrl, pathOf, readSitemap } from "./discover.js";
import { checkLink, fetchWithGuard, mapLimit, type LinkStatus } from "./links.js";
import { overflowDrafts, pageDrafts, type Draft } from "./checks.js";
import { COLLECT_PAGE_DATA, MEASURE_OVERFLOW, type RawLink, type RawOverflow, type RawPageData } from "./page-scripts.js";
import { CHECKS, type CheckupSummary, type Finding, type Hint, type PageResult } from "./types.js";
import { matchesDomain, type UrlGuard } from "./url-guard.js";

export interface Progress {
  pagesDone: number;
  pagesFound: number;
  phase: string;
}

export interface CheckupOptions {
  /** Live domein van de klant, bv. "klant.be". Leeg = uit sitemap.xml halen als dat kan. */
  liveDomain?: string;
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
      try {
        await page.setViewportSize(config.viewports[0]);
        let status: number | null = null;
        let error: string | undefined;
        try {
          const response = await page.goto(url, { waitUntil: "load", timeout: config.pageTimeoutMs });
          status = response?.status() ?? null;
        } catch (e) {
          error = (e as Error).message.split("\n")[0];
        }
        const finalUrl = page.url();
        pages.push({ url, path, status, finalUrl, error });
        pageStatus.set(url, error ? null : status);
        if (error || status === null || status >= 400) return;
        if (new URL(finalUrl).origin !== origin) return;
        await settle(page);

        const data = (await page.evaluate(COLLECT_PAGE_DATA)) as RawPageData;
        for (const draft of pageDrafts(data, path, { onWebflowIo })) findings.add(draft, path);

        const measurements: Array<{ width: number; m: RawOverflow }> = [];
        for (const viewport of config.viewports) {
          await page.setViewportSize(viewport);
          await page.waitForTimeout(300);
          measurements.push({ width: viewport.width, m: (await page.evaluate(MEASURE_OVERFLOW)) as RawOverflow });
        }
        for (const draft of overflowDrafts(measurements, path)) findings.add(draft, path);

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
    await context.close();
  } finally {
    await browser.close();
  }

  const startPage = pages.find((p) => p.url === startUrl);
  if (!startPage || startPage.error || startPage.status === null || startPage.status >= 400) {
    throw new Error(`Startpagina niet bereikbaar: ${startPage?.error ?? `HTTP ${startPage?.status}`}`);
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
    ...(liveDomain ? { liveDomain, liveDomainSource } : {}),
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
