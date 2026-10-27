// Herkenning van opvultekst, gedeeld door de controle in de browser (page-scripts.ts) en die op de
// CMS-items uit de Webflow API (webflow.ts), zodat beide dezelfde regel gebruiken.

/** Woorden uit lorem ipsum en de Latijnse opvultekst die Webflow in nieuwe CMS-items zet. */
export const LOREM_WORDS: readonly string[] = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed eiusmod tempor incididunt ut labore et dolore " +
  "aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure " +
  "reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa " +
  "qui officia deserunt mollit id est laborum vestibulum pellentesque tincidunt aliquam malesuada fringilla suspendisse viverra " +
  "ultricies imperdiet habitasse faucibus vulputate tristique senectus posuere ornare blandit placerat mattis porttitor bibendum " +
  "eleifend sagittis scelerisque lacinia pharetra volutpat molestie sodales mauris arcu nisl tellus tortor urna diam quisque " +
  "ligula felis montes etiam risus donec augue fusce fames habitant purus nunc odio morbi neque egestas gravida auctor accumsan " +
  "aenean elementum rhoncus lectus varius nibh dapibus sapien hendrerit euismod condimentum dictum semper eget ultrices iaculis " +
  "rutrum congue convallis facilisis lobortis luctus maecenas nullam phasellus praesent quam sollicitudin vehicula venenatis " +
  "vivamus vitae nec vel ac at in mi leo metus nisi sem ante justo erat lacus libero orci turpis velit massa aliquet"
).split(" ");

const LOREM = new Set(LOREM_WORDS);

/** Minstens 6 woorden, waarvan de helft uit de opvultekst, met minstens 4 verschillende. */
export function isPseudoLatin(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length < 6) return false;
  const hits = words.filter((w) => LOREM.has(w));
  return hits.length / words.length >= 0.5 && new Set(hits).size >= 4;
}

export function isFillerText(text: string): boolean {
  return /lorem ipsum|dolor sit amet/i.test(text) || isPseudoLatin(text);
}
