// SEO-controles. Ze werken op de HTML die de server terugstuurt, dus wat een zoekmachine ziet,
// en niet op de pagina nadat de scripts gedraaid hebben. Dezelfde parser leest ook de oude site
// bij een migratie (zie migration.ts).

import { parse } from "node-html-parser";
import type { Draft } from "./checks.js";
import { CHECKS } from "./types.js";

export interface JsonLdBlock {
  valid: boolean;
  types: string[];
  error?: string;
}

export interface SeoPage {
  title: string | null;
  description: string | null;
  robots: string | null;
  canonical: string | null;
  ogImage: string | null;
  jsonLd: JsonLdBlock[];
  /** Webflow-ID van de pagina. Alle items van een CMS-template delen dezelfde ID. */
  wfPage: string | null;
  wfCollection: string | null;
  landmarks: { main: number; nav: number; footer: number };
  /** GTM-containers die de pagina laadt. */
  gtmIds: string[];
  /** Trackers die rechtstreeks in de HTML staan, buiten GTM. */
  directTrackers: string[];
  /** Er staat een FAQ-blok op de pagina (class met "faq"). */
  faq: boolean;
  /** Absolute links, voor het doorzoeken van een oude site. */
  links: string[];
}

const TRACKERS: Array<[RegExp, string]> = [
  [/googletagmanager\.com\/gtag\/js/i, "Google Analytics (gtag.js)"],
  [/google-analytics\.com\/(analytics|ga)\.js/i, "Google Analytics (analytics.js)"],
  [/connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init/i, "Meta Pixel"],
  [/static\.hotjar\.com|hotjar\.com\/c\/hotjar/i, "Hotjar"],
  [/snap\.licdn\.com|_linkedin_partner_id/i, "LinkedIn Insight Tag"],
  [/js\.hs-scripts\.com|js\.hs-analytics\.net/i, "HubSpot-tracking"],
  [/clarity\.ms\/tag/i, "Microsoft Clarity"],
  [/plausible\.io\/js/i, "Plausible"],
  [/cdn\.usefathom\.com/i, "Fathom"],
  [/analytics\.tiktok\.com/i, "TikTok Pixel"],
];

const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

function jsonLdTypes(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) jsonLdTypes(v, into);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") into.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") into.add(x);
  if (obj["@graph"]) jsonLdTypes(obj["@graph"], into);
}

export function parseSeo(html: string, url: string): SeoPage {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: false, noscript: false, pre: true } });
  const meta = (selector: string): string | null => {
    const el = root.querySelector(selector);
    return el ? clean(el.getAttribute("content")) : null;
  };
  const htmlEl = root.querySelector("html");
  const titleEl = root.querySelector("head title") ?? root.querySelector("title");
  const canonicalEl = root.querySelectorAll("link").find((l) => /(^|\s)canonical(\s|$)/i.test(l.getAttribute("rel") ?? ""));

  const jsonLd: JsonLdBlock[] = [];
  const gtm = new Set<string>();
  const trackers = new Set<string>();
  for (const script of root.querySelectorAll("script")) {
    const type = (script.getAttribute("type") ?? "").toLowerCase();
    const src = script.getAttribute("src") ?? "";
    const body = script.rawText ?? "";
    if (type === "application/ld+json") {
      try {
        const types = new Set<string>();
        jsonLdTypes(JSON.parse(body), types);
        jsonLd.push({ valid: true, types: [...types] });
      } catch (e) {
        jsonLd.push({ valid: false, types: [], error: (e as Error).message.slice(0, 120) });
      }
      continue;
    }
    const code = `${src}\n${body}`;
    if (/googletagmanager\.com\/gtm\.js/i.test(code)) for (const m of code.matchAll(/GTM-[A-Z0-9]{4,}/g)) gtm.add(m[0]);
    for (const [pattern, name] of TRACKERS) if (pattern.test(code)) trackers.add(name);
  }

  const links: string[] = [];
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    try {
      links.push(new URL(href, url).toString());
    } catch {
      // ongeldige link overslaan
    }
  }

  return {
    title: titleEl ? clean(titleEl.text) : null,
    description: meta('meta[name="description"]') ?? meta('meta[name="Description"]'),
    robots: meta('meta[name="robots"]'),
    canonical: canonicalEl ? clean(canonicalEl.getAttribute("href")) || null : null,
    ogImage: meta('meta[property="og:image"]'),
    jsonLd,
    wfPage: htmlEl?.getAttribute("data-wf-page") ?? null,
    wfCollection: htmlEl?.getAttribute("data-wf-collection") ?? null,
    landmarks: {
      main: root.querySelectorAll("main").length + root.querySelectorAll('[role="main"]').filter((e) => e.tagName !== "MAIN").length,
      nav: root.querySelectorAll("nav").length,
      footer: root.querySelectorAll("footer").length,
    },
    gtmIds: [...gtm],
    directTrackers: [...trackers],
    faq: root.querySelectorAll("[class]").some((e) => /(^|[\s_-])faq/i.test(e.getAttribute("class") ?? "")),
    links,
  };
}

