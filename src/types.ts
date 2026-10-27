export type Hint = "hoog" | "midden" | "laag";

export interface CheckInfo {
  /** Vaste ID van de controle. */
  id: string;
  /** Naam van het punt in de pre-launch checklist. */
  item: string;
  /** Categorie in de checklist. */
  category: string;
  /** Standaardprioriteit; Claude beslist de uiteindelijke prioriteit in het rapport. */
  hint: Hint;
}

/** De controles die deze versie uitvoert, gekoppeld aan de checklist. */
export const CHECKS = {
  brokenLinks: { id: "broken-links", item: "Linking Pages", category: "Usability and Design", hint: "hoog" },
  emptyLinks: { id: "empty-links", item: "Linking Pages", category: "Usability and Design", hint: "midden" },
  heading1: { id: "heading-1", item: "Heading 1", category: "SEO", hint: "hoog" },
  headingStructure: { id: "heading-structure", item: "Heading Structure", category: "SEO", hint: "laag" },
  horizontalScroll: { id: "horizontal-scroll", item: "Horizontal Scroll", category: "Usability and Design", hint: "hoog" },
  imageAlt: { id: "image-alt", item: "Image Alt Texts", category: "SEO", hint: "midden" },
  missingContent: { id: "missing-content", item: "Missing Content", category: "Usability and Design", hint: "hoog" },
  formSuccess: { id: "form-success-message", item: "Form Success Message", category: "Forms", hint: "hoog" },
  formError: { id: "form-error-message", item: "Form Error Message", category: "Forms", hint: "hoog" },
  formName: { id: "form-name", item: "Form Settings", category: "Forms", hint: "midden" },
  formInputs: { id: "form-inputs", item: "Input Settings", category: "Forms", hint: "midden" },
  emptyState: { id: "empty-state", item: "Empty CMS List State", category: "CMS Pages", hint: "midden" },
  favicon: { id: "favicon", item: "Favicon and Web Clip", category: "Project Settings", hint: "midden" },
  webflowBadge: { id: "webflow-badge", item: "Remove Webflow Branding", category: "Project Settings", hint: "hoog" },
  lang: { id: "lang", item: "Language Code", category: "Project Settings", hint: "midden" },
  testPage: { id: "test-page", item: "Missing Content", category: "Usability and Design", hint: "midden" },
  // Lay-out per schermbreedte. "Check on All Devices" vraagt daarnaast dat Claude screenshots bekijkt (get_screenshot).
  overlap: { id: "overlap", item: "Check on All Devices and Small Laptops", category: "Usability and Design", hint: "hoog" },
  clippedText: { id: "clipped-text", item: "Check on All Devices and Small Laptops", category: "Usability and Design", hint: "hoog" },
  textOutside: { id: "text-outside", item: "Check on All Devices and Small Laptops", category: "Usability and Design", hint: "midden" },
  imageQuality: { id: "image-quality", item: "Blurry Images", category: "Usability and Design", hint: "midden" },
  imageTextOrder: { id: "image-text-order", item: "Image + Text", category: "Usability and Design", hint: "midden" },
  // Navigatie en logo (één keer per site, op de startpagina).
  navSticky: { id: "nav-sticky", item: "Navigation", category: "Usability and Design", hint: "midden" },
  navScrollLock: { id: "nav-scroll-lock", item: "Navigation Scroll", category: "Usability and Design", hint: "midden" },
  navMenuFit: { id: "nav-menu-fit", item: "Nav Menu Scroll", category: "Usability and Design", hint: "hoog" },
  logoLink: { id: "logo-link", item: "Logo Link", category: "Logo", hint: "midden" },
  logoFormat: { id: "logo-format", item: "Logo Size", category: "Logo", hint: "laag" },
  // Stijl.
  hoverState: { id: "hover-state", item: "Hover States", category: "Usability and Design", hint: "laag" },
  fonts: { id: "fonts", item: "Fonts", category: "Style Guide", hint: "midden" },
  headingStyle: { id: "heading-style", item: "Global Heading Tags", category: "Style Guide", hint: "midden" },
  inputStyle: { id: "input-style", item: "Custom Inputs and Form Fields", category: "Style Guide", hint: "midden" },
  // SEO, op de HTML die de server teruggeeft.
  seoTitle: { id: "seo-title", item: "When It's a New Site - SEO Title & Description", category: "SEO", hint: "midden" },
  seoDescription: { id: "seo-description", item: "When It's a New Site - SEO Title & Description", category: "SEO", hint: "midden" },
  cmsSeo: { id: "cms-seo", item: "Dynamic SEO Titles, Descriptions and OG Images", category: "CMS Pages", hint: "hoog" },
  schema: { id: "schema", item: "Schema Markup", category: "SEO", hint: "midden" },
  pageStructure: { id: "page-structure", item: "Page Structure", category: "SEO", hint: "laag" },
  indexing: { id: "indexing", item: "Webflow Domain Indexing", category: "SEO", hint: "midden" },
  noindex: { id: "noindex", item: "Website Sitemap", category: "SEO", hint: "midden" },
  sitemap: { id: "sitemap", item: "Website Sitemap", category: "SEO", hint: "midden" },
  defaultDomain: { id: "default-domain", item: "Default Domain", category: "SEO", hint: "laag" },
  cmsSlugs: { id: "cms-slugs", item: "CMS Slugs", category: "CMS Pages", hint: "laag" },
  gtm: { id: "gtm", item: "GTM Set Up", category: "Tracking", hint: "laag" },
  // Migratie: enkel als er een live domein met een oude site is.
  redirects: { id: "redirects", item: "Redirects", category: "SEO", hint: "hoog" },
  slugs: { id: "slugs", item: "Page and CMS Slugs", category: "SEO", hint: "laag" },
  seoMigration: { id: "seo-migration", item: "When Migrating - SEO Title & Description", category: "SEO", hint: "midden" },
} as const satisfies Record<string, CheckInfo>;

