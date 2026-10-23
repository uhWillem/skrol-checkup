import { chromium, type Browser, type BrowserContext } from "playwright";
import type { Config } from "./config.js";
import type { UrlGuard } from "./url-guard.js";

export async function launchChromium(config: Config): Promise<Browser> {
  return chromium.launch({
    headless: true,
    executablePath: config.chromiumExecutable || undefined,
    args: ["--disable-dev-shm-usage"],
  });
}

/**
 * Nieuwe browsercontext waarin elk verzoek naar een intern adres geblokkeerd wordt,
 * en de hoofdpagina enkel naar toegestane domeinen mag navigeren.
 * Scripts, fonts en afbeeldingen van derden mogen wel laden.
 */
export async function guardedContext(browser: Browser, config: Config, guard: UrlGuard): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: config.userAgent,
    viewport: config.viewports[0],
    ignoreHTTPSErrors: false,
    serviceWorkers: "block",
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return route.abort();
    }
    if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    if (url.protocol !== "http:" && url.protocol !== "https:") return route.abort();
    if (await guard.resolvesToPrivate(url.hostname)) return route.abort("blockedbyclient");
    let isMainNavigation = false;
    try {
      isMainNavigation = request.isNavigationRequest() && request.frame().parentFrame() === null;
    } catch {
      // verzoeken zonder frame (bv. van een worker) zijn geen paginanavigatie
    }
    if (isMainNavigation && !guard.isAllowedPage(url.toString())) return route.abort("blockedbyclient");
    return route.continue();
  });
  return context;
}
