"use client";

// The interactive half of /session. It's handed the essay markdown (read from
// content/tools-for-thought.md) and the seed thoughts (content/session-3-thoughts.json)
// by the server page, and owns everything else client-side: the page-turnable "book"
// reader beside a page-scoped thought stream (a slide-in drawer on mobile), plus the
// add/reply/export controls. No network, no backend — additions live in this browser only.
// Styling reuses the same design tokens and renderNoteBody as the /local notes page.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderNoteBody } from "@/lib/markdown/render";
import GraphView from "@/app/graph/graph-view";

export type Thought = {
  id: string;
  author: string;
  timestamp: string;
  text: string;
  essayAnchor: string | null;
  parentId: string | null;
  // A free-form passage the reader highlighted when writing the thought (not a pre-defined
  // essay anchor). Optional so older thoughts and the seed JSON stay valid.
  quote?: string | null;
};

const STORAGE_KEY = "papert-session-thoughts";

// A heading, its nesting level, and the id we scroll to. `text` doubles as the value we
// store in a thought's essayAnchor, so the JSON's anchors (which are raw heading text)
// round-trip cleanly.

// Slug shared by rendered-heading ids and essayAnchor lookups, so both sides agree.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
const anchorId = (text: string) => `sec-${slugify(text)}`;

// Find the first occurrence of `needle` (a highlighted passage) inside `root`'s text and return
// a DOM Range spanning it, or null. Whitespace is normalized on both sides — so a selection that
// crosses inline markup or wraps lines still matches — while a char→(node,offset) map lets us
// rebuild the exact range in the live DOM. Used to locate/flash a thought's quoted passage.
function rangeOfText(root: HTMLElement, rawNeedle: string): Range | null {
  const needle = rawNeedle.replace(/\s+/g, " ").trim();
  if (!needle) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let norm = "";
  const map: Array<[Text, number]> = []; // normalized char index → (text node, offset within it)
  let prevSpace = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const s = node.nodeValue ?? "";
    for (let i = 0; i < s.length; i++) {
      if (/\s/.test(s[i])) {
        if (prevSpace) continue; // collapse runs of whitespace
        norm += " ";
        map.push([node as Text, i]);
        prevSpace = true;
      } else {
        norm += s[i];
        map.push([node as Text, i]);
        prevSpace = false;
      }
    }
  }
  const idx = norm.indexOf(needle);
  if (idx < 0) return null;
  const start = map[idx];
  const end = map[idx + needle.length - 1];
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1] + 1);
  return range;
}

// renderNoteBody emits bare <h2>…</h6> (it never emits h1). Give each one an id derived
// from its text so thought anchors can scroll to it.
function withHeadingIds(html: string): string {
  return html.replace(/<h([2-6])>([\s\S]*?)<\/h\1>/g, (_all, lvl, inner) => {
    const text = inner.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    return `<h${lvl} id="${anchorId(text)}">${inner}</h${lvl}>`;
  });
}

function loadLocal(): Thought[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as Thought[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveLocal(thoughts: Thought[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(thoughts));
  } catch {
    /* quota / private mode — ignore */
  }
}

function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(36).slice(2);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-07-11T11:12:00" / "…T15:04:05.123Z" → "11 Jul 2026" (day, month, year — no time). Reads
// the fields straight out of the string rather than reinterpreting it as a Date, so it stays
// TZ-stable.
function shortTime(ts: string): string {
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ts;
  const year = m[1];
  const mon = MONTHS[parseInt(m[2], 10) - 1] ?? m[2];
  const day = parseInt(m[3], 10);
  return `${day} ${mon} ${year}`;
}

// Local wall-clock stamp in the same "YYYY-MM-DDTHH:MM:SS" shape the seed JSON uses, so new
// thoughts display in the reader's own time zone and still sort lexically alongside the seeds.
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

// True on the phone layout (matches the CSS drawer breakpoint), used to add the mobile-only
// "flash the passage, then open the drawer to its card" flow without touching desktop.
function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
}

// Mobile: how long after a tap the drawer auto-opens, and how long the essay flash stays lit —
// the flash persists until (just past) the reveal so the text never goes dark in between.
const REVEAL_DELAY_MS = 1800;
const MOBILE_FLASH_MS = REVEAL_DELAY_MS + 300;
const DEFAULT_FLASH_MS = 1300;

// The text position under a click/tap, normalized across the two browser APIs. Used to tell
// which underlined quote passage (if any) the reader tapped.
function caretPosFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

