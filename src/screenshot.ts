// Screenshots op aanvraag, zodat Claude de lay-out zelf kan bekijken en lay-outbevindingen kan nakijken.
// Ze worden niet bewaard: elke oproep laadt de pagina opnieuw.

import type { Config } from "./config.js";
import { heightFor } from "./config.js";
import { guardedContext, launchChromium } from "./browser.js";
import { AUTO_SCROLL } from "./page-scripts.js";
import type { UrlGuard } from "./url-guard.js";

export interface ScreenshotRequest {
  url: string;
  width: number;
  /** CSS-selector, bv. het element uit een bevinding: dan enkel dat stuk, met het element omkaderd. */
  selector?: string;
  /** Deel van de volledige pagina (1, 2, …), als er geen selector is. */
  part?: number;
}

export interface ScreenshotMeta {
  url: string;
  width: number;
  /** Breedte van het beeld: breder dan de schermbreedte als de pagina horizontaal uitsteekt (max. 1,5×). */
  imageWidth: number;
  pageHeight: number;
  part?: number;
  parts?: number;
  /** Bovenkant en hoogte van het getoonde stuk, in pixels van de pagina. */
  top: number;
  height: number;
  selector?: string;
}

const MAX_PAGE_HEIGHT = 30_000;
/** Hoogte van één deel: op gsm hoger, zodat een deel ongeveer twee schermen toont. */
export function partHeight(width: number): number {
  return width <= 480 ? 1800 : 1200;
}

// Eén screenshot tegelijk: Chromium vraagt veel geheugen, en er kan ook een check-up lopen.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export function takeScreenshot(req: ScreenshotRequest, config: Config, guard: UrlGuard): Promise<{ image: Buffer; meta: ScreenshotMeta }> {
  return exclusive(async () => {
    if (!guard.isAllowedPage(req.url)) throw new Error(`Domein niet toegestaan: ${new URL(req.url).hostname}`);
    if (await guard.resolvesToPrivate(new URL(req.url).hostname)) throw new Error("Intern adres geblokkeerd.");
    const browser = await launchChromium(config);
    try {
      const context = await guardedContext(browser, config, guard);
      const page = await context.newPage();
      await page.setViewportSize({ width: req.width, height: heightFor(req.width) });
      const response = await page.goto(req.url, { waitUntil: "load", timeout: config.pageTimeoutMs });
      if (!response || response.status() >= 400) throw new Error(`Pagina niet bereikbaar (HTTP ${response?.status() ?? "?"}).`);
      await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
      await page.evaluate(AUTO_SCROLL).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      const pageHeight = Math.min(
        MAX_PAGE_HEIGHT,
        (await page.evaluate("Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)")) as number,
      );
      const scrollWidth = (await page.evaluate("document.documentElement.scrollWidth")) as number;
      const imageWidth = Math.min(Math.max(req.width, scrollWidth), Math.round(req.width * 1.5));
      const maxHeight = partHeight(req.width);

      let top: number;
      let height: number;
      const meta: ScreenshotMeta = { url: req.url, width: req.width, imageWidth, pageHeight, top: 0, height: 0 };
      if (req.selector) {
        // De selector komt als JSON-tekst in het script, zodat hij niets anders kan uitvoeren.
        const box = (await page.evaluate(`(() => {
          let el;
          try { el = document.querySelector(${JSON.stringify(req.selector)}); } catch { return { error: "ongeldige selector" }; }
          if (!el) return null;
          el.style.outline = "4px solid #ff00ff";
          el.style.outlineOffset = "2px";
          const r = el.getBoundingClientRect();
          return { top: r.top + window.scrollY, height: r.height };
        })()`)) as { top: number; height: number; error?: string } | null;
        if (!box) throw new Error(`Element niet gevonden op ${req.width} px: ${req.selector}`);
        if (box.error) throw new Error(`Ongeldige selector: ${req.selector}`);
        const margin = 250;
        height = Math.min(maxHeight, Math.max(box.height + 2 * margin, 600));
        top = Math.max(0, Math.min(pageHeight - height, box.top + box.height / 2 - height / 2));
        meta.selector = req.selector;
      } else {
        const parts = Math.max(1, Math.ceil(pageHeight / maxHeight));
        const part = Math.min(Math.max(1, req.part ?? 1), parts);
        top = (part - 1) * maxHeight;
        height = Math.min(maxHeight, pageHeight - top);
        meta.part = part;
        meta.parts = parts;
      }
      top = Math.max(0, Math.round(top));
      height = Math.max(1, Math.round(Math.min(height, pageHeight - top)));
      meta.top = top;
      meta.height = height;
      const image = await page.screenshot({
        type: "jpeg",
        quality: 70,
        fullPage: true,
        clip: { x: 0, y: top, width: imageWidth, height },
      });
      await context.close();
      return { image, meta };
    } finally {
      await browser.close();
    }
  });
}
