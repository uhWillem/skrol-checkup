// Zet de ruwe paginagegevens om in bevindingen. Elke bevinding heeft een sleutel;
// dezelfde sleutel op meerdere pagina's wordt in de runner samengevoegd tot één bevinding.

import { CHECKS, type CheckInfo, type Finding } from "./types.js";
import type { RawForm, RawLayout, RawOverflow, RawPageData } from "./page-scripts.js";

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
    // eindigt op een extensie: "team.jpg"
    /\.(jpe?g|png|webp|gif|svg|avif|heic)$/i.test(a) ||
    // camera- en schermafbeeldingsnamen met een nummer: "IMG_1234", "DSC00028", "PXL_20240101_120000"
    /^(img|dsc|dscn|dscf|pxl|mvimg|vid|screenshot|schermafbeelding)[-_ ]?\d{2,}/i.test(a) ||
    // enkel een algemeen woord, eventueel met een nummer: "image", "foto 3", "untitled"
    /^(image|img|photo|foto|afbeelding|picture|untitled|unnamed|screenshot)([-_ ]?\d+)?$/i.test(a) ||
    // slug van minstens drie delen zonder spaties: "hero-image-2x"
    /^[a-z0-9]+([-_][a-z0-9]+){2,}$/i.test(a)
  );
}

/** Woord in het pad dat wijst op een test- of kopiepagina, of null. */
export function testPageWord(path: string): string | null {
  for (const segment of path.toLowerCase().split("/")) {
    for (const token of segment.split(/[-_.]+/)) {
      if (/^(test|tests|testing|dummy|copy|kopie|untitled|lorem)\d*$/.test(token)) return token.replace(/\d+$/, "");
    }
  }
  return null;
}

/** Selector zonder volgnummers, zodat dezelfde soort afbeelding op elke pagina dezelfde sleutel krijgt. */
export function componentOf(selector: string): string {
  return selector.replace(/:nth-of-type\(\d+\)/g, "");
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

type AltProblem = "missing" | "filename" | "link" | "empty";

const ALT_MESSAGES: Record<AltProblem, (n: number, alt: string | null) => string> = {
  missing: (n) => `${n > 1 ? `${n} afbeeldingen` : "Afbeelding"} zonder alt-attribuut.`,
  filename: (n, alt) => `Bestandsnaam als alt-tekst, bv. "${alt}"${n > 1 ? ` (${n}×)` : ""}.`,
  link: (n) => `Link met enkel een afbeelding zonder alt-tekst${n > 1 ? ` (${n}×)` : ""}: de link heeft geen naam voor schermlezers.`,
  empty: (n) => `${n > 1 ? `${n} zichtbare afbeeldingen` : "Zichtbare afbeelding"} met een lege alt-tekst. Dat is enkel ok als ze decoratief zijn.`,
};

/**
 * Eén bevinding per soort probleem en per onderdeel (selector zonder volgnummers).
 * Zo wordt het logo in de navigatie één bevinding met alle pagina's, in plaats van één per pagina.
 */
function imageChecks(data: RawPageData): Draft[] {
  const groups = new Map<string, { problem: AltProblem; component: string; images: RawPageData["images"] }>();
  for (const img of data.images) {
    if (img.decorative) continue;
    const alt = img.alt?.trim();
    let problem: AltProblem | null = null;
    if (img.alt === null) problem = "missing";
    else if (alt && isFilenameLike(alt)) problem = "filename";
    // Een lege alt in een link die al tekst heeft (bv. een pijltje naast "Lees meer") is correct.
    else if (!alt && img.visible && img.inLink !== "named") problem = img.inLink === "empty" ? "link" : "empty";
    if (!problem) continue;
    const component = componentOf(img.selector);
    const key = `${problem}|${component}`;
    const group = groups.get(key) ?? { problem, component, images: [] };
    group.images.push(img);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, { problem, images }]) => ({
    info: CHECKS.imageAlt,
    key,
    hint: problem === "empty" ? "laag" : undefined,
    label: problem === "empty" ? "na te kijken" : undefined,
    message: ALT_MESSAGES[problem](images.length, images[0].alt),
    element: images[0].selector,
    evidence: { problem, count: images.length, images: images.slice(0, 5).map((i) => ({ src: short(i.src), alt: i.alt, selector: i.selector })) },
  }));
}

