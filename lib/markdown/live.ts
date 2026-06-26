// Live-editor markdown renderer (ported from the prototype's renderMd, then made
// caret-aware). Like Obsidian's Live Preview: the line the caret is on shows its
// raw markup (dimmed via `.md-mark`) so the caret always has a real position to
// land on; every OTHER line collapses its block markers (`.md-hide`) so headings
// and quotes read clean.
//
// CRITICAL: the marker text must always stay in the DOM (only visually hidden),
// because the editor reconstructs the saved markdown from `el.textContent`. Never
// drop or alter the characters — only toggle `display`.

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  let out = "";
  // image first (it is a superset of the link pattern), then wiki-link, link, bold, italic, code
  const RE =
    /(!\[[^\]\n]*\]\([^)\n]*\))|(\[\[[^\]\n]+\]\])|(\[[^\]\n]*\]\([^)\n]*\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(s))) {
    out += esc(s.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      const lb = tok.indexOf("](");
      const alt = tok.slice(2, lb);
      const url = tok.slice(lb + 2, -1);
      out += `<span class="md-mark">![</span><span class="md-link">${esc(alt)}</span><span class="md-mark">](</span><span class="md-url">${esc(url)}</span><span class="md-mark">)</span>`;
    } else if (m[2]) {
      const t = tok.slice(2, -2);
      out += `<span class="md-mention"><span class="md-mark">[[</span>${esc(t)}<span class="md-mark">]]</span></span>`;
    } else if (m[3]) {
      const lb = tok.indexOf("](");
      const txt = tok.slice(1, lb);
      const url = tok.slice(lb + 2, -1);
      out += `<span class="md-mark">[</span><span class="md-link">${esc(txt)}</span><span class="md-mark">](</span><span class="md-url">${esc(url)}</span><span class="md-mark">)</span>`;
    } else if (m[4]) {
      out += `<span class="md-bold"><span class="md-mark">**</span>${esc(tok.slice(2, -2))}<span class="md-mark">**</span></span>`;
    } else if (m[5]) {
      out += `<span class="md-italic"><span class="md-mark">*</span>${esc(tok.slice(1, -1))}<span class="md-mark">*</span></span>`;
    } else if (m[6]) {
      out += `<span class="md-code"><span class="md-mark">\`</span>${esc(tok.slice(1, -1))}<span class="md-mark">\`</span></span>`;
    }
    last = RE.lastIndex;
  }
  out += esc(s.slice(last));
  return out;
}

/**
 * @param text       full editor markdown source
 * @param activeLine zero-based index of the line the caret is on. That line keeps
 *                   its markers visible (dimmed) so the caret has a home; all other
 *                   lines collapse them. Pass -1 (default) to collapse every line
 *                   (used on blur / initial mount).
 */
export function renderLiveMarkdown(text: string, activeLine = -1): string {
  return text
    .split("\n")
    .map((ln, i) => {
      // markers on the active line stay visible; elsewhere they collapse
      const hide = i === activeLine ? "" : " md-hide";
      const h = ln.match(/^(#{1,5})\s/);
      if (h) {
        const lvl = h[1].length;
        const mk = ln.slice(0, h[0].length);
        return `<span class="md-h${lvl}"><span class="md-mark${hide}">${esc(mk)}</span>${inline(ln.slice(h[0].length))}</span>`;
      }
      const q = ln.match(/^>\s/);
      if (q) {
        const mk = ln.slice(0, q[0].length);
        return `<span class="md-quote"><span class="md-mark${hide}">${esc(mk)}</span>${inline(ln.slice(q[0].length))}</span>`;
      }
      const b = ln.match(/^([ \t]*)[-*]\s/);
      if (b) {
        // bullets stay dimmed-visible on every line: the raw "- " IS the bullet,
        // and we must never alter the marker text (textContent is the saved source).
        const mk = ln.slice(0, b[0].length);
        return `<span><span class="md-mark">${esc(mk)}</span>${inline(ln.slice(b[0].length))}</span>`;
      }
      return inline(ln);
    })
    .join("\n");
}
