// Zet de ruwe paginagegevens om in bevindingen. Elke bevinding heeft een sleutel;
// dezelfde sleutel op meerdere pagina's wordt in de runner samengevoegd tot één bevinding.

import { CHECKS, type CheckInfo, type Finding } from "./types.js";
import type { RawForm, RawOverflow, RawPageData } from "./page-scripts.js";

export interface Draft extends Omit<Finding, "id" | "pages" | "browser" | "check" | "item" | "category" | "hint"> {
  info: CheckInfo;
  hint?: Finding["hint"];
  key: string;
}

const WEBFLOW_SUCCESS = "Thank you! Your submission has been received!";
const WEBFLOW_ERROR = "Oops! Something went wrong while submitting the form.";
const WEBFLOW_EMPTY = "No items found.";
const DEFAULT_ICON = /(website-files\.com|webflow\.com|webflow\.io)\/img\/(favicon\.ico|webclip\.png)/i;
const LANG_FORMAT = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

function short(url: string, max = 90): string {
  return url.length > max ? `…${url.slice(-max)}` : url;
}

export function isFilenameLike(alt: string): boolean {
  const a = alt.trim();
  return (
    /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(a) ||
    /^(img|image|dsc|dscn|pxl|photo|foto|screenshot|untitled|unnamed)[-_ ]?\d*/i.test(a) ||
    /^[a-z0-9]+([-_][a-z0-9]+){2,}$/i.test(a)
  );
}

function headingChecks(data: RawPageData, page: string): Draft[] {
  const drafts: Draft[] = [];
  const h1s = data.headings.filter((h) => h.level === 1);
  if (h1s.length !== 1) {
    drafts.push({
      info: CHECKS.heading1,
      key: page,
      message: h1s.length === 0 ? "Geen h1 op deze pagina." : `${h1s.length} h1's op deze pagina; er hoort er precies één te zijn.`,
      evidence: { count: h1s.length, h1s: h1s.slice(0, 5).map((h) => ({ text: h.text, selector: h.selector })) },
    });
  }
  const skips: Array<{ from: string; to: string; text: string; selector: string }> = [];
  for (let i = 1; i < data.headings.length; i++) {
    const prev = data.headings[i - 1];
    const cur = data.headings[i];
    if (cur.level > prev.level + 1) skips.push({ from: `h${prev.level}`, to: `h${cur.level}`, text: cur.text, selector: cur.selector });
  }
  if (skips.length > 0) {
    drafts.push({
      info: CHECKS.headingStructure,
      key: page,
      message: `Headingniveau ${skips.length} keer overgeslagen, bv. ${skips[0].from} naar ${skips[0].to} bij "${skips[0].text}".`,
      element: skips[0].selector,
      evidence: { count: skips.length, skips: skips.slice(0, 5) },
    });
  }
  return drafts;
}

function imageChecks(data: RawPageData, page: string): Draft[] {
  const drafts: Draft[] = [];
  const relevant = data.images.filter((img) => !img.decorative);
  const missing = relevant.filter((img) => img.alt === null);
  const filename = relevant.filter((img) => img.alt !== null && img.alt.trim() !== "" && isFilenameLike(img.alt));
  const empty = relevant.filter((img) => img.alt !== null && img.alt.trim() === "" && img.visible);
  const list = (imgs: typeof relevant) => imgs.slice(0, 10).map((i) => ({ src: short(i.src), alt: i.alt, selector: i.selector }));
  if (missing.length + filename.length > 0) {
    const parts = [];
    if (missing.length) parts.push(`${missing.length} zonder alt-attribuut`);
    if (filename.length) parts.push(`${filename.length} met een bestandsnaam als alt-tekst`);
    drafts.push({
      info: CHECKS.imageAlt,
      key: `${page}|alt`,
      message: `Afbeeldingen zonder bruikbare alt-tekst: ${parts.join(", ")}.`,
      element: (missing[0] ?? filename[0]).selector,
      evidence: { missing: missing.length, filename: filename.length, images: list([...missing, ...filename]) },
    });
  }
  if (empty.length > 0) {
    drafts.push({
      info: CHECKS.imageAlt,
      key: `${page}|empty-alt`,
      hint: "laag",
      label: "na te kijken",
      message: `${empty.length} zichtbare afbeelding(en) met een lege alt-tekst. Dat is enkel ok als ze decoratief zijn.`,
      element: empty[0].selector,
      evidence: { empty: empty.length, images: list(empty) },
    });
  }
  return drafts;
}