const CONTENT_MESSAGES: Record<string, string> = {
  lorem: "Lorem ipsum-tekst op de pagina.",
  "default-div": "Webflow-standaardtekst \"This is some text inside of a div block.\"",
  "default-heading": "Heading met de standaardtekst \"Heading\".",
  "placeholder-image": "Webflow-placeholderafbeelding in plaats van een echte afbeelding.",
  "placeholder-upload": "Afbeelding met \"placeholder\" of \"dummy\" in de bestandsnaam.",
};

function contentChecks(data: RawPageData, page: string): Draft[] {
  const byKind = new Map<string, RawPageData["textHits"]>();
  for (const hit of data.textHits) byKind.set(hit.kind, [...(byKind.get(hit.kind) ?? []), hit]);
  return [...byKind.entries()].map(([kind, hits]) => {
    const anyVisible = hits.some((h) => h.visible);
    // Een geüploade placeholder herkennen we enkel aan de bestandsnaam: altijd nakijken.
    const unsure = !anyVisible || kind === "placeholder-upload";
    return {
      info: CHECKS.missingContent,
      key: `${page}|${kind}`,
      label: unsure ? "na te kijken" : undefined,
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

export interface PageContext {
  /** De check-up draait op een .webflow.io-domein (staging). */
  onWebflowIo: boolean;
}

function settingsChecks(data: RawPageData, ctx: PageContext): Draft[] {
  const drafts: Draft[] = [];
  if (data.icons.length === 0) drafts.push({ info: CHECKS.favicon, key: "favicon-missing", message: "Geen favicon ingesteld." });
  else if (data.icons.some((u) => DEFAULT_ICON.test(u))) drafts.push({ info: CHECKS.favicon, key: "favicon-default", message: "Het Webflow-standaardfavicon wordt gebruikt.", evidence: { icons: data.icons } });
  if (data.touchIcons.length === 0) drafts.push({ info: CHECKS.favicon, key: "webclip-missing", hint: "laag", message: "Geen web clip (apple-touch-icon) ingesteld." });
  else if (data.touchIcons.some((u) => DEFAULT_ICON.test(u))) drafts.push({ info: CHECKS.favicon, key: "webclip-default", hint: "laag", message: "De standaard web clip van Webflow wordt gebruikt.", evidence: { touchIcons: data.touchIcons } });
  if (data.hasBadge) {
    drafts.push(
      ctx.onWebflowIo
        ? {
            info: CHECKS.webflowBadge,
            key: "badge",
            label: "na te kijken",
            element: ".w-webflow-badge",
            message: "De Webflow-badge staat op de pagina. Op een .webflow.io-domein toont Webflow die altijd als de site geen betaald site plan heeft; controleer het site plan of het live domein.",
          }
        : { info: CHECKS.webflowBadge, key: "badge", element: ".w-webflow-badge", message: "De Webflow-badge staat op de pagina." },
    );
  }
  if (!data.lang || !data.lang.trim()) drafts.push({ info: CHECKS.lang, key: "lang-missing", message: "Het html-element heeft geen lang-attribuut." });
  else if (!LANG_FORMAT.test(data.lang.trim())) drafts.push({ info: CHECKS.lang, key: `lang-invalid|${data.lang}`, message: `Ongeldige taalcode "${data.lang}".`, evidence: { lang: data.lang } });
  return drafts;
}

export function pageDrafts(data: RawPageData, page: string, ctx: PageContext = { onWebflowIo: false }): Draft[] {
  return [...headingChecks(data, page), ...imageChecks(data), ...contentChecks(data, page), ...formChecks(data), ...settingsChecks(data, ctx), ...testPageChecks(page)];
}

function testPageChecks(page: string): Draft[] {
  const word = testPageWord(page);
  if (!word) return [];
  return [
    {
      info: CHECKS.testPage,
      key: page,
      label: "na te kijken",
      message: `Het adres bevat "${word}": mogelijk een test- of kopiepagina of een testitem uit het CMS dat niet online hoort.`,
      evidence: { word },
    },
  ];
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

/** Schermbreedtes tot en met deze breedte gelden als mobiel voor de volgorde van beeld en tekst. */
export const MOBILE_MAX = 480;

/**
 * Lay-outbevindingen van één pagina over alle schermbreedtes heen: één bevinding per soort en per onderdeel,
 * met de breedtes waarop ze voorkomt.
 */
export function layoutDrafts(measurements: Array<{ width: number; l: RawLayout }>, page: string): Draft[] {
  const groups = new Map<string, { make: (widths: number[]) => Draft; widths: number[] }>();
  const add = (key: string, width: number, make: (widths: number[]) => Draft) => {
    const group = groups.get(key);
    if (group) {
      if (!group.widths.includes(width)) group.widths.push(width);
    } else groups.set(key, { make, widths: [width] });
  };
  for (const { width, l } of measurements) {
    for (const o of l.overlaps) {
      const [first, second] = [componentOf(o.a), componentOf(o.b)].sort();
      add(`overlap|${first}|${second}`, width, (widths) => ({
        info: CHECKS.overlap,
        key: `overlap|${first}|${second}`,
        label: "na te kijken",
        element: o.a,
        message: `Tekst valt over andere tekst op ${widths.join(", ")} px: "${o.textA}" en "${o.textB}".`,
        evidence: { viewports: widths, a: o.a, b: o.b, textA: o.textA, textB: o.textB, area: o.area },
      }));
    }
    for (const c of l.clipped) {
      const key = `clipped|${componentOf(c.selector)}`;
      add(key, width, (widths) => ({
        info: CHECKS.clippedText,
        key,
        label: "na te kijken",
        element: c.selector,
        message: `Tekst wordt afgesneden op ${widths.join(", ")} px: "${c.text}".`,
        evidence: { viewports: widths, text: c.text, hiddenPx: { x: c.outX, y: c.outY } },
      }));
    }
    for (const o of l.outside) {
      const key = `outside|${componentOf(o.selector)}`;
      add(key, width, (widths) => ({
        info: CHECKS.textOutside,
        key,
        label: "na te kijken",
        element: o.selector,
        message: `Tekst loopt buiten de knop op ${widths.join(", ")} px: "${o.text}".`,
        evidence: { viewports: widths, text: o.text, outsidePx: { x: o.outX, y: o.outY } },
      }));
    }
    for (const img of l.images) {
      const component = componentOf(img.selector);
      if (img.stretched) {
        add(`stretched|${component}`, width, (widths) => ({
          info: CHECKS.imageQuality,
          key: `stretched|${component}`,
          element: img.selector,
          message: `Afbeelding is uitgerekt op ${widths.join(", ")} px: ${img.natural.join("×")} getoond als ${img.rendered.join("×")} zonder object-fit.`,
          evidence: { problem: "stretched", viewports: widths, src: img.src, natural: img.natural, rendered: img.rendered, objectFit: img.objectFit },
        }));
      }
      if (img.scale > 1.25) {
        add(`blurry|${component}`, width, (widths) => ({
          info: CHECKS.imageQuality,
          key: `blurry|${component}`,
          element: img.selector,
          message: `Afbeelding wordt ${img.scale}× vergroot op ${widths.join(", ")} px (bron ${img.natural[0]} px breed, getoond op ${img.rendered[0]} px) en is daardoor wazig.`,
          evidence: { problem: "blurry", viewports: widths, src: img.src, natural: img.natural, rendered: img.rendered, scale: img.scale },
        }));
      }
    }
    if (width <= MOBILE_MAX) {
      for (const t of l.textAbove) {
        const key = `order|${componentOf(t.selector)}`;
        add(key, width, (widths) => ({
          info: CHECKS.imageTextOrder,
          key,
          label: "na te kijken",
          element: t.selector,
          message: `Op ${widths.join(", ")} px staat de tekst boven de afbeelding: "${t.text}". Volgens de checklist komt de afbeelding op mobiel boven de tekst.`,
          evidence: { viewports: widths, text: t.text },
        }));
      }
    }
  }
  return [...groups.values()].map(({ make, widths }) => {
    const sorted = [...widths].sort((a, b) => b - a);
    return { ...make(sorted), viewport: Math.min(...sorted) };
  });
}
