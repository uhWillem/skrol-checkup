// Webflow-lezer: leest de site, pagina's, CMS-collecties en -items via de Webflow Data API v2,
// met een sitetoken dat enkel kan lezen. Zo controleert de tool checklist-punten die je op de site
// zelf niet ziet: helpteksten bij velden, het aantal items, opvultekst in items die nergens gelinkt
// zijn, lege velden (conditional visibility), paginanamen, drafts en de tijdzone.
// De tokens staan in de serverinstellingen (WEBFLOW_TOKENS) en komen nooit in bevindingen of logs.

import type { Config } from "./config.js";
import { testPageWord } from "./checks.js";
import type { SiteDraft } from "./seo.js";
import { isFillerText } from "./text.js";
import { CHECKS, type WebflowSummary } from "./types.js";

export interface WfSite {
  id: string;
  displayName?: string;
  shortName?: string;
  timeZone?: string;
  customDomains?: Array<{ url?: string }>;
}

export interface WfPage {
  id: string;
  title?: string;
  slug?: string;
  collectionId?: string | null;
  draft?: boolean;
  archived?: boolean;
  publishedPath?: string;
}

export interface WfField {
  id: string;
  slug?: string;
  displayName: string;
  type: string;
  isRequired: boolean;
  isEditable?: boolean;
  helpText?: string;
}

export interface WfCollection {
  id: string;
  displayName: string;
  singularName?: string;
  slug?: string;
  fields: WfField[];
}

export interface WfItem {
  id: string;
  isDraft?: boolean;
  isArchived?: boolean;
  fieldData: Record<string, unknown>;
}

export interface WebflowData {
  site: WfSite;
  /** null als de pagina's niet gelezen konden worden (bv. token zonder pages:read). */
  pages: WfPage[] | null;
  collections: Array<{ collection: WfCollection; items: WfItem[]; truncated: boolean }> | null;
  errors: string[];
}

/** Maximum aantal items dat per collectie gelezen wordt. */
export const ITEMS_MAX = 1000;
const MAX_RETRIES = 3;

class WebflowError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kleine client voor de Data API. Wacht bij 429 zo lang als Retry-After zegt, en vertraagt als er bijna geen verzoeken meer over zijn. */
class WebflowClient {
  constructor(
    private base: string,
    private token: string,
    private timeoutMs: number,
  ) {}

  async get<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.base}${path}`, {
        headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const header = Number(res.headers.get("retry-after"));
        const wait = Math.min(Number.isFinite(header) && header >= 0 && res.headers.has("retry-after") ? header : 60, 65);
        await res.body?.cancel();
        await sleep(wait * 1000);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        // Nooit het token in de foutmelding: enkel het pad en de status.
        throw new WebflowError(res.status, `Webflow API ${path.split("?")[0]}: HTTP ${res.status}`);
      }
      const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? "100");
      if (remaining <= 2) await sleep(20_000);
      return (await res.json()) as T;
    }
  }

  /** Alle resultaten van een lijst met offset en limit (max 100 per verzoek). */
  async list<T>(path: string, key: string, max = Number.POSITIVE_INFINITY): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    for (let offset = 0; ; ) {
      const sep = path.includes("?") ? "&" : "?";
      const page = await this.get<Record<string, unknown> & { pagination?: { total?: number } }>(`${path}${sep}limit=100&offset=${offset}`);
      const batch = (page[key] as T[] | undefined) ?? [];
      items.push(...batch);
      offset += batch.length;
      const total = page.pagination?.total ?? items.length;
      if (batch.length === 0 || offset >= total) return { items, truncated: false };
      if (items.length >= max) return { items: items.slice(0, max), truncated: true };
    }
  }
}

const bareHost = (h: string): string => h.toLowerCase().replace(/^www\./, "");

/**
 * Zoekt het token dat bij de gecontroleerde site hoort en leest de gegevens.
 * Staging (*.webflow.io) herkent de tool aan de shortName van de site, een eigen domein aan de custom domains.
 */
export async function readWebflow(config: Config, startHost: string): Promise<WebflowData | { skipped: string }> {
  if (config.webflowTokens.length === 0) return { skipped: "geen Webflow-token ingesteld (WEBFLOW_TOKENS op de server)" };
  const host = bareHost(startHost);
  const onWebflowIo = host.endsWith(".webflow.io");
  let match: { client: WebflowClient; site: WfSite } | null = null;
  let failed = 0;
  for (const token of config.webflowTokens) {
    const client = new WebflowClient(config.webflowApiBase, token, config.linkTimeoutMs);
    try {
      const { sites } = await client.get<{ sites: WfSite[] }>("/v2/sites");
      const site = sites.find((s) =>
        onWebflowIo ? `${(s.shortName ?? "").toLowerCase()}.webflow.io` === host : (s.customDomains ?? []).some((d) => d.url && bareHost(d.url) === host),
      );
      if (site) {
        match = { client, site };
        break;
      }
    } catch {
      failed++;
    }
  }
  if (!match) {
    const n = config.webflowTokens.length;
    return {
      skipped: `geen van de ${n} Webflow-token${n === 1 ? "" : "s"} hoort bij ${startHost}${failed ? ` (${failed} gaf een fout, bv. verlopen of zonder sites:read)` : ""}`,
    };
  }

  const { client, site } = match;
  const errors: string[] = [];
  let pages: WfPage[] | null = null;
  try {
    pages = (await client.list<WfPage>(`/v2/sites/${site.id}/pages`, "pages")).items;
  } catch (e) {
    errors.push(`pagina's: ${(e as Error).message}`);
  }
  let collections: WebflowData["collections"] = null;
  try {
    const { collections: list } = await client.get<{ collections: Array<{ id: string }> }>(`/v2/sites/${site.id}/collections`);
    collections = [];
    for (const { id } of list) {
      const collection = await client.get<WfCollection>(`/v2/collections/${id}`);
      const { items, truncated } = await client.list<WfItem>(`/v2/collections/${id}/items`, "items", ITEMS_MAX);
      collections.push({ collection, items, truncated });
    }
  } catch (e) {
    errors.push(`CMS: ${(e as Error).message}`);
  }
  return { site, pages, collections, errors };
}