/** Zegt robots.txt dat alle zoekmachines de hele site moeten overslaan? */
export function disallowsAll(robotsTxt: string): boolean {
  let applies = false;
  let inAgents = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!inAgents) applies = false;
      inAgents = true;
      if (value === "*") applies = true;
      continue;
    }
    inAgents = false;
    if (applies && field === "disallow" && value === "/") return true;
  }
  return false;
}

/** Lijkt het laatste woord van een pad meervoud? Bv. "projecten", "events". */
export function looksPlural(folder: string): boolean {
  const word = (folder.split("/").filter(Boolean).pop() ?? "").split("-").pop() ?? "";
  if (word.length < 4) return false;
  if (/^(nieuws|news|status|campus|focus|bus|plus|bonus|corpus|virus|canvas|analysis|basis|thesis|series|species)$/i.test(word)) return false;
  return /(s|en)$/i.test(word) && !/(ss|us|is)$/i.test(word);
}

export interface SeoEntry {
  path: string;
  seo: SeoPage;
}

export interface SeoContext {
  startPath: string;
  onWebflowIo: boolean;
  /** robots.txt van de gecontroleerde site; null als er geen is. */
  robotsTxt: string | null;
  sitemap: { found: boolean; paths: string[]; hosts: string[]; deadPaths: string[] };
}

export interface SiteDraft {
  draft: Draft;
  pages: string[];
}

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;
/** Scheidingsteken tussen paginatitel en merknaam: "Over ons | Klant", "Over ons – Klant", "Klant: Over ons". */
const SEPARATOR = /\||\s[–—·-]\s|:\s/;
const norm = (s: string): string => clean(s).toLowerCase();
const COPY_TITLE = /\bcopy of\b|\(copy\)|\bkopie van\b|\(kopie\)/i;

/** Gemeenschappelijke map van paden, bv. ["/blog/a", "/blog/b"] → "/blog". */
export function folderOf(paths: string[]): string {
  const parts = paths.map((p) => p.split("/").filter(Boolean));
  const common: string[] = [];
  for (let i = 0; i < Math.min(...parts.map((p) => p.length)) - 1; i++) {
    const seg = parts[0][i];
    if (parts.every((p) => p[i] === seg)) common.push(seg);
    else break;
  }
  return "/" + common.join("/");
}

function quote(s: string, max = 70): string {
  return `"${s.length > max ? `${s.slice(0, max)}…` : s}"`;
}