/** Controles die enkel lopen als de oude site op het live domein te lezen is. */
export const MIGRATION_CHECKS: readonly string[] = [CHECKS.redirects.id, CHECKS.slugs.id, CHECKS.seoMigration.id];

export interface MigrationSummary {
  /** Oorsprong van de oude site, bv. https://www.klant.be. */
  oldSite: string;
  /** Waar de lijst oude pagina's vandaan komt. */
  source: "sitemap" | "crawl";
  oldPages: number;
  /** Zelfde pad op de nieuwe site. */
  same: number;
  /** Ander pad, met een redirect. */
  redirected: number;
  /** Geen pagina en geen redirect: 404. */
  missing: number;
  /** Niet te controleren (time-out, verwijst naar een ander domein). */
  failed: number;
  /** Er waren meer oude pagina's dan het maximum. */
  truncated: boolean;
}

export interface Finding {
  /** Stabiele ID: dezelfde bug op dezelfde plek geeft dezelfde ID. */
  id: string;
  check: string;
  item: string;
  category: string;
  hint: Hint;
  /** "na te kijken" als de controle niet zeker is. */
  label?: "na te kijken";
  /** Pagina('s) waar de bug voorkomt, als pad. */
  pages: string[];
  viewport?: number;
  browser: "chromium";
  message: string;
  element?: string;
  evidence?: Record<string, unknown>;
}

export interface PageResult {
  url: string;
  path: string;
  status: number | null;
  finalUrl: string;
  error?: string;
  /** De pagina laadde, maar een controle liep vast; de andere controles van die pagina zijn wel uitgevoerd. */
  analysisError?: string;
}

export interface CheckupSummary {
  pages: number;
  pagesWithErrors: number;
  findings: number;
  byHint: Record<Hint, number>;
  byCheck: Record<string, number>;
  stoppedAtMaxPages: boolean;
  /** Aantal pagina's waar een controle vastliep (zie pages[].analysisError in list_pages). */
  analysisErrors?: number;
  /** Live domein van de klant: links ernaartoe zijn op de nieuwe site gecontroleerd. */
  liveDomain?: string;
  /** "opgegeven" via start_checkup, of "sitemap" als het uit sitemap.xml gehaald is. */
  liveDomainSource?: "opgegeven" | "sitemap";
  /** Vergelijking met de oude site op het live domein. */
  migration?: MigrationSummary;
  /** Controles die niet gelopen hebben, met de reden. Die punten moet het team zelf nakijken. */
  skipped?: Array<{ check: string; reason: string }>;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  url: string;
  liveDomain?: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: { pagesDone: number; pagesFound: number; phase: string };
  error?: string;
  summary?: CheckupSummary;
}
