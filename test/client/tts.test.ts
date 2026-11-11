/**
 * Paragraph model tests.
 *
 * These exercise `collectLeafBlocks` against plain `BlockLike` objects rather
 * than real HTML, because the suite runs in the Workers pool with no DOM. The
 * walk only reads `tagName` / `children` / `textContent`, so this covers the
 * same code path the browser uses.
 *
 * `extractBlocksFromHtml` (the thin DOM adapter) is intentionally not tested
 * here — it needs `document` and does nothing beyond calling this walk.
 */
import { describe, it, expect } from 'vitest';
import {
  collectLeafBlocks,
  extractBlockTexts,
  isBlockNode,
  BLOCK_TAGS,
  type BlockLike,
} from '../../src/client/services/tts-utils';

/** Build a fake element. Strings become text content of the parent. */
function el(tagName: string, ...children: Array<BlockLike | string>): BlockLike {
  const elements = children.filter((child): child is BlockLike => typeof child !== 'string');
  const textContent = children
    .map((child) => (typeof child === 'string' ? child : child.textContent ?? ''))
    .join('');
  return { tagName, children: elements, textContent };
}

describe('isBlockNode', () => {
  it('recognises block tags case-insensitively', () => {
    expect(isBlockNode(el('p'))).toBe(true);
    expect(isBlockNode(el('DIV'))).toBe(true);
    expect(isBlockNode(el('blockquote'))).toBe(true);
  });

  it('treats inline and unknown tags as transparent', () => {
    expect(isBlockNode(el('span'))).toBe(false);
    expect(isBlockNode(el('strong'))).toBe(false);
    expect(isBlockNode(el('custom-element'))).toBe(false);
  });

  it('covers the documented tag set', () => {
    for (const tag of ['P', 'DIV', 'H1', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH']) {
      expect(BLOCK_TAGS.has(tag)).toBe(true);
    }
  });
});

describe('collectLeafBlocks', () => {
  it('returns one leaf per top-level paragraph', () => {
    const root = el('DIV', el('P', 'First.'), el('P', 'Second.'));
    expect(extractBlockTexts(root)).toEqual(['First.', 'Second.']);
  });

  it('recurses into a container block instead of treating it as a paragraph', () => {
    const root = el('DIV', el('P', 'Inner paragraph'));
    const blocks = collectLeafBlocks(root);
    expect(blocks.map((b) => b.textContent)).toEqual(['Inner paragraph']);
    expect(blocks[0].tagName).toBe('P');
  });

  it('keeps sibling blocks inside a section in document order', () => {
    const root = el('SECTION', el('H2', 'Heading'), el('P', 'Body text.'));
    expect(extractBlockTexts(root)).toEqual(['Heading', 'Body text.']);
  });

  it('descends through transparent wrappers', () => {
    const root = el('DIV', el('SPAN', el('P', 'Wrapped')));
    expect(extractBlockTexts(root)).toEqual(['Wrapped']);
  });

  it('includes inline element text in the parent block', () => {
    const root = el(
      'DIV',
      el('P', 'Text with ', el('STRONG', 'bold'), ' and ', el('EM', 'italic'), '.')
    );
    expect(extractBlockTexts(root)).toEqual(['Text with bold and italic.']);
  });

  it('walks table cells as separate paragraphs', () => {
    const root = el('TABLE', el('TR', el('TD', 'A'), el('TD', 'B')));
    expect(extractBlockTexts(root)).toEqual(['A', 'B']);
  });

  it('drops whitespace-only blocks', () => {
    const root = el('DIV', el('P', 'Content'), el('P', '   '), el('P', 'More'));
    expect(extractBlockTexts(root)).toEqual(['Content', 'More']);
  });

  it('drops blocks whose only content is a line break', () => {
    const root = el('DIV', el('P', el('BR')), el('P', 'Real'));
    expect(extractBlockTexts(root)).toEqual(['Real']);
  });

  it('returns the same node instances so they can be highlighted', () => {
    const paragraph = el('P', 'Highlight me');
    const root = el('DIV', paragraph);
    expect(collectLeafBlocks(root)[0]).toBe(paragraph);
  });

  it('returns nothing for an empty tree', () => {
    expect(collectLeafBlocks(el('DIV'))).toEqual([]);
  });
});