/** Bevindingen over titels, descriptions, CMS-SEO, schema, structuur, indexering, sitemap, domein, GTM en CMS-slugs. */
export function seoDrafts(entries: SeoEntry[], ctx: SeoContext): SiteDraft[] {
  const out: SiteDraft[] = [];
  const add = (draft: Draft, pages: string[]): void => {
    if (pages.length > 0) out.push({ draft, pages: [...new Set(pages)] });
  };

  // CMS-templates: pagina's met dezelfde Webflow-pagina-ID.
  const byTemplate = new Map<string, string[]>();
  for (const e of entries) if (e.seo.wfPage) byTemplate.set(e.seo.wfPage, [...(byTemplate.get(e.seo.wfPage) ?? []), e.path]);
  const templates = new Map<string, { id: string; paths: string[]; folder: string }>();
  for (const [id, paths] of byTemplate) {
    const isTemplate = paths.length >= 2 || entries.some((e) => e.seo.wfPage === id && e.seo.wfCollection);
    if (!isTemplate) continue;
    const t = { id, paths, folder: folderOf(paths) };
    for (const p of paths) templates.set(p, t);
  }
  const templateLabel = (t: { folder: string }): string => `${t.folder === "/" ? "" : t.folder}/…`;

  // Titels en descriptions.
  for (const field of ["title", "description"] as const) {
    const info = field === "title" ? CHECKS.seoTitle : CHECKS.seoDescription;
    const name = field === "title" ? "SEO-titel" : "meta description";
    const missingStatic: string[] = [];
    const missingByTemplate = new Map<string, string[]>();
    const groups = new Map<string, { text: string; paths: string[] }>();
    const long: Array<{ path: string; length: number; text: string }> = [];
    for (const e of entries) {
      const value = e.seo[field];
      const t = templates.get(e.path);
      if (!value) {
        if (t) missingByTemplate.set(t.id, [...(missingByTemplate.get(t.id) ?? []), e.path]);
        else missingStatic.push(e.path);
        continue;
      }
      const g = groups.get(norm(value)) ?? { text: value, paths: [] };
      g.paths.push(e.path);
      groups.set(norm(value), g);
      if (value.length > (field === "title" ? TITLE_MAX : DESCRIPTION_MAX)) long.push({ path: e.path, length: value.length, text: value });
    }
    add(
      {
        info,
        key: "missing",
        hint: field === "title" ? "hoog" : "midden",
        message: `Geen ${name} ingesteld.`,
      },
      missingStatic,
    );
    for (const [id, paths] of missingByTemplate) {
      const t = [...templates.values()].find((x) => x.id === id)!;
      add(
        {
          info: CHECKS.cmsSeo,
          key: `${field}-missing|${id}`,
          hint: field === "title" ? "hoog" : "midden",
          message: `CMS-pagina's onder ${templateLabel(t)} hebben geen ${name}: koppel ze in de template-instellingen aan een CMS-veld.`,
          evidence: { template: templateLabel(t), items: paths.length },
        },
        paths,
      );
    }
    for (const g of groups.values()) {
      if (g.paths.length < 2) continue;
      const t = templates.get(g.paths[0]);
      const wholeTemplate = t && t.paths.length === g.paths.length && g.paths.every((p) => templates.get(p) === t);
      if (wholeTemplate) {
        add(
          {
            info: CHECKS.cmsSeo,
            key: `${field}-static|${t.id}`,
            hint: field === "title" ? "hoog" : "midden",
            message: `Alle ${g.paths.length} CMS-pagina's onder ${templateLabel(t)} hebben dezelfde ${name} ${quote(g.text)}: ze is niet aan een CMS-veld gekoppeld.`,
            evidence: { template: templateLabel(t), [field]: g.text, items: g.paths.length },
          },
          g.paths,
        );
      } else {
        add(
          {
            info,
            key: `duplicate|${norm(g.text)}`,
            message: `${g.paths.length} pagina's hebben dezelfde ${name}: ${quote(g.text)}.`,
            evidence: { [field]: g.text, pages: g.paths.length },
          },
          g.paths,
        );
      }
    }
    if (long.length > 0) {
      add(
        {
          info,
          key: "long",
          hint: "laag",
          message: `${long.length} ${field === "title" ? "titels zijn langer dan 60 tekens" : "descriptions zijn langer dan 160 tekens"}; Google kort ze af.`,
          evidence: { examples: long.sort((a, b) => b.length - a.length).slice(0, 10) },
        },
        long.map((l) => l.path),
      );
    }
    if (field === "title") {
      // "Copy of …": de naam van een gekopieerd Webflow-project of een gekopieerde pagina, die Webflow als titel gebruikt.
      const copies = entries.filter((e) => e.seo.title && COPY_TITLE.test(e.seo.title));
      if (copies.length > 0) {
        add(
          {
            info,
            key: "copy",
            hint: "hoog",
            message: `${copies.length === 1 ? "De titel" : `${copies.length} titels`} ${quote(copies[0].seo.title!)} ${copies.length === 1 ? "is" : "zijn"} de naam van een gekopieerd project of een gekopieerde pagina: zo verschijnt de pagina in Google.`,
            evidence: { titles: copies.slice(0, 15).map((e) => ({ path: e.path, title: e.seo.title })) },
          },
          copies.map((e) => e.path),
        );
      }
      // Een titel van één tot drie woorden zonder scheidingsteken is meestal nog de paginanaam die Webflow invult.
      const bare = entries.filter(
        (e) => e.seo.title && !templates.has(e.path) && !COPY_TITLE.test(e.seo.title) && !SEPARATOR.test(e.seo.title) && e.seo.title.split(/\s+/).length <= 3,
      );
      if (bare.length > 0) {
        add(
          {
            info,
            key: "page-name",
            hint: "laag",
            label: "na te kijken",
            message: `${bare.length} ${bare.length === 1 ? "pagina heeft" : "pagina's hebben"} een korte titel zonder merknaam, bv. ${quote(bare[0].seo.title!)}. Dat is vaak nog de paginanaam van Webflow; de checklist vraagt bv. de h1 + " | Bedrijfsnaam".`,
            evidence: { titles: bare.slice(0, 15).map((e) => ({ path: e.path, title: e.seo.title })) },
          },
          bare.map((e) => e.path),
        );
      }
    }
  }

  // OG-afbeeldingen van CMS-pagina's.
  for (const t of new Set(templates.values())) {
    if (t.paths.length < 2) continue;
    const images = t.paths.map((p) => entries.find((e) => e.path === p)?.seo.ogImage ?? null);
    if (images.every((i) => !i)) {
      add(
        {
          info: CHECKS.cmsSeo,
          key: `og-missing|${t.id}`,
          hint: "laag",
          message: `CMS-pagina's onder ${templateLabel(t)} hebben geen OG-afbeelding: bij delen op sociale media verschijnt er geen beeld.`,
          evidence: { template: templateLabel(t), items: t.paths.length },
        },
        t.paths,
      );
    } else if (t.paths.length >= 3 && images.every((i) => i && i === images[0])) {
      add(
        {
          info: CHECKS.cmsSeo,
          key: `og-static|${t.id}`,
          hint: "laag",
          label: "na te kijken",
          message: `Alle CMS-pagina's onder ${templateLabel(t)} delen dezelfde OG-afbeelding; koppel ze aan het afbeeldingsveld van het item als dat de bedoeling is.`,
          evidence: { template: templateLabel(t), ogImage: images[0] },
        },
        t.paths,
      );
    }
  }

  // Schema (JSON-LD).
  const home = entries.find((e) => e.path === ctx.startPath);
  if (home && !home.seo.jsonLd.some((b) => b.valid)) {
    add({ info: CHECKS.schema, key: "home", message: "De homepage heeft geen schema (JSON-LD), bv. Organization of LocalBusiness." }, [home.path]);
  }
  const invalid = entries.filter((e) => e.seo.jsonLd.some((b) => !b.valid));
  add(
    {
      info: CHECKS.schema,
      key: "invalid",
      hint: "hoog",
      message: "Het schema (JSON-LD) op deze pagina is geen geldige JSON; zoekmachines negeren het.",
      evidence: { error: invalid[0]?.seo.jsonLd.find((b) => !b.valid)?.error },
    },
    invalid.map((e) => e.path),
  );
  const faq = entries.filter((e) => e.seo.faq && !e.seo.jsonLd.some((b) => b.types.includes("FAQPage")));
  add(
    {
      info: CHECKS.schema,
      key: "faq",
      hint: "laag",
      label: "na te kijken",
      message: "Er staat een FAQ-blok op de pagina zonder FAQPage-schema.",
    },
    faq.map((e) => e.path),
  );

  // Paginastructuur: semantische tags.
  const structure: Array<[string, (e: SeoEntry) => boolean, string]> = [
    ["no-main", (e) => e.seo.landmarks.main === 0, "Geen <main>: zet de tag van de main-wrapper op Main (Element settings > Tag)."],
    ["multi-main", (e) => e.seo.landmarks.main > 1, "Meer dan één <main> op de pagina."],
    ["no-nav", (e) => e.seo.landmarks.nav === 0, "Geen <nav>: de navigatie gebruikt geen nav-tag."],
    ["no-footer", (e) => e.seo.landmarks.footer === 0, "Geen <footer>: zet de tag van de footer op Footer (Element settings > Tag)."],
  ];
  for (const [key, test, message] of structure) {
    add({ info: CHECKS.pageStructure, key, message }, entries.filter(test).map((e) => e.path));
  }

  // Indexering.
  if (ctx.onWebflowIo && !(ctx.robotsTxt && disallowsAll(ctx.robotsTxt))) {
    add(
      {
        info: CHECKS.indexing,
        key: "webflow-io",
        message: "Zoekmachines mogen het .webflow.io-domein indexeren. Zet in de projectinstellingen (SEO) de indexering van het Webflow-subdomein uit.",
        evidence: { robotsTxt: ctx.robotsTxt === null ? "geen robots.txt" : ctx.robotsTxt.trim() ? ctx.robotsTxt.slice(0, 300) : "robots.txt is leeg" },
      },
      [ctx.startPath],
    );
  }
  const noindex = entries.filter((e) => /noindex/i.test(e.seo.robots ?? ""));
  add(
    {
      info: CHECKS.noindex,
      key: "noindex",
      label: "na te kijken",
      message: "De pagina staat op noindex (Sitemap indexing uit): ze komt na de lancering niet in Google.",
      evidence: { robots: noindex[0]?.seo.robots },
    },
    noindex.map((e) => e.path),
  );

  // Sitemap.
  if (!ctx.sitemap.found) {
    add({ info: CHECKS.sitemap, key: "missing", message: "Geen sitemap.xml. Zet in de projectinstellingen (SEO) de automatische sitemap aan." }, [ctx.startPath]);
  } else {
    add(
      {
        info: CHECKS.sitemap,
        key: "dead",
        message: "Deze pagina staat in sitemap.xml maar geeft een fout.",
      },
      ctx.sitemap.deadPaths,
    );
    const listed = new Set(ctx.sitemap.paths);
    const unlisted = entries.filter((e) => !listed.has(e.path) && !/noindex/i.test(e.seo.robots ?? ""));
    add(
      {
        info: CHECKS.sitemap,
        key: "not-listed",
        hint: "laag",
        label: "na te kijken",
        message: "De pagina staat niet in sitemap.xml, maar is ook niet op noindex gezet.",
      },
      unlisted.map((e) => e.path),
    );
  }

  // Standaarddomein: Webflow zet het standaarddomein in de sitemap en de canonical.
  const customHosts = [...new Set([...ctx.sitemap.hosts, ...(home?.seo.canonical ? [safeHost(home.seo.canonical)] : [])])].filter(
    (h): h is string => !!h && !/\.webflow\.io$/i.test(h),
  );
  if (customHosts.length > 0 && !customHosts.some((h) => h.startsWith("www."))) {
    add(
      {
        info: CHECKS.defaultDomain,
        key: "no-www",
        label: "na te kijken",
        message: `Het standaarddomein is ${customHosts[0]} zonder www. Skrol zet meestal het www-domein als standaard (makkelijkst met het SSL-certificaat van Webflow).`,
        evidence: { hosts: customHosts },
      },
      [ctx.startPath],
    );
  }

  // GTM.
  if (entries.length > 0 && !entries.some((e) => e.seo.gtmIds.length > 0)) {
    add(
      {
        info: CHECKS.gtm,
        key: "missing",
        label: "na te kijken",
        message: "Geen Google Tag Manager gevonden. Vraag de klant de GTM-code en zet ze in de head van de site.",
      },
      [ctx.startPath],
    );
  }
  const trackerPages = new Map<string, string[]>();
  for (const e of entries) for (const t of e.seo.directTrackers) trackerPages.set(t, [...(trackerPages.get(t) ?? []), e.path]);
  for (const [tracker, paths] of trackerPages) {
    add(
      {
        info: CHECKS.gtm,
        key: `direct|${tracker}`,
        message: `${tracker} wordt rechtstreeks in de site geladen in plaats van via GTM.`,
        evidence: { tracker },
      },
      paths,
    );
  }

  // CMS-slugs: enkelvoud volgens de checklist.
  for (const t of new Set(templates.values())) {
    if (t.folder === "/" || !looksPlural(t.folder)) continue;
    add(
      {
        info: CHECKS.cmsSlugs,
        key: t.folder,
        label: "na te kijken",
        message: `Het pad van de CMS-pagina's (${t.folder}/…) lijkt meervoud; de checklist vraagt enkelvoud (bv. /blog/, /project/). Behoud het oude pad als de site migreert.`,
        evidence: { folder: t.folder, items: t.paths.length },
      },
      [t.paths[0]],
    );
  }

  return out;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