export default function SessionView({
  essay,
  fileThoughts,
}: {
  essay: string;
  fileThoughts: Thought[];
}) {
  // localStorage additions only. Loaded after mount so the first client render matches the
  // server (file thoughts only) — no hydration mismatch.
  const [localThoughts, setLocalThoughts] = useState<Thought[]>([]);
  const [ready, setReady] = useState(false);

  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [quote, setQuote] = useState(""); // passage the reader highlighted for this thought
  const [replyTo, setReplyTo] = useState<string | null>(null); // thought this new one replies to
  const [copied, setCopied] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // mobile: thought-stream drawer open
  const [showHint, setShowHint] = useState(false); // mobile: first-load "tap here for thoughts" nudge
  const [streamView, setStreamView] = useState<"stream" | "graph">("stream"); // right panel: list vs. 3D concept map

  const streamRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const inlineComposerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const pendingQuoteRef = useRef(""); // essay selection captured when "+ Add thought" is pressed
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live ranges of each thought's quoted passage in the essay, for underlining + tap-to-open.
  const quotePassagesRef = useRef<{ range: Range; thought: Thought }[]>([]);

  // --- paginated book view of the essay ---
  const PAGE_PAD = 22; // px of breathing room at the top & bottom of every page
  const articleRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const offsetsRef = useRef<number[]>([0]); // start offset (px) of each essay page
  const leafRef = useRef(0);
  const leafCountRef = useRef(1);
  const [leaf, setLeaf] = useState(0); // 0 = cover, 1..N = essay pages
  const [leafCount, setLeafCount] = useState(1); // cover + essay pages
  const [sections, setSections] = useState<string[]>([]); // running-header title per essay page

  useEffect(() => { leafRef.current = leaf; }, [leaf]);
  useEffect(() => { leafCountRef.current = leafCount; }, [leafCount]);

  // Collapse the add-thought form when clicking anywhere outside the composer (the toggle
  // button + form). The toggle's own click still runs, so it toggles rather than double-fires.
  useEffect(() => {
    if (!formOpen) return;
    function onDown(e: MouseEvent) {
      const el = composerRef.current;
      // Ignore ghost listeners left by hot-reload: their captured ref points at a detached
      // node no longer in the document, which would otherwise close the fresh form instantly.
      if (!el || !document.contains(el)) return;
      if (!el.contains(e.target as Node)) setFormOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [formOpen]);

  // Same, for the inline reply composer: clicking anywhere outside it dismisses it so it never
  // lingers open. (Clicking another card's Reply still switches, since that also sets replyTo.)
  useEffect(() => {
    if (!replyTo) return;
    function onDown(e: MouseEvent) {
      const el = inlineComposerRef.current;
      if (!el || !document.contains(el)) return;
      if (!el.contains(e.target as Node)) { setReplyTo(null); setText(""); }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [replyTo]);

  useEffect(() => {
    setLocalThoughts(loadLocal());
    setReady(true);
  }, []);

  // Inject the ::highlight(thought-flash) rule at runtime. It styles the CSS Custom Highlight API
  // used to flash a quoted passage; kept out of globals.css because the build's CSS optimizer
  // (lightningcss) doesn't recognize the ::highlight() pseudo-element and warns on it.
  useEffect(() => {
    const id = "thought-flash-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    // thought-flash: the brief highlight when jumping to a passage.
    // thought-passages: the persistent dotted underline marking every discussed (quoted) passage.
    style.textContent =
      "::highlight(thought-flash){background-color:rgba(184,137,63,0.32);color:inherit}" +
      "::highlight(thought-passages){text-decoration:underline;text-decoration-style:dotted;text-decoration-color:var(--clay);text-decoration-thickness:2px}";
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    if (ready) saveLocal(localThoughts);
  }, [localThoughts, ready]);

  // Mobile first-load nudge: on phones the thoughts live behind the top-right menu, so point the
  // reader at it. Stops appearing once they've opened the drawer (learned it); auto-fades otherwise.
  useEffect(() => {
    if (!isMobileViewport()) return;
    try { if (window.localStorage.getItem("papert-thoughts-hint")) return; } catch { /* ignore */ }
    setShowHint(true);
    const t = window.setTimeout(() => setShowHint(false), 6500);
    return () => window.clearTimeout(t);
  }, []);

  // Opening the drawer means they found the thoughts — dismiss the nudge and don't show it again.
  useEffect(() => {
    if (!menuOpen) return;
    setShowHint(false);
    try { window.localStorage.setItem("papert-thoughts-hint", "1"); } catch { /* ignore */ }
  }, [menuOpen]);

  // JSON file first, localStorage additions after, all sorted by timestamp.
  const thoughts = useMemo(() => {
    return [...fileThoughts, ...localThoughts].sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
    );
  }, [fileThoughts, localThoughts]);

  const byId = useMemo(() => {
    const m = new Map<string, Thought>();
    for (const t of thoughts) m.set(t.id, t);
    return m;
  }, [thoughts]);

  // The book's cover recreates the essay's front matter (title / "in this issue"), so the
  // paginated body starts at the article proper — the second top-level "# " heading. This
  // avoids showing the title twice (once on the cover, once in the flowed text).
  const body = useMemo(() => {
    const lines = essay.split("\n");
    const tops: number[] = [];
    lines.forEach((l, i) => { if (/^# /.test(l)) tops.push(i); });
    const start = tops.length >= 2 ? tops[1] : 0;
    return lines.slice(start).join("\n");
  }, [essay]);

  const essayHtml = useMemo(() => withHeadingIds(renderNoteBody(body, {})), [body]);

  // Passage anchors: map each <u id="anchor-…"> id to its (markdown-stripped) sentence, used
  // to label the card tags and to give the reverse (passage → card) click something to match.
  const passages = useMemo(() => {
    const m = new Map<string, string>();
    const re = /<u id="(anchor-[a-z0-9-]+)">([\s\S]*?)<\/u>/g;
    let x: RegExpExecArray | null;
    while ((x = re.exec(body))) m.set(x[1], x[2].replace(/[*`]/g, "").trim());
    return m;
  }, [body]);

  // A passage anchor targets a <u id="anchor-…"> element directly; anything else is a section
  // heading, which keeps resolving through the slugified `sec-…` id as before.
  const isPassageAnchor = (a: string) => a.startsWith("anchor-");

  // Underline every passage a thought quotes (via the CSS Custom Highlight API — no DOM mutation,
  // so the memoized essay stays intact) and remember each range → thought so a tap can open it.
  useEffect(() => {
    const art = articleRef.current;
    if (!art) return;
    const w = window as unknown as { Highlight?: new (...ranges: Range[]) => object };
    const highlights = (CSS as unknown as { highlights?: Map<string, object> }).highlights;
    const entries: { range: Range; thought: Thought }[] = [];
    const seen = new Set<string>();
    for (const t of thoughts) {
      if (!t.quote || seen.has(t.quote)) continue;
      seen.add(t.quote);
      const r = rangeOfText(art, t.quote);
      if (r) entries.push({ range: r, thought: t });
    }
    quotePassagesRef.current = entries;
    if (w.Highlight && highlights) {
      if (entries.length) highlights.set("thought-passages", new w.Highlight(...entries.map((e) => e.range)));
      else highlights.delete("thought-passages");
    }
    return () => { highlights?.delete("thought-passages"); };
  }, [thoughts, essayHtml]);

  // How deep in a reply thread a thought sits — walk parentId up to the root. Cycle-guarded and
  // capped so a malformed chain can't loop or indent off the edge. Drives the card's left indent.
  function threadDepth(t: Thought): number {
    let depth = 0;
    let cur: Thought | undefined = t;
    const seen = new Set<string>();
    while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
      depth++;
      if (depth >= 6) break;
    }
    return depth;
  }

  // Split the flowed essay into pages. We measure every top-level block once (at the pane's
  // real width) and break at block boundaries so a line is never sliced across a page turn;
  // a heading that would land at the very foot of a page is pushed to the next page with the
  // text it introduces. Re-runs whenever the essay or the pane's size changes.
  const paginate = useCallback(() => {
    const art = articleRef.current;
    const vp = viewportRef.current;
    if (!art || !vp) return;
    const CH = vp.clientHeight - PAGE_PAD * 2; // usable text height per page
    if (CH < 60) return;
    const artTop = art.getBoundingClientRect().top; // translate-invariant reference
    const blocks = Array.from(art.children) as HTMLElement[];
    const offs = [0];
    let pageStart = 0;
    const KEEP = 58; // px of following text a heading must keep beside it (~2 lines)
    const isHeading = (el: HTMLElement) => /^H[1-6]$/.test(el.tagName);
    for (let b = 0; b < blocks.length; b++) {
      const el = blocks[b];
      const r = el.getBoundingClientRect();
      const top = r.top - artTop;
      const roomLeft = CH - (top - pageStart);
      let brk = false;
      if (r.height > roomLeft + 0.5) brk = true; // block doesn't fit in what's left
      else if (isHeading(el)) {
        const nx = blocks[b + 1];
        const nh = nx ? nx.getBoundingClientRect().height : 0;
        if (r.height + Math.min(nh, KEEP) > roomLeft + 0.5) brk = true; // would orphan the heading
      }
      if (brk && top > pageStart + 0.5) { pageStart = top; offs.push(top); }
    }
    // running-header section for each page: the nearest essay section heading (## → h3) at or
    // before the page's first block
    const secs = offs.map((off) => {
      let title = "";
      for (let b = 0; b < blocks.length; b++) {
        const el = blocks[b];
        if (el.getBoundingClientRect().top - artTop > off + 1) break;
        if (el.tagName === "H3") title = el.textContent || "";
      }
      return title;
    });
    offsetsRef.current = offs;
    setSections(secs);
    setLeafCount(1 + offs.length);
    setLeaf((l) => Math.min(l, offs.length)); // clamp if the page count shrank
  }, []);

  useLayoutEffect(() => { paginate(); }, [essayHtml, paginate]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => paginate());
    ro.observe(vp);
    return () => ro.disconnect();
  }, [paginate]);

  // Turn to a leaf (0 = cover). `animate` runs a quick cross-fade; jumps pass false so the
  // flash lands immediately on the right page.
  const gotoLeaf = useCallback((n: number, animate = true) => {
    const target = Math.max(0, Math.min(leafCountRef.current - 1, n));
    if (target === leafRef.current) return;
    const w = fadeRef.current;
    if (animate && w) {
      w.classList.add("book-turning");
      window.setTimeout(() => {
        setLeaf(target);
        window.setTimeout(() => w.classList.remove("book-turning"), 30);
      }, 120);
    } else {
      setLeaf(target);
    }
  }, []);

  // Which essay page (0-based) a vertical offset (relative to the article top) sits on.
  const contentPageOfTop = useCallback((topRelArticle: number) => {
    const offs = offsetsRef.current;
    let p = 0;
    for (let i = 0; i < offs.length; i++) { if (offs[i] <= topRelArticle + 0.5) p = i; else break; }
    return p;
  }, []);

  // Which essay page a given element sits on — used to turn to an anchor's page.
  const contentPageOfEl = useCallback(
    (el: HTMLElement) => {
      const art = articleRef.current;
      if (!art) return 0;
      return contentPageOfTop(el.getBoundingClientRect().top - art.getBoundingClientRect().top);
    },
    [contentPageOfTop]
  );

  // Briefly highlight an arbitrary passage range using the CSS Custom Highlight API (no DOM
  // mutation). Silently degrades where unsupported — the page turn alone still lands the reader
  // on the passage.
  const flashRange = useCallback((range: Range, duration = DEFAULT_FLASH_MS) => {
    interface HL { }
    const w = window as unknown as { Highlight?: new (r: Range) => HL };
    const highlights = (CSS as unknown as { highlights?: Map<string, HL> }).highlights;
    if (!w.Highlight || !highlights) return;
    try {
      highlights.set("thought-flash", new w.Highlight(range));
      window.setTimeout(() => highlights.delete("thought-flash"), duration);
    } catch {
      /* unsupported range — ignore */
    }
  }, []);

  // Turn to the element's page, then flash it. We re-query the target by selector at flash
  // time so the highlight always lands on the live node (robust to any re-render in between).
  const jumpToEl = useCallback((el: HTMLElement, flashSel: string | null) => {
    gotoLeaf(contentPageOfEl(el) + 1, false);
    if (flashSel) {
      window.setTimeout(() => {
        const live = articleRef.current?.querySelector<HTMLElement>(flashSel);
        if (!live) return;
        live.classList.add("anchor-flash");
        window.setTimeout(() => live.classList.remove("anchor-flash"), 1300);
      }, 90);
    }
  }, [gotoLeaf, contentPageOfEl]);

  // Turn pages with ← / → (ignored while typing in the composer fields).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { gotoLeaf(leafRef.current + 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { gotoLeaf(leafRef.current - 1); e.preventDefault(); }
      else if (e.key === "Home") { gotoLeaf(0); }
      else if (e.key === "End") { gotoLeaf(leafCountRef.current - 1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gotoLeaf]);

  // The passage the reader currently has highlighted in the essay (empty if none). Read when the
  // composer is opened so a highlight becomes the thought's attached quote — nothing is automatic.
  function readEssaySelection(): string {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return "";
    const art = articleRef.current;
    if (!art || !sel.anchorNode || !sel.focusNode) return "";
    if (!art.contains(sel.anchorNode) || !art.contains(sel.focusNode)) return "";
    const picked = sel.toString().trim();
    return picked.length >= 6 ? picked : "";
  }

  // Toggle the composer for a fresh top-level thought. When opening, attach whatever is highlighted
  // in the essay (captured on mousedown, before the click can clear the selection), clear any reply
  // target, and focus the textarea.
  function openComposer() {
    if (!formOpen) {
      setQuote(pendingQuoteRef.current);
      setReplyTo(null);
      setFormOpen(true);
      // We've captured the highlight as the quote — drop the essay selection so it doesn't
      // linger highlighted (which looks like a second thing is still "open").
      window.getSelection()?.removeAllRanges();
      window.setTimeout(() => textRef.current?.focus(), 0);
    } else {
      setFormOpen(false);
    }
  }

  // Start a reply to a specific thought. The composer appears inline, as an indented card right
  // under that thought (not the top popover); a reply inherits its parent's page and threads under it.
  function startReply(id: string) {
    setReplyTo(id);
    setQuote("");
    setText("");
    setFormOpen(false);
    window.getSelection()?.removeAllRanges();
    window.setTimeout(() => textRef.current?.focus(), 0);
  }

  // What a thought points at in the essay: a pre-defined anchor (passage id or section heading),
  // or a free-form highlighted quote. A reply with neither inherits its nearest ancestor's target
  // (so a thread stays together) unless it cites its own passage/quote.
  type Target = { kind: "anchor"; value: string } | { kind: "quote"; value: string };
  const targetOfThread = useCallback(
    (t: Thought): Target | null => {
      let cur: Thought | undefined = t;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.essayAnchor) return { kind: "anchor", value: cur.essayAnchor };
        if (cur.quote) return { kind: "quote", value: cur.quote };
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return null;
    },
    [byId]
  );

  // CSS selector for an anchor value — a passage id (`anchor-…`) or a section heading's slug id.
  const selOfAnchor = useCallback(
    (a: string) => (a.startsWith("anchor-") ? `#${CSS.escape(a)}` : `#${CSS.escape(anchorId(a))}`),
    []
  );

  // The leaf a target resolves to (0 = cover / unresolved). Anchors resolve by id; quotes by
  // locating their text in the essay. Needs the live DOM, so returns 0 during server render.
  const leafOfTarget = useCallback(
    (target: Target): number => {
      const art = articleRef.current;
      if (!art) return 0;
      if (target.kind === "anchor") {
        const el = art.querySelector<HTMLElement>(selOfAnchor(target.value));
        return el ? contentPageOfEl(el) + 1 : 0;
      }
      const range = rangeOfText(art, target.value);
      if (!range) return 0;
      const top = range.getBoundingClientRect().top - art.getBoundingClientRect().top;
      return contentPageOfTop(top) + 1;
    },
    [selOfAnchor, contentPageOfEl, contentPageOfTop]
  );

  // Map every thought to the leaf it belongs on, so the stream can show only the thoughts for
  // the page you're reading. A thought that resolves to nothing lives on leaf 0 (the cover) as
  // "general" discussion. Recomputed after every (re)pagination (`sections` changes each time)
  // and when thoughts change.
  const thoughtLeaf = useMemo(() => {
    const cache = new Map<string, number>();
    const m = new Map<string, number>();
    for (const t of thoughts) {
      const target = targetOfThread(t);
      let lf = 0;
      if (target) {
        const key = target.kind + ":" + target.value;
        if (cache.has(key)) lf = cache.get(key)!;
        else { lf = leafOfTarget(target); cache.set(key, lf); }
      }
      m.set(t.id, lf);
    }
    return m;
    // `sections` is the repagination signal; the callbacks below are stable enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thoughts, sections, targetOfThread, leafOfTarget]);

  // The thoughts for the page currently on screen.
  const visibleThoughts = useMemo(
    () => thoughts.filter((t) => thoughtLeaf.get(t.id) === leaf),
    [thoughts, thoughtLeaf, leaf]
  );

  // Same set, but threaded: each reply sits directly beneath its parent (siblings by time),
  // instead of purely by timestamp — so a reply never floats above the thought it answers.
  const orderedVisible = useMemo(() => {
    const visibleSet = new Set(visibleThoughts.map((t) => t.id));
    const childrenOf = new Map<string, Thought[]>(); // parent key ("" = a root on this page) → children
    for (const t of visibleThoughts) {
      const key = t.parentId && visibleSet.has(t.parentId) ? t.parentId : "";
      (childrenOf.get(key) ?? childrenOf.set(key, []).get(key)!).push(t);
    }
    const byTime = (a: Thought, b: Thought) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);
    for (const arr of childrenOf.values()) arr.sort(byTime);
    const out: Thought[] = [];
    const seen = new Set<string>();
    const walk = (key: string) => {
      for (const t of childrenOf.get(key) ?? []) {
        if (seen.has(t.id)) continue; // cycle guard
        seen.add(t.id);
        out.push(t);
        walk(t.id);
      }
    };
    walk("");
    return out;
  }, [visibleThoughts]);

  // The leaves that actually carry thoughts, ascending — drives "skip to the next thought".
  const thoughtLeaves = useMemo(() => {
    const s = new Set<number>();
    for (const lf of thoughtLeaf.values()) s.add(lf);
    return [...s].sort((a, b) => a - b);
  }, [thoughtLeaf]);

  // Flash every passage a thought on `lf` cites — so skipping to a page lights up its text.
  const flashLeafTargets = useCallback(
    (lf: number, duration = DEFAULT_FLASH_MS) => {
      const art = articleRef.current;
      if (!art) return;
      const done = new Set<string>();
      for (const t of thoughts) {
        if (thoughtLeaf.get(t.id) !== lf) continue;
        const target = targetOfThread(t);
        if (!target) continue;
        const key = target.kind + ":" + target.value;
        if (done.has(key)) continue;
        done.add(key);
        if (target.kind === "anchor") {
          const el = art.querySelector<HTMLElement>(selOfAnchor(target.value));
          if (!el) continue;
          el.classList.add("anchor-flash");
          window.setTimeout(() => el.classList.remove("anchor-flash"), duration);
        } else {
          const range = rangeOfText(art, target.value);
          if (range) flashRange(range, duration);
        }
      }
    },
    [thoughts, thoughtLeaf, targetOfThread, selOfAnchor, flashRange]
  );

  // Mobile only: after the essay flash, slide the thoughts drawer open and scroll it to the given
  // card (with the standard highlight). A no-op on desktop, where the stream is always visible.
  function revealCardOnMobile(thoughtId: string, delay = REVEAL_DELAY_MS) {
    if (!isMobileViewport()) return;
    window.setTimeout(() => {
      setMenuOpen(true);
      setHighlightId(thoughtId);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightId(null), 1800);
      // let the drawer mount, then bring the card into view
      window.setTimeout(() => {
        const el = streamRef.current?.querySelector<HTMLElement>(`[data-thought="${CSS.escape(thoughtId)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    }, delay);
  }

  // Turn to the next page (wrapping around) that has any thoughts, and flash its cited text.
  const goToNextThought = () => {
    if (!thoughtLeaves.length) return;
    const after = thoughtLeaves.find((l) => l > leaf);
    const target = after !== undefined ? after : thoughtLeaves[0];
    const mobile = isMobileViewport();
    setMenuOpen(false); // on mobile, reveal the book so the flash is visible
    gotoLeaf(target, false);
    // on mobile keep the flash lit until the drawer auto-opens
    window.setTimeout(() => flashLeafTargets(target, mobile ? MOBILE_FLASH_MS : DEFAULT_FLASH_MS), 90);
    // mobile: after the flash, open the drawer to the page's first thought
    const first = thoughts.find((t) => thoughtLeaf.get(t.id) === target);
    if (first) revealCardOnMobile(first.id);
  };

  // Turn to a quoted passage's page and flash it (the card's quote block is clickable).
  const jumpToQuote = useCallback(
    (q: string) => {
      const art = articleRef.current;
      if (!art) return;
      const range = rangeOfText(art, q);
      if (!range) return;
      setMenuOpen(false); // on mobile, reveal the book
      const top = range.getBoundingClientRect().top - art.getBoundingClientRect().top;
      gotoLeaf(contentPageOfTop(top) + 1, false);
      window.setTimeout(() => {
        const live = rangeOfText(art, q);
        if (live) flashRange(live);
      }, 90);
    },
    [gotoLeaf, contentPageOfTop, flashRange]
  );

  // A heading tag on a thought card turns the book to that section's page and flashes it.
  function scrollToAnchor(anchorText: string) {
    const sel = `#${CSS.escape(anchorId(anchorText))}`;
    const el = articleRef.current?.querySelector<HTMLElement>(sel);
    if (el) { setMenuOpen(false); jumpToEl(el, sel); }
  }

  // A passage tag turns to the page holding that underlined sentence and flashes it.
  function scrollToPassage(id: string) {
    const sel = `#${CSS.escape(id)}`;
    const el = articleRef.current?.querySelector<HTMLElement>(sel);
    if (el) { setMenuOpen(false); jumpToEl(el, sel); }
  }

  // Clicking an underlined passage in the essay scrolls to (and flashes) the thought that cites
  // it. Delegated off the essay container since the essay is rendered as raw HTML. Memoized so
  // the article's props stay stable across page turns (the essay DOM is built only once).
  const onEssayClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    // Don't treat the tail of a text-selection drag as a passage click.
    if (!window.getSelection()?.isCollapsed) return;
    const mobile = isMobileViewport();
    const dur = DEFAULT_FLASH_MS;
    // Tapping a passage directly: open the thought immediately — on mobile the drawer appears at
    // once (no delay) scrolled to its card; on desktop scroll the always-visible stream to it.
    const open = (thoughtId: string) => { if (mobile) revealCardOnMobile(thoughtId, 0); else scrollToThought(thoughtId); };

    // 1) a pre-defined <u> anchor passage
    const u = (e.target as HTMLElement).closest<HTMLElement>('u[id^="anchor-"]');
    if (u) {
      const t = thoughts.find((x) => x.essayAnchor === u.id);
      if (!t) return;
      u.classList.add("anchor-flash");
      window.setTimeout(() => u.classList.remove("anchor-flash"), dur);
      open(t.id);
      return;
    }

    // 2) a discussed (quoted) passage — dotted-underlined via the highlight API. Figure out which
    // one was tapped from the caret position, flash it, and open its thought.
    const art = articleRef.current;
    const pos = caretPosFromPoint(e.clientX, e.clientY);
    if (!art || !pos) return;
    for (const { range, thought } of quotePassagesRef.current) {
      let hit = false;
      try { hit = range.isPointInRange(pos.node, pos.offset); } catch { hit = false; }
      if (hit) {
        flashRange(range, dur);
        open(thought.id);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thoughts]);

  // The essay is large, so render it to the DOM exactly once: memoize the <article> element by
  // reference. Page turns only change `leaf` (the wrapper's transform) — React sees the same
  // element reference here and skips reconciling it, so its nodes (and any anchor flash) persist.
  const articleEl = useMemo(
    () => (
      <article
        ref={articleRef}
        className="note-prose session-prose book-article"
        onClick={onEssayClick}
        dangerouslySetInnerHTML={{ __html: essayHtml }}
      />
    ),
    [essayHtml, onEssayClick]
  );

  function scrollToThought(id: string) {
    // The target may live on another page now that the stream is page-scoped — turn there
    // first, then (once it's rendered) scroll to and flash the card.
    const lf = thoughtLeaf.get(id);
    const needTurn = lf !== undefined && lf !== leafRef.current;
    if (needTurn) gotoLeaf(lf!, false);
    window.setTimeout(() => {
      const el = streamRef.current?.querySelector<HTMLElement>(`[data-thought="${CSS.escape(id)}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightId(id);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightId(null), 1300);
    }, needTurn ? 60 : 0);
  }

  function addThought() {
    const a = author.trim();
    const t = text.trim();
    if (!a || !t) return;
    const thought: Thought = {
      id: uuid(),
      author: a,
      timestamp: localTimestamp(),
      text: t,
      essayAnchor: null,
      parentId: replyTo,
      // A reply is about its parent thought, not a new passage — don't carry a quote onto it.
      quote: replyTo ? null : quote.trim() || null,
    };
    setLocalThoughts((prev) => [...prev, thought]);
    setText("");
    setQuote("");
    setReplyTo(null);
    setFormOpen(false);
    pendingQuoteRef.current = ""; // consumed — don't carry this highlight to the next thought
  }

  async function exportJson() {
    const payload = JSON.stringify(thoughts, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  const S = {
    ghostBtn: {
      font: "12px/1 var(--font-sans)",
      color: "var(--text-tertiary)",
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: "4px 6px",
      borderRadius: 5,
    } as React.CSSProperties,
    field: {
      width: "100%",
      boxSizing: "border-box" as const,
      background: "var(--bg)",
      border: "1px solid var(--card-border)",
      borderRadius: 6,
      padding: "7px 9px",
      font: "13px/1.4 var(--font-sans)",
      color: "var(--text)",
      outline: "none",
    } as React.CSSProperties,
    tag: {
      font: "11px/1.3 var(--font-sans)",
      color: "var(--text-muted)",
      background: "rgba(92,58,30,0.08)",
      border: "none",
      borderRadius: 4,
      padding: "2px 7px",
      cursor: "pointer",
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap" as const,
    } as React.CSSProperties,
  };

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header className="session-header">
        <span className="session-title">Discussion III · July 11, 2026 · Mill Mountain</span>
        <span className="session-eyebrow">reading &amp; thoughts</span>
        <button
          className="session-hamburger"
          // capture any essay highlight before opening the drawer clears the selection, so a
          // later "+ Add thought" still knows which line was highlighted
          onPointerDown={() => { pendingQuoteRef.current = readEssaySelection(); }}
          onClick={() => setMenuOpen(true)}
          aria-label="Open thoughts"
          aria-expanded={menuOpen}
        >
          <span /><span /><span />
        </button>
      </header>

      {/* mobile-only first-load nudge pointing at the top-right menu */}
      {showHint && (
        <button className="thoughts-hint" onClick={() => setMenuOpen(true)}>
          To see our thoughts, tap here
        </button>
      )}

      <div className="session-panes">
        {/* Left: the essay, as a page-turnable book (full screen on mobile) */}
        <main className="session-book">
          <div className="book-leaf">
            <div className="book-runhead">
              <span>{leaf === 0 ? "" : "Augmenting Human Cognition"}</span>
              <span className="book-sec">{leaf === 0 ? "" : sections[leaf - 1] || "Introduction"}</span>
            </div>

            <div className="book-fade" ref={fadeRef}>
              <div className="book-viewport" ref={viewportRef}>
                {/* The transform lives on this wrapper, not on the article, so the (large)
                    essay is rendered to the DOM exactly once and its nodes survive page turns. */}
                <div className="book-pageshift" style={{ transform: `translateY(${leaf > 0 ? -(offsetsRef.current[leaf - 1] ?? 0) : 0}px)` }}>
                  {articleEl}
                </div>
                {/* hide the top of the next page's block that pokes into the bottom margin */}
                {leaf > 0 && leaf < offsetsRef.current.length && (
                  <div
                    className="book-mask"
                    style={{ top: PAGE_PAD + (offsetsRef.current[leaf] - offsetsRef.current[leaf - 1]) }}
                  />
                )}
              </div>

              {leaf === 0 && (
                <div className="book-cover">
                  <div className="book-cover-eyebrow"><span>Discussion&nbsp;III</span><span className="r" /><span>July&nbsp;11,&nbsp;2026</span></div>
                  <h1 className="book-cover-title">Augmenting Human Cognition with Computers</h1>
                  <div className="book-cover-lab">Papert Lab</div>
                  <div className="book-cover-spacer" />
                  <div className="book-cover-issue"><span>In this issue</span><span className="r" /></div>
                  <p className="book-cover-feature">How can we develop transformative tools for thought?</p>
                  <div className="book-cover-byline">Andy Matuschak &amp; Michael Nielsen</div>
                  <div className="book-cover-foot"><span>Reading Group</span><span>Mill Mountain</span></div>
                </div>
              )}
            </div>

            <div className="book-foot">
              <div className="book-nav-cell">
                <button className="book-turn" disabled={leaf === 0} onClick={() => gotoLeaf(leaf - 1)} aria-label="Previous page">
                  <span className="arw">‹</span> Prev
                </button>
              </div>
              <span className="book-folio">{leaf === 0 ? "Cover" : `${leaf} / ${Math.max(1, leafCount - 1)}`}</span>
              <div className="book-nav-cell">
                <button className="book-turn" disabled={leaf >= leafCount - 1} onClick={() => gotoLeaf(leaf + 1)} aria-label="Next page">
                  Next <span className="arw">›</span>
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* Backdrop behind the mobile drawer (tap to close; hidden on desktop) */}
        <div
          className={`session-backdrop${menuOpen ? " open" : ""}`}
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />

        {/* Right: the thought stream (a slide-in drawer on mobile) */}
        <aside className={`session-stream${menuOpen ? " open" : ""}`}>
          <div ref={composerRef} style={{ flexShrink: 0, position: "relative", zIndex: 10 }}>
          <div style={{ padding: "16px 20px 14px", flexShrink: 0, borderBottom: "1px solid var(--card-border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 16, color: "var(--text)" }}>
                {streamView === "graph" ? "Concept map" : "Thought stream"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {/* Toggle the right panel between the thought list and the 3D concept map */}
                <button
                  onClick={() => setStreamView((v) => (v === "stream" ? "graph" : "stream"))}
                  className="stream-ghost"
                  title={streamView === "stream" ? "Show the 3D concept map" : "Show the thought list"}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  {streamView === "stream" ? "◎ 3D map" : "≡ Thoughts"}
                </button>
                {streamView === "stream" && (
                  <>
                    <button
                      // Desktop: capture the live essay highlight (selection survives the button click).
                      // Mobile: the selection was already cleared by opening the drawer, so keep what the
                      // hamburger captured rather than clobbering it with an empty selection.
                      onMouseDown={() => { const live = readEssaySelection(); if (live || !isMobileViewport()) pendingQuoteRef.current = live; }}
                      onClick={openComposer}
                      className={`add-thought-btn${formOpen ? " open" : ""}`}
                      title="Add a thought (highlight a passage first to attach it)"
                    >
                      <span className="plus">+</span> Add thought
                    </button>
                    <button onClick={exportJson} className="stream-ghost" title="Copy all thoughts as JSON">
                      {copied ? "Copied ✓" : "Export"}
                    </button>
                  </>
                )}
                <button
                  className="session-stream-close"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close thoughts"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </div>
          </div>

          {/* Add-thought form — a popover anchored under the header's "+ Add thought" toggle */}
          {formOpen && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 20,
              right: 20,
              zIndex: 20,
              marginTop: 4,
              padding: "12px 14px",
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: 8,
              boxShadow: "0 10px 28px rgba(61,38,21,0.16)",
              display: "flex",
              flexDirection: "column",
              gap: 7,
            }}
          >
            {replyTo && byId.get(replyTo) && (
              // Replying to a specific thought — the new thought threads (and indents) under it.
              <div style={{ position: "relative", paddingLeft: 11, paddingRight: 18, borderLeft: "2px solid var(--turtle-deep)" }}>
                <div style={{ font: "10.5px/1.4 var(--font-sans)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--turtle-deep)", fontWeight: 600 }}>
                  Replying to {byId.get(replyTo)!.author}
                </div>
                <div style={{ marginTop: 1, font: "italic 12.5px/1.45 var(--font-body)", color: "var(--text-tertiary)" }}>
                  {truncate(byId.get(replyTo)!.text, 90)}
                </div>
                <button
                  onClick={() => setReplyTo(null)}
                  title="Cancel reply"
                  style={{ position: "absolute", top: -2, right: 0, border: "none", background: "none", cursor: "pointer", color: "var(--text-tertiary)", fontSize: 15, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            )}
            {quote && !replyTo && (
              // The passage the reader highlighted — shown as the thought's subject, with a clear (×).
              <div style={{ position: "relative", paddingLeft: 11, paddingRight: 18, borderLeft: "2px solid var(--clay)" }}>
                <div style={{ font: "10.5px/1.4 var(--font-sans)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--clay)", fontWeight: 600 }}>
                  Selected passage
                </div>
                <div style={{ marginTop: 1, font: "italic 12.5px/1.5 var(--font-body)", color: "var(--text-muted)" }}>
                  {truncate(quote, 160)}
                </div>
                <button
                  onClick={() => setQuote("")}
                  title="Remove highlighted passage"
                  style={{ position: "absolute", top: -2, right: 0, border: "none", background: "none", cursor: "pointer", color: "var(--text-tertiary)", fontSize: 15, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            )}
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Your name"
              style={S.field}
            />
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={replyTo ? "Write a reply…" : quote ? "What do you make of it?" : "Add a thought…"}
              rows={3}
              style={{ ...S.field, resize: "vertical", font: "14px/1.5 var(--font-body)", color: "var(--text)" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={addThought}
                disabled={!author.trim() || !text.trim()}
                style={{
                  font: "13px/1 var(--font-sans)",
                  color: "var(--bg)",
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  cursor: author.trim() && text.trim() ? "pointer" : "default",
                  opacity: author.trim() && text.trim() ? 1 : 0.5,
                }}
              >
                Add
              </button>
            </div>
            {!quote && !replyTo && (
              <div style={{ marginTop: 2, font: "12px/1.5 var(--font-sans)", color: "var(--text-tertiary)" }}>
                Highlight a passage in the essay to attach it — optional.
              </div>
            )}
          </div>
          )}
          </div>

          {/* Graph mode: the 3D "centers of gravity" concept map fills the panel body. Fed the
              live thought set (seed + local additions) so new thoughts appear as orbiting nodes. */}
          {streamView === "graph" && (
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <GraphView thoughts={thoughts} embedded />
            </div>
          )}

          {/* Stream mode: the thoughts anchored to the page currently on screen, plus page context */}
          {streamView === "stream" && (<>
          <div ref={streamRef} style={{ flex: 1, overflowY: "auto", padding: "6px 20px 40px" }}>
            {visibleThoughts.length === 0 ? (
              <div style={{ padding: "26px 8px", textAlign: "center" }}>
                {thoughts.length === 0 ? (
                  <p style={{ font: "13px/1.6 var(--font-body)", color: "var(--text-tertiary)", margin: 0 }}>
                    No thoughts yet. Add the first one with “+ Add thought.”
                  </p>
                ) : (
                  <>
                    <p style={{ font: "13px/1.6 var(--font-body)", color: "var(--text-tertiary)", margin: "0 0 12px" }}>
                      No thoughts on this page.
                    </p>
                    {thoughtLeaves.length > 0 && (
                      <button
                        onClick={goToNextThought}
                        style={{
                          font: "12px/1 var(--font-sans)",
                          color: "var(--accent)",
                          background: "none",
                          border: "1px solid var(--card-border)",
                          borderRadius: 999,
                          padding: "7px 14px",
                          cursor: "pointer",
                        }}
                        title="Turn to the next page that has thoughts"
                      >
                        Skip to next page with a thought →
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              orderedVisible.map((t) => {
              const parent = t.parentId ? byId.get(t.parentId) : null;
              const highlighted = t.id === highlightId;
              const depth = threadDepth(t);
              return (
                <div key={t.id}>
                <div
                  data-thought={t.id}
                  style={{
                    background: highlighted ? "rgba(184,137,63,0.18)" : "var(--card-bg)",
                    border: "1px solid var(--card-border)",
                    borderRadius: 8,
                    padding: "11px 13px",
                    marginBottom: 10,
                    marginLeft: depth * 20,
                    borderLeft: depth > 0 ? "2px solid var(--card-border)" : "1px solid var(--card-border)",
                    transition: "background 400ms ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                    <span style={{ font: "13px/1 var(--font-sans)", fontWeight: 600, color: "var(--text)" }}>{t.author}</span>
                    <span style={{ font: "11px/1 var(--font-sans)", color: "var(--text-tertiary)" }}>{shortTime(t.timestamp)}</span>
                  </div>
                  {t.quote && (
                    <button
                      onClick={() => jumpToQuote(t.quote!)}
                      title="Jump to this passage"
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        cursor: "pointer",
                        margin: "0 0 7px",
                        padding: "6px 10px",
                        borderLeft: "3px solid var(--clay)",
                        border: "none",
                        borderRadius: 3,
                        background: "rgba(194,102,74,0.07)",
                        font: "italic 12.5px/1.5 var(--font-body)",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      “{truncate(t.quote, 120)}”
                    </button>
                  )}
                  <div style={{ font: "14px/1.55 var(--font-body)", color: "var(--text-muted)" }}>{t.text}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8 }}>
                    {t.essayAnchor && (() => {
                      const isPassage = isPassageAnchor(t.essayAnchor);
                      // Passage tags read their sentence from the essay; heading tags show the heading text.
                      const label = isPassage ? passages.get(t.essayAnchor) ?? t.essayAnchor : t.essayAnchor;
                      return (
                        <button
                          onClick={() => (isPassage ? scrollToPassage(t.essayAnchor!) : scrollToAnchor(t.essayAnchor!))}
                          style={S.tag}
                          title={`Jump to “${label}”`}
                        >
                          re: {truncate(label, 30)}
                        </button>
                      );
                    })()}
                    {parent && (
                      <button
                        onClick={() => scrollToThought(parent.id)}
                        style={S.tag}
                        title={`Go to ${parent.author}'s thought`}
                      >
                        ↳ {parent.author}
                      </button>
                    )}
                    <button
                      onClick={() => startReply(t.id)}
                      style={{
                        marginLeft: "auto",
                        font: "11px/1.3 var(--font-sans)",
                        color: "var(--turtle-deep)",
                        background: "rgba(122,155,122,0.14)",
                        border: "none",
                        borderRadius: 4,
                        padding: "3px 9px",
                        cursor: "pointer",
                      }}
                      title={`Reply to ${t.author}`}
                    >
                      Reply
                    </button>
                  </div>
                </div>

                {/* inline reply composer — an indented card directly under the thought */}
                {replyTo === t.id && (
                  <div
                    ref={inlineComposerRef}
                    style={{
                      marginLeft: (depth + 1) * 20,
                      marginBottom: 10,
                      border: "1px solid var(--card-border)",
                      borderLeft: "2px solid var(--turtle-deep)",
                      borderRadius: 8,
                      padding: "11px 13px",
                      background: "var(--card-bg)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                    }}
                  >
                    <div style={{ font: "10.5px/1.4 var(--font-sans)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--turtle-deep)", fontWeight: 600 }}>
                      Reply to {t.author}
                    </div>
                    <input
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      placeholder="Your name"
                      style={S.field}
                    />
                    <textarea
                      ref={textRef}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Write a reply…"
                      rows={2}
                      style={{ ...S.field, resize: "vertical", font: "14px/1.5 var(--font-body)", color: "var(--text)" }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                      <button
                        onClick={() => { setReplyTo(null); setText(""); }}
                        style={{ font: "12px/1 var(--font-sans)", color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "8px 10px" }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={addThought}
                        disabled={!author.trim() || !text.trim()}
                        style={{
                          font: "13px/1 var(--font-sans)",
                          color: "var(--bg)",
                          background: "var(--accent)",
                          border: "none",
                          borderRadius: 6,
                          padding: "8px 16px",
                          cursor: author.trim() && text.trim() ? "pointer" : "default",
                          opacity: author.trim() && text.trim() ? 1 : 0.5,
                        }}
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}
                </div>
              );
              })
            )}
          </div>

          {/* page context, pinned and centered at the bottom of the stream */}
          <div
            style={{
              flexShrink: 0,
              borderTop: "1px solid var(--card-border)",
              padding: "16px 20px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              font: "13px/1 var(--font-sans)",
              letterSpacing: "0.09em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ color: "var(--text)", fontWeight: 600 }}>
              {leaf === 0 ? "Cover" : `Page ${leaf}`}
            </span>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--rule)" }} />
            <span style={{ color: "var(--text-tertiary)" }}>
              {visibleThoughts.length === 0 ? "no thoughts here" : `${visibleThoughts.length} thought${visibleThoughts.length > 1 ? "s" : ""} here`}
            </span>
          </div>
          </>)}
        </aside>
      </div>
    </div>
  );
}
