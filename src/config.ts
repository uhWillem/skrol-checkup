// Alle instellingen komen uit omgevingsvariabelen, zodat de Docker-container
// zonder codewijziging per omgeving kan worden ingesteld.

export interface Viewport {
  width: number;
  height: number;
}

export interface Config {
  port: number;
  host: string;
  /** Pad waarop de MCP-server luistert. Een moeilijk te raden pad helpt in de testfase. */
  mcpPath: string;
  /** Optionele API-sleutel; leeg = geen sleutel vereist (enkel IP-filter). */
  apiKey: string;
  dataDir: string;
  /** Domeinen die de crawler mag openen. Ondersteunt *.voorbeeld.be. */
  allowedDomains: string[];
  /** Alleen voor lokale tests: laat adressen in privénetwerken toe. */
  allowPrivateNetworks: boolean;
  /** Vangnet tegen eindeloze crawls. */
  maxPages: number;
  /** Aantal pagina's dat tegelijk geladen wordt. */
  pageConcurrency: number;
  /** Aantal check-ups dat tegelijk draait. */
  jobConcurrency: number;
  viewports: Viewport[];
  pageTimeoutMs: number;
  linkTimeoutMs: number;
  linkConcurrency: number;
  maxRedirects: number;
  /** Pad naar een Chromium-binary; leeg = de browser van Playwright zelf. */
  chromiumExecutable: string;
  userAgent: string;
  /**
   * Webflow-sitetokens met enkel leesrechten (sites:read, pages:read, cms:read), gescheiden door komma's.
   * De tool kiest zelf het token van de site die gecontroleerd wordt. Leeg = geen Webflow-lezer.
   */
  webflowTokens: string[];
  /** Adres van de Webflow API; enkel anders in tests. */
  webflowApiBase: string;
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Schermhoogte bij een breedte: laptop 900, tablet 1024, gsm 800. */
export function heightFor(width: number): number {
  return width >= 992 ? 900 : width >= 768 ? 1024 : 800;
}

function viewports(value: string | undefined): Viewport[] {
  const widths = list(value, ["1440", "1280", "992", "768", "390", "360"]).map((w) => Number.parseInt(w, 10));
  return widths.filter((w) => Number.isFinite(w) && w > 0).map((width) => ({ width, height: heightFor(width) }));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: int(env.PORT, 8080),
    host: env.HOST ?? "0.0.0.0",
    mcpPath: env.MCP_PATH ?? "/mcp",
    apiKey: env.API_KEY ?? "",
    dataDir: env.DATA_DIR ?? "./data",
    allowedDomains: list(env.ALLOWED_DOMAINS, ["*.webflow.io"]),
    allowPrivateNetworks: env.ALLOW_PRIVATE_NETWORKS === "true",
    maxPages: int(env.MAX_PAGES, 1000),
    pageConcurrency: int(env.PAGE_CONCURRENCY, 2),
    jobConcurrency: int(env.JOB_CONCURRENCY, 1),
    viewports: viewports(env.VIEWPORTS),
    pageTimeoutMs: int(env.PAGE_TIMEOUT_MS, 30_000),
    linkTimeoutMs: int(env.LINK_TIMEOUT_MS, 10_000),
    linkConcurrency: int(env.LINK_CONCURRENCY, 8),
    maxRedirects: int(env.MAX_REDIRECTS, 5),
    chromiumExecutable: env.CHROMIUM_EXECUTABLE ?? "",
    userAgent: env.USER_AGENT ?? "SkrolCheckup/0.6 (+https://www.skrol.agency)",
    // Tokens zijn hoofdlettergevoelig: niet door list() halen, dat maakt alles kleine letters.
    webflowTokens: (env.WEBFLOW_TOKENS ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    webflowApiBase: (env.WEBFLOW_API_BASE ?? "https://api.webflow.com").replace(/\/$/, ""),
  };
}
