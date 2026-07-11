export type SlugTitle = Record<string, string>;

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// image first (superset of the link pattern), then wiki-link, link, bold, italic, code, and
// a tightly-constrained passthrough for essay passage anchors (<u id="anchor-…"> / </u>).
// The <u> pattern only allows an optional id="anchor-…" attribute — no other attributes or
// event handlers — so it stays safe to run over arbitrary user note content too.
const INLINE_RE =
  /(!\[[^\]\n]*\]\([^)\n]*\))|(\[\[[^\]\n]+\]\])|(\[[^\]\n]*\]\([^)\n]*\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)|(<u(?: id="anchor-[a-z0-9-]+")?>|<\/u>)/g;

export function renderInline(s: string, titles: SlugTitle = {}): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(s))) {
    out += esc(s.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      const lb = tok.indexOf("](");
      const alt = tok.slice(2, lb);
      const src = tok.slice(lb + 2, -1).trim();
      out += `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" />`;
    } else if (m[2]) {
      const slug = tok.slice(2, -2).trim();
      const title = titles[slug] ?? slug;
      out += `<a href="/${esc(slug)}" data-slug="${esc(slug)}">${esc(title)}</a>`;
    } else if (m[3]) {
      const lb = tok.indexOf("](");
      const display = tok.slice(1, lb);
      const target = tok.slice(lb + 2, -1);
      const isExternal = /^[a-z]+:\/\//i.test(target);
      if (isExternal) {
        out += `<a href="${esc(target)}" target="_blank" rel="noopener">${esc(display || target)}</a>`;
      } else if (titles[target] !== undefined) {
        out += `<a href="/${esc(target)}" data-slug="${esc(target)}">${esc(display || titles[target])}</a>`;
      } else {
        out += `<a href="/${esc(target)}" data-slug="${esc(target)}" data-missing="1">${esc(display || target)}</a>`;
      }
    } else if (m[4]) out += `<strong>${esc(tok.slice(2, -2))}</strong>`;
    else if (m[5]) out += `<em>${esc(tok.slice(1, -1))}</em>`;
    else if (m[6]) out += `<code>${esc(tok.slice(1, -1))}</code>`;
    else if (m[7]) out += tok; // constrained <u id="anchor-…"> / </u> passthrough
    last = INLINE_RE.lastIndex;
  }
  out += esc(s.slice(last));
  return out;
}

export function renderNoteBody(md: string, titles: SlugTitle = {}): string {
  const lines = (md || "").split("\n");
  let html = "";
  let para: string[] = [];
  let lists = 0;
  const flush = () => {
    if (para.length) {
      html += `<p>${renderInline(para.join(" "), titles)}</p>`;
      para = [];
    }
  };
  const closeLists = (to: number) => {
    while (lists > to) {
      html += "</ul>";
      lists--;
    }
  };
  for (const ln of lines) {
    const b = ln.match(/^([ \t]*)[-*]\s+(.*)$/);
    const h = ln.match(/^(#{1,5})\s+(.*)$/);
    const q = ln.match(/^>\s+(.*)$/);
    if (b) {
      flush();
      const indent = b[1].replace(/\t/g, "  ").length;
      const level = Math.floor(indent / 2) + 1;
      while (lists < level) {
        html += "<ul>";
        lists++;
      }
      closeLists(level);
      html += `<li>${renderInline(b[2], titles)}</li>`;
    } else if (h) {
      closeLists(0);
      flush();
      const lvl = Math.min(h[1].length + 1, 6);
      html += `<h${lvl}>${renderInline(h[2], titles)}</h${lvl}>`;
    } else if (q) {
      closeLists(0);
      flush();
      html += `<blockquote>${renderInline(q[1], titles)}</blockquote>`;
    } else if (ln.trim() === "") {
      closeLists(0);
      flush();
    } else {
      closeLists(0);
      para.push(ln);
    }
  }
  flush();
  closeLists(0);
  return html;
}

export type ExtractedLink = { slug: string; display: string | null; position: number };

/** Pull internal links (`[[slug]]` and `[alias](slug)`) out of markdown for link materialization.
 *  External links (`http(s)://…`) are ignored. */
export function extractLinks(md: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const re = /(\[\[([^\]\n|]+)\]\])|(\[([^\]\n]*)\]\(([^)\n]+)\))/g;
  let m: RegExpExecArray | null;
  let pos = 0;
  while ((m = re.exec(md))) {
    if (m[2] !== undefined) {
      out.push({ slug: m[2].trim(), display: null, position: pos++ });
    } else if (m[5] !== undefined) {
      // skip image embeds: `![alt](src)` — the "[..](..)" is preceded by "!"
      if (md[m.index - 1] === "!") continue;
      const target = m[5].trim();
      if (!/^[a-z]+:\/\//i.test(target)) {
        out.push({ slug: target, display: (m[4] || "").trim() || null, position: pos++ });
      }
    }
  }
  return out;
}
