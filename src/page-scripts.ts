// Scripts die in de pagina draaien. Ze staan als tekst in de code, zodat de
// TypeScript-compiler er niets aan verandert dat de browser niet kent.

export interface RawHeading {
  level: number;
  text: string;
  visible: boolean;
  selector: string;
}

export interface RawImage {
  src: string;
  alt: string | null;
  decorative: boolean;
  visible: boolean;
  selector: string;
}

export interface RawTextHit {
  kind: "lorem" | "default-div" | "default-heading" | "placeholder-image";
  text: string;
  visible: boolean;
  selector: string;
}

export interface RawInput {
  name: string;
  type: string;
  tag: string;
  id: string;
  placeholder: string;
  label: string;
  selector: string;
}

export interface RawForm {
  dataName: string | null;
  name: string | null;
  selector: string;
  successText: string | null;
  errorText: string | null;
  inputs: RawInput[];
}

export interface RawLink {
  raw: string;
  href: string;
  text: string;
  className: string;
  role: string;
  selector: string;
}

export interface RawPageData {
  title: string;
  lang: string | null;
  headings: RawHeading[];
  images: RawImage[];
  textHits: RawTextHit[];
  forms: RawForm[];
  emptyStates: Array<{ text: string; selector: string }>;
  icons: string[];
  touchIcons: string[];
  hasBadge: boolean;
  links: RawLink[];
}

export interface RawOverflow {
  viewportWidth: number;
  scrollWidth: number;
  canScrollX: boolean;
  hiddenByOverflow: boolean;
  offenders: Array<{ selector: string; right: number; width: number }>;
}

const HELPERS = String.raw`
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const isVisible = (el) => {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  };
  const selectorOf = (el) => {
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + "#" + CSS.escape(node.id)); break; }
      const cls = [...node.classList].filter((c) => !c.startsWith("w--"))[0];
      if (cls) part += "." + CSS.escape(cls);
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName && (!cls || c.classList.contains(cls)));
        if (same.length > 1) part += ":nth-of-type(" + ([...parent.children].filter((c) => c.tagName === node.tagName).indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
      if (node && (node.tagName === "BODY" || node.tagName === "HTML")) break;
    }
    return parts.join(" > ");
  };
`;

