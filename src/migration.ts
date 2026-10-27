// Migratie: vervangt de nieuwe site een bestaande site op het live domein, dan moet elke oude pagina
// na de lancering nog werken (zelfde pad of een redirect), met dezelfde SEO-titel en description.
// De oude site wordt enkel met gewone verzoeken gelezen (geen browser), met een vast maximum aan pagina's.

import type { Config } from "./config.js";
import { isLikelyHtml, normalizeLinkUrl, normalizePageUrl, pathOf } from "./discover.js";
import { fetchWithGuard, mapLimit } from "./links.js";
import { parseSeo, type SeoPage, type SiteDraft } from "./seo.js";
import { CHECKS, type MigrationSummary } from "./types.js";
import { matchesDomain, type UrlGuard } from "./url-guard.js";

/** Maximum aantal oude pagina's dat vergeleken wordt. */
export const MIGRATION_MAX = 300;
const MAX_CHILD_SITEMAPS = 20;
const EVIDENCE_MAX = 150;

type FetchText = (url: string) => Promise<{ status: number; finalUrl: string; body?: string } | null>;

export interface OldPage {
  path: string;
  title: string | null;
  description: string | null;
}

interface Outcome {
  old: OldPage;
  kind: "same" | "redirected" | "missing" | "failed";
  /** Pad op de nieuwe site waar het oude pad uitkomt. */
  target?: string;
  reason?: string;
  seo?: SeoPage;
}

/** Pad zoals Webflow het gebruikt: zonder slash op het einde, zonder zoekparameters. */
function cleanPath(url: string): string | null {
  const n = normalizePageUrl(url);
  return n ? pathOf(n) : null;
}

