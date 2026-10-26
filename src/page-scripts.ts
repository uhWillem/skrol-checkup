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
  /** Decoratief gemarkeerd, of deel van de Webflow-badge of een kaartwidget: telt niet mee voor alt-teksten. */
  decorative: boolean;
  visible: boolean;
  /**
   * "empty": in een link of knop zonder andere tekst, aria-label of title;
   * "named": in een link of knop die al een naam heeft (dan is een lege alt juist goed);
   * "none": niet in een link of knop.
   */
  inLink: "none" | "empty" | "named";
  selector: string;
}

export interface RawTextHit {
  kind: "lorem" | "default-div" | "default-heading" | "placeholder-image" | "placeholder-upload";
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

  // Heeft een link of knop een naam voor schermlezers, buiten deze afbeelding?
  const hasOtherName = (link, img) => {
    if (clean(link.getAttribute("aria-label")) || clean(link.getAttribute("title"))) return true;
    const labelledBy = link.getAttribute("aria-labelledby");
    if (labelledBy && labelledBy.split(/\s+/).some((id) => { const el = document.getElementById(id); return el && clean(el.textContent); })) return true;
    if (clean(link.textContent)) return true;
    if ([...link.querySelectorAll("img")].some((other) => other !== img && clean(other.getAttribute("alt")))) return true;
    return [...link.querySelectorAll("[aria-label]")].some((el) => clean(el.getAttribute("aria-label")));
  };
  const images = [...document.querySelectorAll("img")].map((img) => {
    const link = img.closest("a[href], button");
    return {
      src: img.getAttribute("src") || img.currentSrc || "",
      alt: img.hasAttribute("alt") ? img.getAttribute("alt") : null,
      decorative:
        img.getAttribute("role") === "presentation" ||
        img.getAttribute("aria-hidden") === "true" ||
        !!img.closest("[aria-hidden='true']") ||
        !!img.closest(".w-webflow-badge") ||
        img.classList.contains("leaflet-tile"),
      visible: isVisible(img),
      inLink: !link ? "none" : hasOtherName(link, img) ? "named" : "empty",
      selector: selectorOf(img),
    };
  });

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
  const fileName = (url) => {
    try { return decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() || ""); } catch { return ""; }
  };
  for (const img of document.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (/placeholder\.[0-9a-f]+\.svg/i.test(src)) {
      textHits.push({ kind: "placeholder-image", text: src.slice(-60), visible: isVisible(img), selector: selectorOf(img) });
      continue;
    }
    // Zelf geüploade placeholders, bv. 6adb..._placeholder-p-500.jpg
    const name = [src, img.currentSrc || ""].map(fileName).find((n) => /(^|[_\-.\s])(placeholder|dummy)([_\-.\s]|$)/i.test(n));
    if (name) textHits.push({ kind: "placeholder-upload", text: name.slice(-60), visible: isVisible(img), selector: selectorOf(img) });
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

export interface RawLayout {
  overlaps: Array<{ a: string; b: string; textA: string; textB: string; area: number }>;
  clipped: Array<{ selector: string; text: string; outX: number; outY: number }>;
  outside: Array<{ selector: string; text: string; outX: number; outY: number }>;
  images: Array<{
    selector: string;
    src: string;
    natural: [number, number];
    rendered: [number, number];
    objectFit: string;
    stretched: boolean;
    scale: number;
  }>;
  /** Paren van beeld en tekst waar de tekst boven het beeld staat (enkel zinvol op mobiel). */
  textAbove: Array<{ selector: string; text: string }>;
}

/** Scrolt de pagina in stappen naar beneden, zodat lazy afbeeldingen laden en scroll-animaties afspelen. */
export const AUTO_SCROLL = String.raw`(async () => {
  const step = Math.max(300, Math.round(window.innerHeight * 0.8));
  const max = Math.min(document.documentElement.scrollHeight, 40000);
  for (let y = step; y < max + step; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 200));
})()`;

/**
 * Zoekt op de brede viewport secties met een beeld en een tekstblok naast elkaar
 * en markeert ze, zodat MEASURE_LAYOUT op mobiel de volgorde kan nakijken.
 */
export const MARK_PAIRS = String.raw`(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  const mediaArea = (el) => {
    let best = getComputedStyle(el).backgroundImage !== "none" ? area(el) : 0;
    for (const m of el.querySelectorAll("img, video, iframe, picture")) best = Math.max(best, area(m));
    for (const c of el.children) if (getComputedStyle(c).backgroundImage !== "none") best = Math.max(best, area(c));
    return best;
  };
  let n = 0;
  for (const p of document.body.querySelectorAll("*")) {
    if (n >= 50) break;
    const d = getComputedStyle(p).display;
    if (!/flex|grid/.test(d)) continue;
    const kids = [...p.children].filter((c) => {
      const s = getComputedStyle(c);
      return s.display !== "none" && s.position !== "absolute" && s.position !== "fixed" && c.getBoundingClientRect().height > 0;
    });
    if (kids.length < 2 || kids.length > 3) continue;
    let media = null, text = null;
    for (const c of kids) {
      const len = clean(c.innerText).length;
      const m = mediaArea(c);
      if (m >= 40000 && len < 30) media = c;
      else if (len >= 60 && m < 10000) text = c;
    }
    if (!media || !text) continue;
    const a = media.getBoundingClientRect(), b = text.getBoundingClientRect();
    const sideBySide = (a.right <= b.left + 5 || b.right <= a.left + 5) &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5 * Math.min(a.height, b.height);
    if (!sideBySide) continue;
    p.setAttribute("data-skrol-pair", String(n++));
    media.setAttribute("data-skrol-role", "media");
    text.setAttribute("data-skrol-role", "text");
  }
  return n;
})()`;

/** Meet bij de huidige viewport: overlappende tekst, afgesneden tekst, tekst buiten knoppen, afbeeldingen en beeld/tekst-volgorde. */
export const MEASURE_LAYOUT = String.raw`(() => {
  ${HELPERS}
  const sx = window.scrollX, sy = window.scrollY;
  const vw = document.documentElement.clientWidth;
  const styles = new Map();
  const cs = (el) => { let s = styles.get(el); if (!s) { s = getComputedStyle(el); styles.set(el, s); } return s; };
  const alpha = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return c === "transparent" ? 0 : 1;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean);
    return p.length >= 4 ? Number.parseFloat(p[3]) : 1;
  };
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "SELECT", "OPTION", "TEXTAREA", "IFRAME", "TEMPLATE", "CODE", "PRE"]);
  // Onderdelen die bewust bewegen, schuiven of verbergen: daar is overlap of afsnijden normaal.
  const SKIP_CLASS = /(^|[\s_-])(marquee|ticker|slider|carousel|swiper|splide|w-slider|w-tab-content|w-dropdown-list|w-nav-overlay|w-lightbox)([\s_-]|$)/i;
  const infos = new Map();
  const info = (el) => {
    if (!el || el.nodeType !== 1 || el === document.documentElement) return { skip: false, fixed: false, opacity: 1, hidden: false };
    let i = infos.get(el);
    if (i) return i;
    const parent = info(el.parentElement);
    const s = cs(el);
    const cls = el.getAttribute("class") || "";
    i = {
      skip: parent.skip || SKIP_TAGS.has(el.tagName.toUpperCase()) || SKIP_CLASS.test(cls) || el.getAttribute("aria-hidden") === "true",
      fixed: parent.fixed || s.position === "fixed" || s.position === "sticky",
      opacity: parent.opacity * (Number.isFinite(Number.parseFloat(s.opacity)) ? Number.parseFloat(s.opacity) : 1),
      hidden: parent.hidden || s.visibility === "hidden" || s.display === "none",
    };
    infos.set(el, i);
    return i;
  };
  const blockOf = (el) => {
    let n = el;
    while (n && n !== document.body) {
      const d = cs(n).display;
      if (d !== "inline" && d !== "contents") return n;
      n = n.parentElement;
    }
    return n;
  };

  // Tekstregels per blok, in paginacoördinaten.
  const owners = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let nodes = 0;
  for (let node = walker.nextNode(); node && nodes < 5000; node = walker.nextNode()) {
    const text = node.textContent;
    if (!text || text.trim().length < 2) continue;
    const el = node.parentElement;
    if (!el) continue;
    const inf = info(el);
    if (inf.skip || inf.fixed || inf.hidden || inf.opacity < 0.5) continue;
    const s = cs(el);
    if (alpha(s.color) < 0.5 || alpha(s.webkitTextFillColor || s.color) < 0.5) continue;
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width >= 4 && r.height >= 4 && r.right > 0 && r.left < vw);
    if (!rects.length) continue;
    nodes++;
    const owner = blockOf(el);
    let entry = owners.get(owner);
    if (!entry) { entry = { owner, id: owners.size, rects: [] }; owners.set(owner, entry); }
    for (const r of rects) entry.rects.push({ l: r.left + sx, t: r.top + sy, r: r.right + sx, b: r.bottom + sy });
  }

  // 1. Tekst die over andere tekst valt.
  const all = [];
  for (const entry of owners.values()) for (const r of entry.rects) all.push({ l: r.l, t: r.t, r: r.r, b: r.b, e: entry });
  all.sort((a, b) => a.t - b.t);
  const pairs = new Map();
  outer: for (let i = 0; i < all.length; i++) {
    const a = all[i];
    for (let j = i + 1; j < all.length && all[j].t < a.b; j++) {
      const b = all[j];
      if (a.e === b.e) continue;
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (w <= 2 || h <= 2) continue;
      const smaller = Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t));
      if (w * h < smaller * 0.3) continue;
      if (a.e.owner.contains(b.e.owner) || b.e.owner.contains(a.e.owner)) continue;
      const key = Math.min(a.e.id, b.e.id) + "|" + Math.max(a.e.id, b.e.id);
      if (!pairs.has(key)) pairs.set(key, { a: a.e.owner, b: b.e.owner, area: Math.round(w * h) });
      if (pairs.size >= 20) break outer;
    }
  }
  const overlaps = [...pairs.values()].map((p) => ({
    a: selectorOf(p.a), b: selectorOf(p.b),
    textA: clean(p.a.textContent).slice(0, 60), textB: clean(p.b.textContent).slice(0, 60), area: p.area,
  }));

  // 2. Tekst die deels wegvalt in een vak met overflow hidden.
  const clips = (s) => s.overflowX === "hidden" || s.overflowX === "clip" || s.overflowY === "hidden" || s.overflowY === "clip";
  const truncates = (s) => s.textOverflow === "ellipsis" || (s.webkitLineClamp && s.webkitLineClamp !== "none");
  const clipOf = (el) => {
    let n = el;
    for (let d = 0; n && n !== document.body && d < 6; d++, n = n.parentElement) if (clips(cs(n))) return n;
    return null;
  };
  const clipped = [];
  const seenClip = new Set();
  for (const entry of owners.values()) {
    if (clipped.length >= 20) break;
    if (truncates(cs(entry.owner))) continue;
    const box = clipOf(entry.owner);
    if (!box || seenClip.has(box)) continue;
    const bs = cs(box);
    if (truncates(bs)) continue;
    const br = box.getBoundingClientRect();
    if (br.width < 10 || br.height < 10) continue;
    const bl = br.left + sx + box.clientLeft, bt = br.top + sy + box.clientTop;
    const bR = bl + box.clientWidth, bB = bt + box.clientHeight;
    const clipX = bs.overflowX === "hidden" || bs.overflowX === "clip";
    const clipY = bs.overflowY === "hidden" || bs.overflowY === "clip";
    for (const r of entry.rects) {
      // Enkel tekst die deels zichtbaar is: helemaal erbuiten is bewust verborgen (bv. een dichtgeklapt blok).
      if (!(r.r > bl && r.l < bR && r.b > bt && r.t < bB)) continue;
      const outX = clipX ? Math.max(0, r.r - bR, bl - r.l) : 0;
      const outY = clipY ? Math.max(0, r.b - bB, bt - r.t) : 0;
      if (outX > 4 || outY > 4) {
        seenClip.add(box);
        clipped.push({ selector: selectorOf(box), text: clean(entry.owner.textContent).slice(0, 60), outX: Math.round(outX), outY: Math.round(outY) });
        break;
      }
    }
  }

  // 3. Tekst die buiten een knop, tag of badge loopt.
  const BTN = /(^|[\s_-])(button|btn|tag|pill|badge|chip)([\s_-]|$)/i;
  const painted = (s) =>
    alpha(s.backgroundColor) > 0.1 || s.backgroundImage !== "none" ||
    (Number.parseFloat(s.borderTopWidth) > 0 && alpha(s.borderTopColor) > 0.1) ||
    (Number.parseFloat(s.borderLeftWidth) > 0 && alpha(s.borderLeftColor) > 0.1);
  const buttonOf = (el) => {
    let n = el;
    for (let d = 0; n && n !== document.body && d < 3; d++, n = n.parentElement) {
      const isButton = n.tagName === "A" || n.tagName === "BUTTON" || BTN.test(n.getAttribute("class") || "");
      if (isButton && painted(cs(n))) return n;
    }
    return null;
  };
  const outside = [];
  const seenButton = new Set();
  for (const entry of owners.values()) {
    if (outside.length >= 20) break;
    const btn = buttonOf(entry.owner);
    if (!btn || seenButton.has(btn) || clips(cs(btn))) continue;
    const br = btn.getBoundingClientRect();
    const l = br.left + sx, t = br.top + sy, R = br.right + sx, B = br.bottom + sy;
    for (const r of entry.rects) {
      const outX = Math.max(0, r.r - R, l - r.l), outY = Math.max(0, r.b - B, t - r.t);
      if (outX > 3 || outY > 3) {
        seenButton.add(btn);
        outside.push({ selector: selectorOf(btn), text: clean(btn.textContent).slice(0, 60), outX: Math.round(outX), outY: Math.round(outY) });
        break;
      }
    }
  }

  // 4. Uitgerekte en wazige afbeeldingen.
  const images = [];
  for (const img of document.images) {
    if (images.length >= 30) break;
    if (!img.complete || !img.naturalWidth || !img.naturalHeight) continue;
    const src = img.currentSrc || img.src || "";
    if (/\.svg(\?|#|$)/i.test(src) || /^data:image\/svg/i.test(src)) continue;
    const inf = info(img);
    if (inf.skip || inf.hidden || inf.opacity < 0.5 || img.closest(".w-webflow-badge")) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const fit = cs(img).objectFit;
    const sw = r.width / img.naturalWidth, sh = r.height / img.naturalHeight;
    const stretched = fit === "fill" && Math.abs((r.width / r.height) / (img.naturalWidth / img.naturalHeight) - 1) > 0.05;
    const scale = fit === "contain" || fit === "scale-down" ? Math.min(sw, sh) : fit === "none" ? 1 : Math.max(sw, sh);
    if (!stretched && scale <= 1.25) continue;
    images.push({
      selector: selectorOf(img), src: src.slice(-120),
      natural: [img.naturalWidth, img.naturalHeight], rendered: [Math.round(r.width), Math.round(r.height)],
      objectFit: fit, stretched, scale: Math.round(scale * 100) / 100,
    });
  }

  // 5. Beeld en tekst: staat de tekst boven het beeld nu ze onder elkaar staan?
  const textAbove = [];
  for (const p of document.querySelectorAll("[data-skrol-pair]")) {
    const m = p.querySelector(":scope > [data-skrol-role='media']");
    const t = p.querySelector(":scope > [data-skrol-role='text']");
    if (!m || !t) continue;
    const mr = m.getBoundingClientRect(), tr = t.getBoundingClientRect();
    if (!mr.height || !tr.height) continue;
    if (tr.bottom <= mr.top + 5) textAbove.push({ selector: selectorOf(p), text: clean(t.innerText || t.textContent).slice(0, 60) });
  }

  return { overlaps, clipped, outside, images, textAbove };
})()`;
