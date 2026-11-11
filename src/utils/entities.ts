/**
 * Shared HTML/XML entity decoding for the Worker (no DOMParser available).
 *
 * Decoding is done in a SINGLE pass with a callback. Chaining replacements such
 * as `.replace(/&amp;/g, '&').replace(/&lt;/g, '<')` is unsafe: `&amp;lt;`
 * would first become `&lt;` and then be decoded a second time into `<`, turning
 * literal text into markup. A single pass never re-reads its own output.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', middot: '·', copy: '©', reg: '®', trade: '™',
};

/** Decode named and numeric HTML/XML entities, e.g. `&#43;` -> '+' or `&amp;` -> '&'. */
export function decodeHtmlEntities(input: string): string {
  if (!input || !input.includes('&')) return input;
  return input.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    if (code.startsWith('#')) {
      const num = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}
