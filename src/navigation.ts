// Controles op de navigatie en het logo. De navigatie is een component dat op elke pagina hetzelfde is,
// dus deze controles draaien één keer, op de startpagina.

import type { BrowserContext, Page } from "playwright";
import type { Draft } from "./checks.js";
import { LOGO_INFO, MENU_STATE, NAV_STATE, type RawLogo, type RawMenuState, type RawNavState } from "./page-scripts.js";
import { CHECKS } from "./types.js";

const SETTLE_MS = 600;

async function open(page: Page, url: string, width: number, height: number, timeoutMs: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

function isHome(href: string, origin: string): boolean {
  try {
    const u = new URL(href);
    return u.origin === origin && (u.pathname === "/" || u.pathname === "") && !u.hash;
  } catch {
    return false;
  }
}

function logoDrafts(logo: RawLogo, origin: string): Draft[] {
  const drafts: Draft[] = [];
  for (const [where, info] of [
    ["navigatie", logo.nav],
    ["footer", logo.footer],
  ] as const) {
    if (!info) continue;
    if (!isHome(info.href, origin)) {
      drafts.push({
        info: CHECKS.logoLink,
        key: `link|${where}`,
        element: info.selector,
        message: `Het logo in de ${where} linkt niet naar de homepage maar naar ${info.href || "niets"}.`,
        evidence: { where, href: info.href },
      });
    }
    if (!info.svg && info.src && !/\.svg(\?|#|$)/i.test(info.src)) {
      const file = decodeURIComponent(info.src.split("/").pop() ?? info.src);
      drafts.push({
        info: CHECKS.logoFormat,
        key: `format|${where}`,
        element: info.selector,
        message: `Het logo in de ${where} is geen SVG (${file}). Een SVG blijft scherp op elk scherm en is meestal kleiner.`,
        evidence: { where, src: info.src },
      });
    }
  }
  return drafts;
}

/** Scrolt met het muiswiel in stappen van 200 px, zoals een bezoeker, zodat scrollinteracties van Webflow reageren. */
async function wheel(page: Page, dy: number): Promise<void> {
  const step = dy > 0 ? 200 : -200;
  for (let done = 0; Math.abs(done) < Math.abs(dy); done += step) {
    await page.mouse.wheel(0, step);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Blijft de navigatie bovenaan na 800 px scrollen? Verdwijnt ze, dan scrollt de controle 200 px terug omhoog:
 * komt ze dan terug, dan is het een navigatie die bewust verdwijnt bij naar beneden scrollen, en dat is in orde.
 */
async function stickyDrafts(page: Page): Promise<Draft[]> {
  const top = (await page.evaluate(NAV_STATE)) as RawNavState | null;
  if (!top || !top.longEnough) return [];
  await page.mouse.move(720, 450);
  await wheel(page, 800);
  const down = (await page.evaluate(NAV_STATE)) as RawNavState;
  if (down.visibleAtTop) {
    if (down.opaque) return [];
    return [
      {
        info: CHECKS.navSticky,
        key: "transparent",
        element: down.selector,
        message: "De navigatie blijft bovenaan maar heeft geen achtergrond: bij het scrollen loopt de inhoud zichtbaar onder de links door.",
        evidence: { selector: down.selector, scrollY: down.scrollY },
      },
    ];
  }
  await wheel(page, -200);
  const up = (await page.evaluate(NAV_STATE)) as RawNavState;
  if (up.visibleAtTop) return [];
  return [
    {
      info: CHECKS.navSticky,
      key: "not-sticky",
      label: "na te kijken",
      element: down.selector,
      message:
        "De navigatie blijft niet bovenaan na 800 px scrollen, en komt ook niet terug als je weer 200 px naar boven scrolt. Volgens de checklist blijft ze zichtbaar.",
      evidence: { selector: down.selector, scrollYDown: down.scrollY, scrollYUp: up.scrollY },
    },
  ];
}

/** Opent het gsm-menu van Webflow. Geeft de toestand terug, of null als er geen (zichtbare) menuknop is. */
async function openMenu(page: Page): Promise<RawMenuState | null> {
  const button = page.locator(".w-nav-button").first();
  if ((await button.count()) === 0 || !(await button.isVisible())) return null;
  await button.click({ timeout: 3_000 });
  await page.waitForTimeout(SETTLE_MS);
  return (await page.evaluate(MENU_STATE)) as RawMenuState;
}

/**
 * Navigatie- en logocontroles op de startpagina:
 * - laptop (1440): blijft de navigatie bovenaan na 800 px scrollen, met een achtergrond die niet doorschijnt; logo's;
 * - gsm (390 × 800): scrolt de pagina mee als het menu open staat;
 * - gsm liggend (740 × 360): zijn alle links in het menu te zien of te bereiken.
 */
export async function navigationDrafts(context: BrowserContext, url: string, timeoutMs: number): Promise<Draft[]> {
  const drafts: Draft[] = [];
  const origin = new URL(url).origin;
  const page = await context.newPage();
  try {
    await open(page, url, 1440, 900, timeoutMs);
    drafts.push(...logoDrafts((await page.evaluate(LOGO_INFO)) as RawLogo, origin));
    drafts.push(...(await stickyDrafts(page)));

    // Gsm rechtop: menu openen en proberen te scrollen.
    await open(page, url, 390, 800, timeoutMs);
    const portrait = await openMenu(page);
    if (portrait?.open) {
      const before = (await page.evaluate("window.scrollY")) as number;
      await page.mouse.move(195, 500);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(400);
      const after = (await page.evaluate("window.scrollY")) as number;
      if (after - before > 50) {
        drafts.push({
          info: CHECKS.navScrollLock,
          key: "scroll-lock",
          element: portrait.selector,
          message: `Met het gsm-menu open scrolt de pagina erachter mee (${Math.round(after - before)} px bij één scrollbeweging). Zet de body op overflow hidden zolang het menu open is.`,
          evidence: { scrolledPx: Math.round(after - before) },
        });
      }
    }

    // Gsm liggend: past het menu, of kun je erin scrollen?
    await open(page, url, 740, 360, timeoutMs);
    const landscape = await openMenu(page);
    if (landscape?.open && (landscape.hidden ?? 0) > 0) {
      const reachable = landscape.scrollable || (!landscape.fixed && landscape.pageCanScroll);
      if (!reachable) {
        drafts.push({
          info: CHECKS.navMenuFit,
          key: "menu-fit",
          element: landscape.selector,
          message: `Op een gsm in liggende stand (740 × 360) vallen ${landscape.hidden} van de ${landscape.linkCount} links in het menu onder het scherm, en het menu scrolt niet.`,
          evidence: { viewport: "740x360", hidden: landscape.hidden, links: landscape.linkCount },
        });
      }
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  return drafts;
}
