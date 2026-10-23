// Pagina's vinden: sitemap.xml en links op dezelfde site.

const NON_HTML = /\.(pdf|jpe?g|png|gif|svg|webp|avif|ico|zip|rar|7z|mp4|mov|webm|mp3|wav|docx?|xlsx?|pptx?|csv|txt|xml|json|js|css|woff2?|ttf|otf)$/i;

/** Pagina-URL zonder hash en zonder zoekparameters, zodat filters geen eindeloze lijst maken. */
export function normalizePageUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.search = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return null;
  }
}

/** Link-URL voor de statuscontrole: zonder hash, maar met zoekparameters. */
export function normalizeLinkUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function isLikelyHtml(url: string): boolean {
  try {
    return !NON_HTML.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return url;
  }
}

/**
 * Leest sitemap.xml van de site. Webflow zet in de sitemap soms het live domein,
 * ook op staging: daarom nemen we enkel het pad en zetten we het op het domein van de check-up.
 */
export async function readSitemap(
  origin: string,
  fetchText: (url: string) => Promise<string | null>,
): Promise<string[]> {
  const xml = await fetchText(new URL("/sitemap.xml", origin).toString());
  if (!xml) return [];
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  const pages: string[] = [];
  for (const loc of locs) {
    try {
      const u = new URL(loc);
      const onOrigin = new URL(u.pathname, origin).toString();
      const normalized = normalizePageUrl(onOrigin);
      if (normalized && isLikelyHtml(normalized)) pages.push(normalized);
    } catch {
      // ongeldige <loc> overslaan
    }
  }
  return [...new Set(pages)];
}
