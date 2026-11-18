import type { Config } from "./config.js";
import { launchChromium } from "./browser.js";
import type { CheckupResult } from "./runner.js";
import type { Finding, Job } from "./types.js";

// Het downloadbare rapport van het dashboard: de bevindingen zoals de tool ze vond, nog niet nagekeken.
// Het nagekeken bugrapport maakt Claude met de skill webflow-checkup.

/** Soorten fouten, in dezelfde volgorde en indeling als het rapport van de skill. */
export const SOORTEN: ReadonlyArray<{ name: string; checks: readonly string[] }> = [
  { name: "Inhoud", checks: ["missing-content", "test-page", "draft-pages"] },
  { name: "Responsive", checks: ["horizontal-scroll", "overlap", "clipped-text", "text-outside", "image-text-order"] },
  { name: "Links", checks: ["broken-links", "empty-links"] },
  { name: "Formulieren", checks: ["form-success-message", "form-error-message", "form-name", "form-inputs"] },
  {
    name: "SEO",
    checks: [
      "heading-1", "heading-structure", "image-alt", "seo-title", "seo-description", "seo-migration", "redirects",
      "slugs", "schema", "page-structure", "indexing", "noindex", "sitemap", "default-domain",
    ],
  },
  { name: "Navigatie en logo", checks: ["nav-sticky", "nav-scroll-lock", "nav-menu-fit", "logo-link", "logo-format"] },
  { name: "Afbeeldingen en stijl", checks: ["image-quality", "hover-state", "fonts", "heading-style", "input-style"] },
  { name: "CMS", checks: ["empty-state", "cms-seo", "cms-slugs", "cms-fields", "cms-items", "cms-content", "conditional-visibility"] },
  { name: "Projectinstellingen", checks: ["webflow-badge", "favicon", "lang", "gtm", "timezone", "page-names"] },
];
const OTHER = "Overig";

/** Prioriteit zoals in het rapport: de hint van de tool, of "na te kijken" als de tool het niet zeker weet. */
export type Prio = "hoog" | "midden" | "laag" | "na";
const PRIOS: Prio[] = ["hoog", "midden", "laag", "na"];
const PRIO_LABEL: Record<Prio, string> = { hoog: "Hoog", midden: "Midden", laag: "Laag", na: "Na te kijken" };

export function prioOf(f: Finding): Prio {
  return f.label === "na te kijken" ? "na" : f.hint;
}

export function soortOf(check: string): string {
  return SOORTEN.find((s) => s.checks.includes(check))?.name ?? OTHER;
}