const norm = (s: string | null): string => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Alle <loc>-adressen uit een sitemap, met sitemap-indexen één niveau diep. */
export async function sitemapLocs(urls: string[], fetchText: FetchText): Promise<string[]> {
  const locs: string[] = [];
  const children: string[] = [];
  for (const url of urls) {
    const res = await fetchText(url);
    if (!res || res.status !== 200 || !res.body || !/<(urlset|sitemapindex)\b/i.test(res.body)) continue;
    const found = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex\b/i.test(res.body)) children.push(...found);
    else locs.push(...found);
    if (locs.length > 0 || children.length > 0) break;
  }
  for (const child of children.slice(0, MAX_CHILD_SITEMAPS)) {
    const res = await fetchText(child);
    if (res?.status === 200 && res.body) locs.push(...[...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&")));
  }
  return locs;
}

/**
 * Vergelijkt de oude site op het live domein met de nieuwe site.
 * Geeft null terug (met een reden) als de oude site niet te lezen is.
 */
export async function migrationDrafts(
  liveDomain: string,
  origin: string,
  newPages: Map<string, SeoPage>,
  newStatus: Map<string, number | null>,
  config: Config,
  guard: UrlGuard,
  onProgress: (done: number, total: number) => void = () => undefined,
  /** Waar de oude site kan staan; standaard https://www.{domein} en https://{domein}. */
  candidates: string[] = [`https://www.${liveDomain}/`, `https://${liveDomain}/`],
): Promise<{ drafts: SiteDraft[]; summary: MigrationSummary } | { skipped: string }> {
  const fetchText: FetchText = async (url) => {
    try {
      return await fetchWithGuard(url, "GET", config, guard);
    } catch {
      return null;
    }
  };
  let oldPort: string | null = null;
  const onOld = (url: string): boolean => {
    try {
      const u = new URL(url);
      return matchesDomain(u.hostname, [liveDomain]) && (oldPort === null || u.port === oldPort);
    } catch {
      return false;
    }
  };

  // De oude site: eerst www., dan zonder; het adres na de redirects is de echte oorsprong.
  let oldOrigin: string | null = null;
  let homeBody: string | undefined;
  for (const candidate of candidates) {
    const res = await fetchText(candidate);
    if (res && res.status < 400 && onOld(res.finalUrl)) {
      oldOrigin = new URL(res.finalUrl).origin;
      oldPort = new URL(res.finalUrl).port;
      homeBody = res.body;
      break;
    }
  }
  if (!oldOrigin) return { skipped: `de oude site op ${liveDomain} is niet bereikbaar` };
  if (new URL(oldOrigin).origin === new URL(origin).origin) return { skipped: "het live domein is dezelfde site als de gecontroleerde site" };

  // Oude pagina's: uit de sitemap (ook die in robots.txt), anders door de oude site te doorlopen.
  const robots = await fetchText(`${oldOrigin}/robots.txt`);
  const robotsSitemaps = robots?.status === 200 && robots.body ? [...robots.body.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]) : [];
  const locs = await sitemapLocs([...robotsSitemaps, `${oldOrigin}/sitemap.xml`], fetchText);
  let source: MigrationSummary["source"] = "sitemap";
  // Pad zoals Webflow het gebruikt → het adres zoals de oude site het noemt (soms met een slash op het einde).
  const oldPaths = new Map<string, string>();
  for (const loc of locs) {
    if (!onOld(loc) || !isLikelyHtml(loc)) continue;
    const p = cleanPath(loc);
    if (p && !oldPaths.has(p)) oldPaths.set(p, loc);
  }

  const oldPages = new Map<string, OldPage>();
  let truncated = false;
  if (oldPaths.size === 0) {
    // Geen bruikbare sitemap: de oude site doorlopen via haar links.
    source = "crawl";
    // [pad zoals Webflow het gebruikt, adres zoals de oude site het noemt]
    const queue: Array<[string, string]> = [["/", `${oldOrigin}/`]];
    const seen = new Set<string>(["/"]);
    while (queue.length > 0 && oldPages.size < MIGRATION_MAX) {
      const batch = queue.splice(0, config.linkConcurrency);
      await mapLimit(batch, config.linkConcurrency, async ([path, url]) => {
        const res = path === "/" && homeBody !== undefined ? { status: 200, finalUrl: url, body: homeBody } : await fetchText(url);
        if (!res || res.status !== 200 || !res.body || !onOld(res.finalUrl) || oldPages.size >= MIGRATION_MAX) return;
        const seo = parseSeo(res.body, res.finalUrl);
        oldPages.set(path, { path, title: seo.title, description: seo.description });
        for (const link of seo.links) {
          if (!onOld(link) || !isLikelyHtml(link)) continue;
          const p = cleanPath(link);
          if (!p || seen.has(p)) continue;
          seen.add(p);
          queue.push([p, normalizeLinkUrl(link)?.replace(/\?.*$/, "") ?? link]);
        }
      });
      onProgress(oldPages.size, Math.min(seen.size, MIGRATION_MAX));
    }
    truncated = queue.length > 0;
  } else {
    const paths = [...oldPaths];
    truncated = paths.length > MIGRATION_MAX;
    let done = 0;
    await mapLimit(paths.slice(0, MIGRATION_MAX), config.linkConcurrency, async ([path, loc]) => {
      const res = await fetchText(loc);
      done++;
      onProgress(done, Math.min(paths.length, MIGRATION_MAX));
      // Een pagina die op de oude site zelf al weg is, hoeft niet mee.
      if (!res || res.status !== 200 || !res.body) return;
      const seo = parseSeo(res.body, res.finalUrl);
      oldPages.set(path, { path, title: seo.title, description: seo.description });
    });
  }
  if (oldPages.size === 0) return { skipped: `geen pagina's gevonden op de oude site ${oldOrigin}` };

  // Elk oud pad op de nieuwe site opvragen.
  const outcomes = await mapLimit([...oldPages.values()], config.linkConcurrency, async (old): Promise<Outcome> => {
    const url = new URL(old.path, origin).toString();
    const known = newStatus.get(normalizePageUrl(url) ?? url);
    if (known === 200 && newPages.has(old.path)) return { old, kind: "same", target: old.path, seo: newPages.get(old.path) };
    const res = await fetchText(url);
    if (!res) return { old, kind: "failed", reason: "geen antwoord" };
    if (res.status >= 400) return { old, kind: "missing", reason: `HTTP ${res.status}` };
    if (new URL(res.finalUrl).origin !== new URL(origin).origin) return { old, kind: "failed", reason: `verwijst naar ${res.finalUrl}` };
    const target = cleanPath(res.finalUrl) ?? old.path;
    const seo = newPages.get(target) ?? (res.body ? parseSeo(res.body, res.finalUrl) : undefined);
    return { old, kind: target === old.path ? "same" : "redirected", target, seo };
  });

  const summary: MigrationSummary = {
    oldSite: oldOrigin,
    source,
    oldPages: oldPages.size,
    same: outcomes.filter((o) => o.kind === "same").length,
    redirected: outcomes.filter((o) => o.kind === "redirected").length,
    missing: outcomes.filter((o) => o.kind === "missing").length,
    failed: outcomes.filter((o) => o.kind === "failed").length,
    truncated,
  };

  const drafts: SiteDraft[] = [];
  const host = new URL(oldOrigin).host;
  const missing = outcomes.filter((o) => o.kind === "missing").sort((a, b) => a.old.path.localeCompare(b.old.path));
  if (missing.length > 0) {
    drafts.push({
      draft: {
        info: CHECKS.redirects,
        key: "missing",
        message: `${missing.length} ${missing.length === 1 ? "pagina" : "pagina's"} van de oude site (${host}) ${missing.length === 1 ? "bestaat" : "bestaan"} niet op de nieuwe site en ${missing.length === 1 ? "heeft" : "hebben"} geen redirect: na de lancering geven ze een 404. Zet 301-redirects naar de nieuwe pagina's.`,
        evidence: { oldSite: oldOrigin, count: missing.length, paths: missing.slice(0, EVIDENCE_MAX).map((o) => o.old.path) },
      },
      pages: missing.map((o) => o.old.path),
    });
  }
  const redirected = outcomes.filter((o) => o.kind === "redirected").sort((a, b) => a.old.path.localeCompare(b.old.path));
  if (redirected.length > 0) {
    drafts.push({
      draft: {
        info: CHECKS.slugs,
        key: "changed",
        message: `${redirected.length} ${redirected.length === 1 ? "pagina heeft" : "pagina's hebben"} een ander pad dan op de oude site; er staat wel een redirect. De checklist vraagt dezelfde slugs als op de oude site.`,
        evidence: { oldSite: oldOrigin, count: redirected.length, redirects: redirected.slice(0, EVIDENCE_MAX).map((o) => ({ from: o.old.path, to: o.target })) },
      },
      pages: redirected.map((o) => o.old.path),
    });
  }

  // SEO-titel en description: gelijk aan de oude site?
  for (const field of ["title", "description"] as const) {
    const diffs = outcomes.filter((o) => o.seo && o.old[field] && norm(o.old[field]) !== norm(o.seo[field]));
    if (diffs.length === 0) continue;
    const name = field === "title" ? "SEO-titel" : "meta description";
    drafts.push({
      draft: {
        info: CHECKS.seoMigration,
        key: field,
        message: `${diffs.length} ${diffs.length === 1 ? "pagina heeft" : "pagina's hebben"} een andere ${name} dan op de oude site (${host}). Bij een migratie neem je die over, tenzij de klant nieuwe teksten aanlevert.`,
        evidence: {
          oldSite: oldOrigin,
          count: diffs.length,
          examples: diffs.slice(0, 40).map((o) => ({ oldPath: o.old.path, newPath: o.target, old: o.old[field], new: o.seo?.[field] ?? null })),
        },
      },
      pages: [...new Set(diffs.map((o) => o.target!))],
    });
  }
  return { drafts, summary };
}