const CONTENT_MESSAGES: Record<string, string> = {
  lorem: "Lorem ipsum-tekst op de pagina.",
  "default-div": "Webflow-standaardtekst \"This is some text inside of a div block.\"",
  "default-heading": "Heading met de standaardtekst \"Heading\".",
  "placeholder-image": "Webflow-placeholderafbeelding in plaats van een echte afbeelding.",
};

function contentChecks(data: RawPageData, page: string): Draft[] {
  const byKind = new Map<string, RawPageData["textHits"]>();
  for (const hit of data.textHits) byKind.set(hit.kind, [...(byKind.get(hit.kind) ?? []), hit]);
  return [...byKind.entries()].map(([kind, hits]) => {
    const anyVisible = hits.some((h) => h.visible);
    return {
      info: CHECKS.missingContent,
      key: `${page}|${kind}`,
      label: anyVisible ? undefined : "na te kijken",
      message: `${CONTENT_MESSAGES[kind]} (${hits.length}×${anyVisible ? "" : ", niet zichtbaar"})`,
      element: hits[0].selector,
      evidence: { count: hits.length, hits: hits.slice(0, 10) },
    };
  });
}

const EMAIL_WORDS = /e-?mail|\bmail\b/i;
const PHONE_WORDS = /phone|\btel\b|telefoon|gsm|mobiel|mobile/i;

export function inputIssues(form: RawForm): Array<{ selector: string; name: string; issue: string }> {
  const issues: Array<{ selector: string; name: string; issue: string }> = [];
  for (const input of form.inputs) {
    const hay = [input.name, input.id, input.placeholder, input.label].join(" ");
    if (!input.name) issues.push({ selector: input.selector, name: input.name, issue: "geen name-attribuut" });
    else if (/^field( ?\d+)?$/i.test(input.name) || /^(name|email) \d+$/i.test(input.name)) {
      issues.push({ selector: input.selector, name: input.name, issue: `standaardnaam "${input.name}"` });
    }
    if (input.tag === "input" && EMAIL_WORDS.test(hay) && input.type !== "email") {
      issues.push({ selector: input.selector, name: input.name, issue: `e-mailveld met type "${input.type}" in plaats van "email"` });
    } else if (input.tag === "input" && PHONE_WORDS.test(hay) && input.type !== "tel") {
      issues.push({ selector: input.selector, name: input.name, issue: `telefoonveld met type "${input.type}" in plaats van "tel"` });
    }
  }
  return issues;
}

function formChecks(data: RawPageData): Draft[] {
  const drafts: Draft[] = [];
  for (const form of data.forms) {
    const formKey = `${form.dataName ?? ""}|${form.selector}`;
    const label = form.dataName ? `"${form.dataName}"` : form.selector;
    if (form.successText && form.successText.includes(WEBFLOW_SUCCESS)) {
      drafts.push({ info: CHECKS.formSuccess, key: formKey, element: form.selector, message: `Formulier ${label} toont de standaard succesmelding van Webflow.`, evidence: { text: form.successText } });
    }
    if (form.errorText && form.errorText.includes(WEBFLOW_ERROR)) {
      drafts.push({ info: CHECKS.formError, key: formKey, element: form.selector, message: `Formulier ${label} toont de standaard foutmelding van Webflow.`, evidence: { text: form.errorText } });
    }
    if (!form.dataName || /^(email )?form( \d+)?$/i.test(form.dataName.trim())) {
      drafts.push({ info: CHECKS.formName, key: formKey, element: form.selector, message: `Formulier heeft geen eigen naam (${form.dataName ? `"${form.dataName}"` : "geen data-name"}).`, evidence: { dataName: form.dataName } });
    }
    const issues = inputIssues(form);
    if (issues.length > 0) {
      drafts.push({ info: CHECKS.formInputs, key: formKey, element: issues[0].selector, message: `Formulier ${label}: ${issues.length} veld(en) met een standaardnaam of verkeerd type.`, evidence: { issues } });
    }
  }
  for (const state of data.emptyStates) {
    if (state.text === WEBFLOW_EMPTY) {
      drafts.push({ info: CHECKS.emptyState, key: state.selector, element: state.selector, message: `Lege collectielijst met de standaardtekst "${WEBFLOW_EMPTY}"`, evidence: { text: state.text } });
    }
  }
  return drafts;
}