/** Bevindingen per soort, binnen een soort eerst hoog, dan midden, laag en na te kijken. */
function grouped(findings: Finding[]): Array<{ name: string; findings: Finding[] }> {
  const names = [...SOORTEN.map((s) => s.name), OTHER];
  return names
    .map((name) => ({
      name,
      findings: findings
        .filter((f) => soortOf(f.check) === name)
        .sort((a, b) => PRIOS.indexOf(prioOf(a)) - PRIOS.indexOf(prioOf(b))),
    }))
    .filter((g) => g.findings.length > 0);
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const DATE = new Intl.DateTimeFormat("nl-BE", {
  timeZone: "Europe/Brussels",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" });

function formatDate(iso?: string): string {
  return iso ? DATE.format(new Date(iso)) : "onbekend";
}

export function formatDuration(from?: string, to?: string): string {
  if (!from || !to) return "";
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} u ${m % 60} min`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "site";
  }
}

/** Bv. checkup-klant.webflow.io-2026-11-18.pdf */
export function reportFileName(job: Job, ext: "pdf" | "csv"): string {
  const day = DAY.format(new Date(job.finishedAt ?? job.createdAt));
  return `checkup-${hostOf(job.url).replace(/[^a-z0-9.-]/gi, "")}-${day}.${ext}`;
}

const MAX_PAGES_PER_FINDING = 8;

function findingRow(f: Finding, origin: string): string {
  const prio = prioOf(f);
  const details = [
    f.element ? `Element: ${esc(cut(f.element, 160))}` : "",
    // De schermbreedtes staan meestal al in de melding.
    f.viewport && !f.message.includes(`${f.viewport} px`) ? `Schermbreedte: ${f.viewport} px` : "",
    `Checklist: ${esc(f.item)}`,
  ].filter(Boolean);
  const shown = f.pages.slice(0, MAX_PAGES_PER_FINDING).map((p) => `<a href="${esc(origin + p)}">${esc(p)}</a>`);
  const more = f.pages.length - shown.length;
  return `<tr>
  <td class="prio"><span class="dot ${prio}"></span>${PRIO_LABEL[prio]}</td>
  <td><div class="msg">${esc(f.message)}</div><div class="meta">${details.join("<br>")}</div></td>
  <td class="pages">${shown.join("<br>")}${more > 0 ? `<br><span class="meta">en nog ${more}</span>` : ""}</td>
</tr>`;
}

export function reportHtml(job: Job, result: CheckupResult): string {
  const origin = new URL(result.startUrl).origin;
  const host = hostOf(result.startUrl);
  const s = result.summary;
  const groups = grouped(result.findings);
  const count = (list: Finding[], p: Prio) => list.filter((f) => prioOf(f) === p).length;
  const dot = (p: Prio) => `<span class="dot ${p}" title="${PRIO_LABEL[p]}"></span>`;

  const overview = groups
    .map((g) => `<tr><td>${esc(g.name)}</td>${PRIOS.map((p) => `<td class="num">${count(g.findings, p) || ""}</td>`).join("")}<td class="num">${g.findings.length}</td></tr>`)
    .join("\n");
  const totals = `<tr class="total"><td>Totaal</td>${PRIOS.map((p) => `<td class="num">${count(result.findings, p)}</td>`).join("")}<td class="num">${result.findings.length}</td></tr>`;

  const sections = groups
    .map(
      (g) => `<section>
<h2>${esc(g.name)} <span class="count">${g.findings.length}</span></h2>
<table class="findings">
<colgroup><col style="width:15%"><col style="width:58%"><col style="width:27%"></colgroup>
<thead><tr><th>Prioriteit</th><th>Bevinding</th><th>Pagina's</th></tr></thead>
<tbody>
${g.findings.map((f) => findingRow(f, origin)).join("\n")}
</tbody>
</table>
</section>`,
    )
    .join("\n");

  const details: Array<[string, string]> = [
    ["Site", `<a href="${esc(result.startUrl)}">${esc(result.startUrl)}</a>`],
    ["Live domein", s.liveDomain ? `${esc(s.liveDomain)} (${s.liveDomainSource === "sitemap" ? "uit de sitemap" : "opgegeven"})` : "geen: links naar het live domein tellen als externe links"],
    ["Gestart", esc(formatDate(job.startedAt ?? job.createdAt))],
    ["Duur", esc(formatDuration(job.startedAt, job.finishedAt))],
    ["Pagina's", `${s.pages} gecontroleerd${s.pagesWithErrors ? `, ${s.pagesWithErrors} met een fout` : ""}${s.stoppedAtMaxPages ? ", gestopt aan het maximum aantal pagina's" : ""}`],
  ];
  if (s.webflow) details.push(["Webflow", `site "${esc(s.webflow.site)}" gelezen${s.webflow.items !== undefined ? `, ${s.webflow.items} CMS-items` : ""}`]);
  if (s.migration) {
    const m = s.migration;
    details.push(["Oude site", `${esc(m.oldSite)}: ${m.oldPages} pagina's, ${m.same} op hetzelfde pad, ${m.redirected} met een redirect, ${m.missing} zonder pagina of redirect`]);
  }
  details.push(["Job", esc(job.id)]);

  const byReason = new Map<string, string[]>();
  for (const { check, reason } of s.skipped ?? []) byReason.set(reason, [...(byReason.get(reason) ?? []), check]);
  const skipped = [...byReason]
    .map(([reason, checks]) => `<li><span class="code">${checks.map(esc).join(", ")}</span>: ${esc(reason)}</li>`)
    .join("\n");

  const broken = result.pages.filter((p) => p.error || (p.status ?? 0) >= 400);
  const brokenList = broken
    .slice(0, 100)
    .map((p) => `<li><a href="${esc(p.url)}">${esc(p.path)}</a>: ${esc(p.error ? cut(p.error, 160) : `HTTP ${p.status}`)}</li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>Check-up ${esc(host)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; color: #1d2126; font: 9.5pt/1.45 "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif; }
  h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 3pt; letter-spacing: -0.015em; overflow-wrap: anywhere; }
  .lead { margin: 0 0 14pt; color: #4c535c; max-width: 62ch; }
  h2 { font-size: 13pt; margin: 20pt 0 6pt; break-after: avoid; }
  h2 .count { color: #69707a; font-weight: 400; }
  a { color: #1f55c2; text-decoration: none; }
  dl { display: grid; grid-template-columns: 26mm 1fr; gap: 3pt 10pt; margin: 0 0 14pt; }
  dt { color: #69707a; }
  dd { margin: 0; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  th { text-align: left; font-weight: 600; font-size: 8.5pt; color: #4c535c; padding: 4pt 6pt; border-bottom: 1pt solid #1d2126; }
  td { padding: 5pt 6pt; vertical-align: top; border-bottom: 0.5pt solid #e1e3e6; overflow-wrap: anywhere; }
  tbody tr:nth-child(even) td { background: #f4f3f0; }
  tr { break-inside: avoid; }
  .overview { width: auto; min-width: 60%; margin-bottom: 4pt; }
  .overview td, .overview th { padding: 3pt 10pt 3pt 0; }
  .overview th.num, .num { text-align: right; font-variant-numeric: tabular-nums; }
  .overview .total td { font-weight: 600; border-top: 1pt solid #1d2126; border-bottom: none; background: none; }
  .prio { white-space: nowrap; }
  .dot { display: inline-block; width: 8pt; height: 8pt; border-radius: 50%; margin-right: 4pt; vertical-align: -0.5pt; }
  .dot.hoog { background: #d93b30; }
  .dot.midden { background: #f08c00; }
  .dot.laag { background: #e3bd2d; }
  .dot.na { background: #fff; box-shadow: inset 0 0 0 1pt #8d939b; }
  .msg { margin-bottom: 2pt; }
  .meta { color: #69707a; font-size: 8pt; }
  .pages { font-size: 8.5pt; }
  .code { font-family: "DejaVu Sans Mono", Menlo, Consolas, monospace; font-size: 8pt; }
  ul { margin: 0; padding-left: 14pt; }
  li { margin-bottom: 2pt; }
  .empty { color: #4c535c; }
</style>
</head>
<body>
<h1>Check-up ${esc(host)}</h1>
<p class="lead">De bevindingen zoals de tool ze vond, nog niet nagekeken. Wat "na te kijken" is, kon de tool niet zeker vaststellen. Het nagekeken bugrapport maakt Claude met de skill webflow-checkup.</p>
<dl>
${details.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("\n")}
</dl>
${
  result.findings.length === 0
    ? `<p class="empty">De tool vond niets op deze site.</p>`
    : `<table class="overview">
<thead><tr><th>Soort</th>${PRIOS.map((p) => `<th class="num">${dot(p)}${PRIO_LABEL[p]}</th>`).join("")}<th class="num">Totaal</th></tr></thead>
<tbody>
${overview}
${totals}
</tbody>
</table>
${sections}`
}
${skipped ? `<section><h2>Niet gecontroleerd</h2><ul>${skipped}</ul></section>` : ""}
${broken.length ? `<section><h2>Pagina's met een fout <span class="count">${broken.length}</span></h2><ul>${brokenList}</ul></section>` : ""}
</body>
</html>`;
}

/** Zet een HTML-rapport om naar PDF in Chromium, zonder scripts en zonder netwerk. */
export async function renderPdf(html: string, title: string, config: Config): Promise<Buffer> {
  const browser = await launchChromium(config);
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;padding:0 14mm;font:7.5pt Helvetica,Arial,sans-serif;color:#8d939b;display:flex;justify-content:space-between"><span>${esc(title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function csvCell(value: unknown): string {
  let s = value === undefined || value === null ? "" : String(value);
  // Tekst van de gecontroleerde site mag in Excel geen formule worden.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Alle bevindingen als CSV met puntkomma's (zoals Excel in België en Nederland verwacht) en een BOM,
 * zodat Excel en Google Sheets de tekens juist lezen.
 */
export function findingsCsv(result: CheckupResult): string {
  const origin = new URL(result.startUrl).origin;
  const header = [
    "Soort", "Prioriteit", "Na te kijken", "Bevinding", "Checklist-punt", "Categorie", "Controle", "Element",
    "Schermbreedte", "Aantal pagina's", "Pagina's", "Bewijs", "ID",
  ];
  const rows = grouped(result.findings).flatMap((g) =>
    g.findings.map((f) => [
      g.name,
      f.hint,
      f.label === "na te kijken" ? "ja" : "",
      f.message,
      f.item,
      f.category,
      f.check,
      f.element ?? "",
      f.viewport ?? "",
      f.pages.length,
      f.pages.map((p) => origin + p).join("\n"),
      f.evidence ? cut(JSON.stringify(f.evidence), 2000) : "",
      f.id,
    ]),
  );
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
