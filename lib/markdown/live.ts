// Live-editor markdown renderer (ported from the prototype's renderMd).
// Unlike the read renderer, this KEEPS the markdown syntax visible but dimmed
// (`.md-mark`), so the contenteditable surface reads like Obsidian's Live Preview.

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  let out = "";
  const RE =
    /(\[\[[^\]\n]+\]\])|(\[[^\]\n]*\]\([^)\n]*\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(s))) {
    out += esc(s.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      const t = tok.slice(2, -2);
      out += `<span class="md-mention"><span class="md-mark">[[</span>${esc(t)}<span class="md-mark">]]</span></span>`;
    } else if (m[2]) {
      const lb = tok.indexOf("](");
      const txt = tok.slice(1, lb);
      const url = tok.slice(lb + 2, -1);
      out += `<span class="md-mark">[</span><span class="md-link">${esc(txt)}</span><span class="md-mark">](</span><span class="md-url">${esc(url)}</span><span class="md-mark">)</span>`;
    } else if (m[3]) {
      out += `<span class="md-bold"><span class="md-mark">**</span>${esc(tok.slice(2, -2))}<span class="md-mark">**</span></span>`;
    } else if (m[4]) {
      out += `<span class="md-italic"><span class="md-mark">*</span>${esc(tok.slice(1, -1))}<span class="md-mark">*</span></span>`;
    } else if (m[5]) {
      out += `<span class="md-code"><span class="md-mark">\`</span>${esc(tok.slice(1, -1))}<span class="md-mark">\`</span></span>`;
    }
    last = RE.lastIndex;
  }
  out += esc(s.slice(last));
  return out;
}

export function renderLiveMarkdown(text: string): string {
  return text
    .split("\n")
    .map((ln) => {
      const h = ln.match(/^(#{1,5})\s/);
      if (h) {
        const lvl = h[1].length;
        const mk = ln.slice(0, h[0].length);
        return `<span class="md-h${lvl}"><span class="md-mark md-hide">${esc(mk)}</span>${inline(ln.slice(h[0].length))}</span>`;
      }
      const q = ln.match(/^>\s/);
      if (q) {
        const mk = ln.slice(0, q[0].length);
        return `<span class="md-quote"><span class="md-mark">${esc(mk)}</span>${inline(ln.slice(q[0].length))}</span>`;
      }
      const b = ln.match(/^([ \t]*)[-*]\s/);
      if (b) {
        const mk = ln.slice(0, b[0].length);
        return `<span><span class="md-mark">${esc(mk)}</span>${inline(ln.slice(b[0].length))}</span>`;
      }
      return inline(ln);
    })
    .join("\n");
}