function settingsChecks(data: RawPageData): Draft[] {
  const drafts: Draft[] = [];
  if (data.icons.length === 0) drafts.push({ info: CHECKS.favicon, key: "favicon-missing", message: "Geen favicon ingesteld." });
  else if (data.icons.some((u) => DEFAULT_ICON.test(u))) drafts.push({ info: CHECKS.favicon, key: "favicon-default", message: "Het Webflow-standaardfavicon wordt gebruikt.", evidence: { icons: data.icons } });
  if (data.touchIcons.length === 0) drafts.push({ info: CHECKS.favicon, key: "webclip-missing", hint: "laag", message: "Geen web clip (apple-touch-icon) ingesteld." });
  else if (data.touchIcons.some((u) => DEFAULT_ICON.test(u))) drafts.push({ info: CHECKS.favicon, key: "webclip-default", hint: "laag", message: "De standaard web clip van Webflow wordt gebruikt.", evidence: { touchIcons: data.touchIcons } });
  if (data.hasBadge) drafts.push({ info: CHECKS.webflowBadge, key: "badge", element: ".w-webflow-badge", message: "De Webflow-badge staat op de pagina." });
  if (!data.lang || !data.lang.trim()) drafts.push({ info: CHECKS.lang, key: "lang-missing", message: "Het html-element heeft geen lang-attribuut." });
  else if (!LANG_FORMAT.test(data.lang.trim())) drafts.push({ info: CHECKS.lang, key: `lang-invalid|${data.lang}`, message: `Ongeldige taalcode "${data.lang}".`, evidence: { lang: data.lang } });
  return drafts;
}

export function pageDrafts(data: RawPageData, page: string): Draft[] {
  return [...headingChecks(data, page), ...imageChecks(data, page), ...contentChecks(data, page), ...formChecks(data), ...settingsChecks(data)];
}

/** Eén bevinding per pagina, met alle viewports waar de pagina horizontaal scrolt. */
export function overflowDrafts(measurements: Array<{ width: number; m: RawOverflow }>, page: string): Draft[] {
  const scrolling = measurements.filter(({ m }) => m.canScrollX);
  const hidden = measurements.filter(({ m }) => !m.canScrollX && m.hiddenByOverflow && m.scrollWidth > m.viewportWidth + 1);
  const drafts: Draft[] = [];
  const detail = (list: typeof measurements) => list.map(({ width, m }) => ({ viewport: width, scrollWidth: m.scrollWidth, viewportWidth: m.viewportWidth, offenders: m.offenders }));
  if (scrolling.length > 0) {
    const widths = scrolling.map((s) => s.width);
    drafts.push({
      info: CHECKS.horizontalScroll,
      key: `${page}|scroll`,
      viewport: Math.min(...widths),
      element: scrolling.find((s) => s.m.offenders.length)?.m.offenders[0]?.selector,
      message: `De pagina scrolt horizontaal op ${widths.join(", ")} px.`,
      evidence: { viewports: detail(scrolling) },
    });
  }
  if (hidden.length > 0) {
    const widths = hidden.map((s) => s.width);
    drafts.push({
      info: CHECKS.horizontalScroll,
      key: `${page}|hidden`,
      hint: "laag",
      label: "na te kijken",
      viewport: Math.min(...widths),
      element: hidden.find((s) => s.m.offenders.length)?.m.offenders[0]?.selector,
      message: `Inhoud steekt uit op ${widths.join(", ")} px maar wordt verborgen door overflow op html of body. Op sommige mobiele browsers kan de pagina toch horizontaal scrollen.`,
      evidence: { viewports: detail(hidden) },
    });
  }
  return drafts;
}
