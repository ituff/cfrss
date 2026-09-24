/**
 * Inline SVG icon set.
 *
 * The app deliberately ships no icon library, so icons are plain markup.
 * Two rules every icon here obeys (both are load-bearing):
 *
 *  1. Explicit pixel size — an inline `<svg>` with no width/height falls back
 *     to the 300×150 default and blows up the row it sits in.
 *  2. `stroke="currentColor"` (never a hard-coded colour) — the app has four
 *     themes (light / dark / oled / eink) and the icon must inherit whichever
 *     text colour the surrounding control uses.
 *
 * Style: 24×24 viewBox, 2px round stroke, no fill. Uniform weight keeps the
 * row of circular buttons visually consistent.
 */

const DEFAULT_SIZE = 18;

function svg(body: string, size: number = DEFAULT_SIZE, strokeWidth = 2): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    `stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** Crescent moon — shown on light themes ("tap to go dark"). */
export const iconMoon = (size?: number): string =>
  svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>', size);

/** Sun — shown on dark/oled themes ("tap to go light"). */
export const iconSun = (size?: number): string =>
  svg(
    '<circle cx="12" cy="12" r="4"/>' +
      '<path d="M12 2v2"/><path d="M12 20v2"/>' +
      '<path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/>' +
      '<path d="M2 12h2"/><path d="M20 12h2"/>' +
      '<path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    size,
  );

/** Double check — "mark everything as read". */
export const iconCheckCheck = (size?: number): string =>
  svg('<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>', size);

/** Two arrows chasing each other — refresh the feed. */
export const iconRefresh = (size?: number): string =>
  svg(
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
      '<path d="M21 3v5h-5"/>' +
      '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>' +
      '<path d="M8 16H3v5"/>',
    size,
  );

/**
 * Ring with a filled centre — the same visual language as the unread dot on
 * every card, so "unread only" reads as a filter over those dots.
 */
export const iconUnread = (size?: number): string =>
  svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>', size);

/** Bulleted lines — "all articles", the counterpart to the unread filter. */
export const iconList = (size?: number): string =>
  svg(
    '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>' +
      '<path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    size,
  );

/** Document with text lines — used inside the "文章" pill tab. */
export const iconFileText = (size?: number): string =>
  svg(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/>' +
      '<path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    size,
  );

/**
 * Right-pointing chevron for collapsible sections.
 *
 * Always points the same way — the caller rotates it 90° when open via CSS.
 * Never swap between `▸` and `▾`: the two glyphs have different advance widths,
 * so swapping them reflows the row, whereas a rotation leaves the box alone.
 */
export const iconChevron = (size?: number, strokeWidth = 2.5): string =>
  svg('<path d="M9 6l6 6-6 6"/>', size, strokeWidth);

/** Pencil — edit / rename. */
export const iconPencil = (size?: number): string =>
  svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>', size);

/** Trash can — destructive action. */
export const iconTrash = (size?: number): string =>
  svg(
    '<path d="M3 6h18"/>' +
      '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
      '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
      '<path d="M10 11v6"/><path d="M14 11v6"/>',
    size,
  );

/** Single circular arrow — "re-enable / retry", distinct from the two-arrow refresh. */
export const iconRotateCw = (size?: number): string =>
  svg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>', size);

/** Cross — close / remove. */
export const iconClose = (size?: number): string =>
  svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', size);

/** Warning triangle — marks a feed that was auto-disabled. */
export const iconAlert = (size?: number): string =>
  svg(
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>' +
      '<path d="M12 9v4"/><path d="M12 17h.01"/>',
    size,
  );
