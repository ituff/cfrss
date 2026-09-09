/**
 * Shared Markdown -> HTML renderer for LLM output (digest, article summary).
 * Supports headings, ordered/unordered lists, tables, blockquotes, code,
 * links, bold/italic, and horizontal rules. All input is HTML-escaped first.
 */

export function renderMarkdown(md: string): string {
    if (!md) return '';

    const lines = md.split('\n');
    const html: string[] = [];
    let listType: 'ul' | 'ol' | null = null;
    const closeList = () => {
      if (listType) {
        html.push(`</${listType}>`);
        listType = null;
      }
    };

    let i = 0;
    while (i < lines.length) {
      const trimmed = lines[i].trim();

      if (!trimmed) {
        closeList();
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        closeList();
        html.push('<hr>');
        i++;
        continue;
      }

      // Table: current line starts with '|' and next line is a separator row
      if (
        trimmed.startsWith('|') &&
        i + 1 < lines.length &&
        /^\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1].trim())
      ) {
        closeList();
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const cells = lines[i]
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => inlineMarkdown(c.trim()));
          rows.push(cells);
          i++;
        }
        if (rows.length >= 2) {
          html.push(
            '<table><thead><tr>' + rows[0].map((c) => `<th>${c}</th>`).join('') + '</tr></thead>'
          );
          html.push(
            '<tbody>' +
              rows.slice(2).map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') +
              '</tbody></table>'
          );
        } else {
          html.push('<table><tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
        }
        continue;
      }

      // Headers (# → h2 ... #### → h5)
      const heading = trimmed.match(/^(#{1,4})\s+(.*)/);
      if (heading) {
        closeList();
        const level = Math.min(heading[1].length + 1, 5);
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        i++;
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('&gt; ') || trimmed.startsWith('> ')) {
        closeList();
        const quote = trimmed.startsWith('&gt; ') ? trimmed.slice(5) : trimmed.slice(2);
        html.push(`<blockquote>${inlineMarkdown(quote)}</blockquote>`);
        i++;
        continue;
      }

      // Lists
      const ul = trimmed.match(/^[-*]\s+(.*)/);
      const ol = trimmed.match(/^\d+[.、)]\s+(.*)/);
      if (ul) {
        if (listType !== 'ul') {
          closeList();
          html.push('<ul>');
          listType = 'ul';
        }
        html.push(`<li>${inlineMarkdown(ul[1])}</li>`);
        i++;
        continue;
      }
      if (ol) {
        if (listType !== 'ol') {
          closeList();
          html.push('<ol>');
          listType = 'ol';
        }
        html.push(`<li>${inlineMarkdown(ol[1])}</li>`);
        i++;
        continue;
      }

      // Paragraph
      closeList();
      html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
      i++;
    }
    closeList();
    return html.join('\n');
  }

function inlineMarkdown(text: string): string {
    // Escape HTML first, then apply inline formatting
    let s = escapeHtml(text);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }

  /**
   * Escape HTML to prevent XSS.
   */
function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