export const COLLECT_PAGE_DATA = String.raw`(() => {
  ${HELPERS}
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => ({
    level: Number(h.tagName[1]),
    text: clean(h.textContent).slice(0, 120),
    visible: isVisible(h),
    selector: selectorOf(h),
  }));

  const images = [...document.querySelectorAll("img")].map((img) => ({
    src: img.currentSrc || img.getAttribute("src") || "",
    alt: img.hasAttribute("alt") ? img.getAttribute("alt") : null,
    decorative: img.getAttribute("role") === "presentation" || img.getAttribute("aria-hidden") === "true" || !!img.closest("[aria-hidden='true']"),
    visible: isVisible(img),
    selector: selectorOf(img),
  }));

  const textHits = [];
  const leafish = [...document.body.querySelectorAll("p, span, div, h1, h2, h3, h4, h5, h6, li, a, label, blockquote, figcaption, td, th, strong, em")];
  for (const el of leafish) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ");
    const text = clean(own);
    if (!text) continue;
    if (/lorem ipsum|dolor sit amet/i.test(text)) textHits.push({ kind: "lorem", text: text.slice(0, 80), visible: isVisible(el), selector: selectorOf(el) });
    else if (text === "This is some text inside of a div block.") textHits.push({ kind: "default-div", text, visible: isVisible(el), selector: selectorOf(el) });
    else if (/^H[1-6]$/.test(el.tagName) && text === "Heading") textHits.push({ kind: "default-heading", text, visible: isVisible(el), selector: selectorOf(el) });
  }
  for (const img of document.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (/placeholder\.[0-9a-f]+\.svg/i.test(src)) textHits.push({ kind: "placeholder-image", text: src.slice(-60), visible: isVisible(img), selector: selectorOf(img) });
  }

  const labelFor = (input) => {
    if (input.id) {
      const l = document.querySelector("label[for='" + CSS.escape(input.id) + "']");
      if (l) return clean(l.textContent);
    }
    const wrap = input.closest("label");
    return wrap ? clean(wrap.textContent) : "";
  };
  const forms = [...document.querySelectorAll("form")].map((form) => {
    const wrapper = form.closest(".w-form") || form.parentElement;
    const done = wrapper ? wrapper.querySelector(".w-form-done") : null;
    const fail = wrapper ? wrapper.querySelector(".w-form-fail") : null;
    const inputs = [...form.querySelectorAll("input, textarea, select")]
      .filter((i) => !["hidden", "submit", "button", "reset", "image"].includes((i.getAttribute("type") || "").toLowerCase()))
      .map((i) => ({
        name: i.getAttribute("name") || "",
        type: (i.getAttribute("type") || (i.tagName === "INPUT" ? "text" : i.tagName.toLowerCase())).toLowerCase(),
        tag: i.tagName.toLowerCase(),
        id: i.id || "",
        placeholder: i.getAttribute("placeholder") || "",
        label: labelFor(i),
        selector: selectorOf(i),
      }));
    return {
      dataName: form.getAttribute("data-name"),
      name: form.getAttribute("name"),
      selector: selectorOf(form),
      successText: done ? clean(done.textContent) : null,
      errorText: fail ? clean(fail.textContent) : null,
      inputs,
    };
  });

  const emptyStates = [...document.querySelectorAll(".w-dyn-empty")].map((el) => ({ text: clean(el.textContent), selector: selectorOf(el) }));

  const relLinks = (pattern) => [...document.querySelectorAll("link[rel]")]
    .filter((l) => pattern.test(l.getAttribute("rel") || ""))
    .map((l) => l.href);

  const links = [...document.querySelectorAll("a")].map((a) => ({
    raw: a.getAttribute("href") ?? "",
    href: a.href || "",
    text: clean(a.textContent).slice(0, 60),
    className: typeof a.className === "string" ? a.className : "",
    role: a.getAttribute("role") || "",
    selector: selectorOf(a),
  }));

  return {
    title: document.title,
    lang: document.documentElement.getAttribute("lang"),
    headings,
    images,
    textHits,
    forms,
    emptyStates,
    icons: relLinks(/(^|\s)icon(\s|$)/i),
    touchIcons: relLinks(/apple-touch-icon/i),
    hasBadge: !!document.querySelector(".w-webflow-badge"),
    links,
  };
})()`;

/** Meet horizontale overloop bij de huidige viewport. */
export const MEASURE_OVERFLOW = String.raw`(() => {
  ${HELPERS}
  const doc = document.documentElement;
  const viewportWidth = doc.clientWidth;
  const scrollWidth = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const htmlStyle = getComputedStyle(doc);
  const bodyStyle = document.body ? getComputedStyle(document.body) : htmlStyle;
  const hiddenByOverflow = ["hidden", "clip"].includes(htmlStyle.overflowX) || ["hidden", "clip"].includes(bodyStyle.overflowX);
  // Met overflow hidden kan een script nog scrollen, een bezoeker niet; dat telt dus niet als scrollen.
  const before = window.scrollX;
  window.scrollTo(100000, window.scrollY);
  const canScrollX = window.scrollX > 0 && !hiddenByOverflow;
  window.scrollTo(before, window.scrollY);
  const offenders = [];
  if (scrollWidth > viewportWidth + 1) {
    for (const el of document.body.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= viewportWidth + 1) continue;
      const parent = el.parentElement;
      if (parent && parent !== document.body) {
        const pr = parent.getBoundingClientRect();
        if (pr.right > viewportWidth + 1) continue;
        const ps = getComputedStyle(parent);
        if (["hidden", "clip"].includes(ps.overflowX)) continue;
      }
      if (!isVisible(el)) continue;
      offenders.push({ selector: selectorOf(el), right: Math.round(rect.right), width: Math.round(rect.width) });
      if (offenders.length >= 5) break;
    }
  }
  return { viewportWidth, scrollWidth, canScrollX, hiddenByOverflow, offenders };
})()`;