export function webflowSummary(data: WebflowData): WebflowSummary {
  return {
    site: data.site.displayName ?? data.site.shortName ?? data.site.id,
    ...(data.site.timeZone ? { timeZone: data.site.timeZone } : {}),
    ...(data.pages ? { pages: data.pages.filter((p) => !p.archived).length } : {}),
    ...(data.collections
      ? { collections: data.collections.length, items: data.collections.reduce((n, c) => n + c.items.filter((i) => !i.isArchived).length, 0) }
      : {}),
    ...(data.collections?.some((c) => c.truncated)
      ? { truncated: data.collections.filter((c) => c.truncated).map((c) => c.collection.displayName) }
      : {}),
    ...(data.errors.length > 0 ? { errors: data.errors } : {}),
  };
}

// --- Controles ---

/** Kleine woorden die in Title Case klein mogen blijven (niet als eerste woord). */
const SMALL_WORDS = new Set(
  "de het een en of van voor in op met aan bij te tot om uit the a an and or of for to on with at by from".split(" "),
);

export function isTitleCase(name: string): boolean {
  const words = name.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return words.every((w, i) => {
    const first = w.match(/\p{L}/u)![0];
    return first === first.toUpperCase() || (i > 0 && SMALL_WORDS.has(w.toLowerCase()));
  });
}

/** Verwachte tijdzone bij het topleveldomein van het live domein. */
const ZONE_BY_TLD: Record<string, string> = {
  be: "Europe/Brussels",
  nl: "Europe/Amsterdam",
  lu: "Europe/Luxembourg",
  fr: "Europe/Paris",
  de: "Europe/Berlin",
  at: "Europe/Vienna",
  ch: "Europe/Zurich",
  es: "Europe/Madrid",
  it: "Europe/Rome",
  uk: "Europe/London",
  ie: "Europe/Dublin",
  pt: "Europe/Lisbon",
};

/** UTC-verschuiving in minuten van een tijdzone op een datum, of null als de zone onbekend is. */
function offsetMinutes(zone: string, date: Date): number | null {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!name) return null;
    if (name === "GMT") return 0;
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : null;
  } catch {
    return null;
  }
}

/** Twee tijdzones lopen gelijk als ze in de winter en de zomer dezelfde verschuiving hebben. */
export function sameClock(a: string, b: string): boolean {
  const year = new Date().getUTCFullYear();
  return [new Date(Date.UTC(year, 0, 15)), new Date(Date.UTC(year, 6, 15))].every((d) => {
    const x = offsetMinutes(a, d);
    return x !== null && x === offsetMinutes(b, d);
  });
}

/** Velden die een klant leeg kan laten, zodat de template het element moet verbergen. */
const EMPTYABLE = new Set(["Image", "MultiImage", "Link", "VideoLink", "Email", "Phone", "File", "PlainText", "RichText", "Reference", "MultiReference", "Option", "DateTime"]);
const TEXT_TYPES = new Set(["PlainText", "RichText"]);
const ALT_FIELD = /\balt\b|alt-?tekst|alt text/i;

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.replace(/<[^>]*>/g, "").trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const url = (value as { url?: unknown }).url;
    return url !== undefined && (url === null || url === "");
  }
  return false;
}

const plain = (value: unknown): string => (typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "");

export interface WebflowContext {
  startPath: string;
  /** Live domein van de klant, voor de verwachte tijdzone. */
  liveDomain?: string;
  /** Pad van de CMS-pagina's per collectie-ID, uit de crawl (bv. "/blog"). */
  collectionFolders: Map<string, string>;
}

export function webflowDrafts(data: WebflowData, ctx: WebflowContext): SiteDraft[] {
  const out: SiteDraft[] = [];
  const add = (draft: SiteDraft["draft"], pages: string[]): void => {
    if (pages.length > 0) out.push({ draft, pages: [...new Set(pages)] });
  };

  // Tijdzone.
  const zone = data.site.timeZone;
  const tld = ctx.liveDomain?.split(".").pop() ?? "";
  const expected = ZONE_BY_TLD[tld];
  if (!zone) {
    add({ info: CHECKS.timezone, key: "missing", message: "Er is geen tijdzone ingesteld in de projectinstellingen." }, [ctx.startPath]);
  } else if (expected && !sameClock(zone, expected)) {
    add(
      {
        info: CHECKS.timezone,
        key: "wrong",
        message: `De tijdzone van de site is ${zone}, maar het domein ${ctx.liveDomain} wijst op ${expected}. Uren van evenementen en formulierinzendingen staan dan verkeerd.`,
        evidence: { timeZone: zone, expected },
      },
      [ctx.startPath],
    );
  } else if (!expected) {
    add(
      {
        info: CHECKS.timezone,
        key: "check",
        hint: "laag",
        label: "na te kijken",
        message: `De tijdzone van de site is ${zone}. Kijk na of dat die van de klant is.`,
        evidence: { timeZone: zone },
      },
      [ctx.startPath],
    );
  }

  // Pagina's: namen in Title Case en drafts.
  if (data.pages) {
    const pathOfPage = (p: WfPage): string => p.publishedPath || (p.slug ? `/${p.slug}` : "/");
    const statics = data.pages.filter((p) => !p.archived && !p.collectionId && p.title);
    const badNames = statics.filter((p) => !isTitleCase(p.title!));
    add(
      {
        info: CHECKS.pageNames,
        key: "title-case",
        message: `${badNames.length} ${badNames.length === 1 ? "paginanaam staat" : "paginanamen staan"} niet in Title Case, bv. "${badNames[0]?.title}".`,
        evidence: { pages: badNames.slice(0, 30).map((p) => ({ name: p.title, path: pathOfPage(p) })) },
      },
      badNames.map(pathOfPage),
    );
    // Een stijlgids blijft bewust uit de publicatie.
    const drafts = statics.filter((p) => p.draft && !/style\s*guide|stijlgids/i.test(p.title!));
    add(
      {
        info: CHECKS.draftPages,
        key: "draft",
        label: "na te kijken",
        message: `${drafts.length} ${drafts.length === 1 ? "pagina staat" : "pagina's staan"} als draft en ${drafts.length === 1 ? "gaat" : "gaan"} niet mee online bij het publiceren, bv. "${drafts[0]?.title}".`,
        evidence: { pages: drafts.slice(0, 30).map((p) => ({ name: p.title, path: pathOfPage(p) })) },
      },
      drafts.map(pathOfPage),
    );
  }

  // CMS.
  for (const { collection, items } of data.collections ?? []) {
    const name = collection.displayName;
    const folder = ctx.collectionFolders.get(collection.id);
    const itemPath = (item: WfItem): string => {
      const slug = String(item.fieldData.slug ?? "");
      return folder && slug ? `${folder === "/" ? "" : folder}/${slug}` : ctx.startPath;
    };
    const active = items.filter((i) => !i.isArchived);
    // Bevindingen over de hele collectie hangen aan haar eerste CMS-pagina, of anders aan de startpagina.
    const anchor = folder && active[0] ? itemPath(active[0]) : ctx.startPath;
    const editable = collection.fields.filter((f) => f.isEditable !== false && f.slug !== "name" && f.slug !== "slug");

    // Helpteksten.
    const noHelp = editable.filter((f) => !f.helpText?.trim());
    if (noHelp.length > 0) {
      add(
        {
          info: CHECKS.cmsFields,
          key: `help|${collection.id}`,
          message: `Collectie "${name}": ${noHelp.length} van de ${editable.length} velden ${noHelp.length === 1 ? "heeft" : "hebben"} geen helptekst (${noHelp
            .slice(0, 8)
            .map((f) => f.displayName)
            .join(", ")}${noHelp.length > 8 ? ", …" : ""}).`,
          evidence: { collection: name, fields: noHelp.map((f) => f.displayName) },
        },
        [anchor],
      );
    }

    // Aantal items.
    if (active.length < 3) {
      add(
        {
          info: CHECKS.cmsItems,
          key: collection.id,
          ...(active.length === 0 ? { label: "na te kijken" as const, hint: "laag" as const } : {}),
          message:
            active.length === 0
              ? `Collectie "${name}" is leeg. Wordt ze gebruikt? Anders verwijderen; als ze gebruikt wordt, minstens 3 items toevoegen.`
              : `Collectie "${name}" heeft ${active.length} item${active.length === 1 ? "" : "s"}; de checklist vraagt minstens 3, liefst 7, met verschillende inhoud.`,
          evidence: { collection: name, items: active.length },
        },
        [anchor],
      );
    }

    // Opvultekst en testitems, ook in items die nergens gelinkt zijn.
    const textFields = collection.fields.filter((f) => TEXT_TYPES.has(f.type) && f.slug);
    const hits: Array<{ item: WfItem; reason: string }> = [];
    for (const item of active) {
      const slug = String(item.fieldData.slug ?? "");
      const word = testPageWord(`/${slug}`) ?? testPageWord(`/${String(item.fieldData.name ?? "").toLowerCase().replace(/\s+/g, "-")}`);
      if (word) {
        hits.push({ item, reason: `"${word}" in de naam of slug` });
        continue;
      }
      const field = textFields.find((f) => isFillerText(plain(item.fieldData[f.slug!])));
      if (field) hits.push({ item, reason: `opvultekst in "${field.displayName}"` });
    }
    if (hits.length > 0) {
      add(
        {
          info: CHECKS.cmsContent,
          key: collection.id,
          message: `Collectie "${name}": ${hits.length} item${hits.length === 1 ? "" : "s"} met opvultekst of een testnaam, bv. "${String(hits[0].item.fieldData.name ?? "")}" (${hits[0].reason}).`,
          evidence: {
            collection: name,
            items: hits.slice(0, 25).map((h) => ({ name: h.item.fieldData.name, slug: h.item.fieldData.slug, reason: h.reason, draft: !!h.item.isDraft })),
          },
        },
        hits.map((h) => itemPath(h.item)),
      );
    }

    // Lege velden: de template moet die elementen verbergen.
    if (active.length >= 2) {
      const partly: Array<{ field: string; empty: number }> = [];
      const unused: string[] = [];
      for (const f of editable) {
        if (!EMPTYABLE.has(f.type) || f.isRequired || !f.slug) continue;
        const empty = active.filter((i) => isEmpty(i.fieldData[f.slug!])).length;
        if (empty === active.length) unused.push(f.displayName);
        else if (empty > 0) partly.push({ field: f.displayName, empty });
      }
      if (partly.length > 0) {
        add(
          {
            info: CHECKS.conditionalVisibility,
            key: collection.id,
            label: "na te kijken",
            message: `Collectie "${name}": ${partly
              .slice(0, 6)
              .map((p) => `"${p.field}" is leeg in ${p.empty} van de ${active.length} items`)
              .join(", ")}${partly.length > 6 ? ", …" : ""}. Kijk na of de template die elementen verbergt als het veld leeg is (conditional visibility).`,
            evidence: { collection: name, items: active.length, fields: partly },
          },
          [anchor],
        );
      }
      // Een alt-tekstveld dat nergens ingevuld is, betekent lege alt-teksten op de CMS-pagina's.
      const altFields = unused.filter((u) => ALT_FIELD.test(u));
      if (altFields.length > 0) {
        add(
          {
            info: CHECKS.cmsFields,
            key: `alt|${collection.id}`,
            hint: "midden",
            message: `Collectie "${name}": ${altFields.map((u) => `"${u}"`).join(", ")} ${altFields.length === 1 ? "is" : "zijn"} in geen enkel item ingevuld, dus de afbeeldingen op de CMS-pagina's hebben een lege alt-tekst.`,
            evidence: { collection: name, fields: altFields, items: active.length },
          },
          [anchor],
        );
      }
      const otherUnused = unused.filter((u) => !ALT_FIELD.test(u));
      if (otherUnused.length > 0) {
        const unused = otherUnused;
        add(
          {
            info: CHECKS.cmsFields,
            key: `unused|${collection.id}`,
            hint: "laag",
            label: "na te kijken",
            message: `Collectie "${name}": ${unused.length === 1 ? "het veld" : "de velden"} ${unused.map((u) => `"${u}"`).join(", ")} ${unused.length === 1 ? "wordt" : "worden"} in geen enkel item ingevuld: invullen, of verwijderen als ${unused.length === 1 ? "het" : "ze"} niet meer nodig ${unused.length === 1 ? "is" : "zijn"}.`,
            evidence: { collection: name, fields: unused },
          },
          [anchor],
        );
      }
    }
  }
  return out;
}
