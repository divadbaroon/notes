"use client";

import React from "react";
import type { Note } from "@/lib/notes/types";
import { renderNoteBody } from "@/lib/markdown/render";
import { renderLiveMarkdown } from "@/lib/markdown/live";
import { saveNode, signOut, makeSlug } from "@/lib/notes/client";

type Member = { userId: string; username: string } | null;
type Popup = { slug: string; src: number; top: number; left: number; h: number };
type ACItem = { slug?: string; title: string; create?: boolean };
type AC = { open: boolean; mode: "mention" | "link"; from: number; items: ACItem[]; index: number };

type Props = { initialNodes: Note[]; initialStack: string[]; member: Member };
type State = { stack: string[]; sides: (string | null)[]; popup: Popup | null; editing: string | null; saved: string };

const SPINE = 46;
const COL = 552;
const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default class Wiki extends React.Component<Props, State> {
  data: Record<string, Note> = {};
  scrollRef = React.createRef<HTMLDivElement>();
  titleRef = React.createRef<HTMLInputElement>();
  bodyRef = React.createRef<HTMLDivElement>();
  _acEl: HTMLDivElement | null = null;
  _ac: AC | null = null;
  _boundEditor: string | null = null;
  _hideT: ReturnType<typeof setTimeout> | undefined;
  _saveT: ReturnType<typeof setTimeout> | undefined;
  _onScroll = () => this.recompute();
  _onKey = (e: KeyboardEvent) => this.handleKey(e);
  _onOver = (e: MouseEvent) => this.handleOver(e);
  _onOut = (e: MouseEvent) => this.handleOut(e);
  _onClick = (e: MouseEvent) => this.handleDocClick(e);
  _onPop = () => this.syncFromUrl();

  constructor(props: Props) {
    super(props);
    props.initialNodes.forEach((n) => (this.data[n.slug] = n));
    const first = props.initialNodes[0]?.slug;
    const stack = props.initialStack.length ? props.initialStack : first ? [first] : [];
    this.state = { stack, sides: [], popup: null, editing: null, saved: "" };
  }

  componentDidMount() {
    const el = this.scrollRef.current;
    if (el) el.addEventListener("scroll", this._onScroll, { passive: true });
    window.addEventListener("resize", this._onScroll);
    window.addEventListener("popstate", this._onPop);
    document.addEventListener("mouseover", this._onOver);
    document.addEventListener("mouseout", this._onOut);
    document.addEventListener("click", this._onClick, true);
    document.addEventListener("keydown", this._onKey, true);
    let tries = 0;
    const settle = () => {
      this.recompute();
      if (++tries < 12) setTimeout(settle, 55);
    };
    setTimeout(settle, 40);
  }
  componentDidUpdate() {
    const id = this.state.editing;
    if (id && this.bodyRef.current && this._boundEditor !== id) {
      const nd = this.data[id] || ({} as Note);
      if (this.titleRef.current && document.activeElement !== this.titleRef.current)
        this.titleRef.current.value = nd.title || "";
      this.bodyRef.current.innerHTML = nd.body ? renderLiveMarkdown(nd.body) : "";
      this.bindEditor();
      this._boundEditor = id;
    } else if (!id) {
      this._boundEditor = null;
    }
  }
  componentWillUnmount() {
    const el = this.scrollRef.current;
    if (el) el.removeEventListener("scroll", this._onScroll);
    window.removeEventListener("resize", this._onScroll);
    window.removeEventListener("popstate", this._onPop);
    document.removeEventListener("mouseover", this._onOver);
    document.removeEventListener("mouseout", this._onOut);
    document.removeEventListener("click", this._onClick, true);
    document.removeEventListener("keydown", this._onKey, true);
    clearTimeout(this._hideT);
    clearTimeout(this._saveT);
    if (this._acEl?.parentNode) this._acEl.parentNode.removeChild(this._acEl);
  }

  // ---- URL <-> stack ----
  pushUrl(stack: string[]) {
    const path = "/" + stack.join("/");
    if (typeof window !== "undefined" && window.location.pathname !== path)
      window.history.pushState({}, "", path);
  }
  syncFromUrl() {
    const segs = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const stack = segs.filter((s) => this.data[s]);
    if (stack.length) this.setState({ stack, editing: null, popup: null }, () => this.recompute());
  }

  // ---- spine collapse ----
  recompute() {
    const el = this.scrollRef.current;
    if (!el) return;
    const roots = [...el.querySelectorAll("[data-col-root]")] as HTMLElement[];
    const cr = el.getBoundingClientRect();
    const sides = roots.map((r, i) => {
      const a = r.getBoundingClientRect();
      const leftPinned = a.left <= cr.left + i * SPINE + 2;
      const nextCovers = roots[i + 1]
        ? roots[i + 1].getBoundingClientRect().left <= a.left + SPINE + 2
        : false;
      return leftPinned && nextCovers ? "left" : null;
    });
    const cur = this.state.sides;
    if (cur.length !== sides.length || sides.some((v, i) => v !== cur[i])) this.setState({ sides });
  }
  scrollEnd() {
    const go = () => {
      const x = this.scrollRef.current;
      if (x) x.scrollTo({ left: x.scrollWidth, behavior: "smooth" });
    };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 80);
    setTimeout(() => this.recompute(), 460);
  }
  focusColumn(i: number) {
    requestAnimationFrame(() => {
      const el = this.scrollRef.current;
      if (!el) return;
      const root = el.querySelector(`[data-col-root="${i}"]`) as HTMLElement | null;
      if (!root) return;
      el.scrollTo({ left: Math.max(0, root.offsetLeft - i * SPINE), behavior: "smooth" });
      setTimeout(() => this.recompute(), 380);
    });
  }

  // ---- linking: focus if open, else branch ----
  openNote(srcIndex: number, slug: string) {
    if (!this.data[slug]) return;
    const stack = this.state.stack;
    const existing = stack.indexOf(slug);
    if (existing >= 0) {
      this.hidePopup();
      this.focusColumn(existing);
      return;
    }
    const ns = stack.slice(0, srcIndex + 1);
    ns.push(slug);
    this.setState({ stack: ns, popup: null }, () => {
      this.pushUrl(ns);
      this.scrollEnd();
    });
  }
  removeColumn(i: number) {
    if (this.state.stack.length <= 1) return;
    const slug = this.state.stack[i];
    const ns = this.state.stack.slice();
    ns.splice(i, 1);
    let editing = this.state.editing;
    if (editing === slug) editing = null;
    this.setState({ stack: ns, editing, popup: null }, () => {
      this.pushUrl(ns);
      this.scrollEnd();
    });
  }

  copyLink(slug: string) {
    const url = window.location.origin + "/" + slug;
    navigator.clipboard?.writeText(url);
    this.setState({ saved: "Link copied" });
    setTimeout(() => this.setState({ saved: "" }), 1400);
  }

  // ---- new note (members only) ----
  async newNote() {
    if (!this.props.member) {
      window.location.href = "/login";
      return;
    }
    const existing = new Set(Object.keys(this.data));
    const slug = makeSlug("untitled", existing);
    const now = new Date().toISOString();
    this.data[slug] = {
      id: "", slug, title: "", body: "", body_text: "",
      created_at: now, updated_at: now, created_by: null, last_edited_by: null,
    } as Note;
    const ns = this.state.stack.slice();
    ns.push(slug);
    this.setState({ stack: ns, editing: slug, popup: null }, () => {
      this.pushUrl(ns);
      this.scrollEnd();
      setTimeout(() => {
        this.bindEditor();
        this._boundEditor = slug;
        this.titleRef.current?.focus();
        this.recompute();
      }, 140);
    });
  }

  // ---- hover preview ----
  cancelHide() { clearTimeout(this._hideT); }
  scheduleHide() {
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => this.setState({ popup: null }), 220);
  }
  hidePopup() { clearTimeout(this._hideT); this.setState({ popup: null }); }
  showPopup(slug: string, src: number, rect: DOMRect) {
    if (!this.data[slug]) return;
    const W = 460, vw = window.innerWidth, vh = window.innerHeight, topM = 72, botM = 24;
    const h = Math.min(560, vh - topM - botM);
    let left = rect.right + 14;
    if (left + W > vw - 12) left = rect.left - W - 14;
    if (left < 12) left = Math.max(12, vw - W - 12);
    let top = rect.top;
    if (top > vh - botM - h) top = vh - botM - h;
    if (top < topM) top = topM;
    this.setState({ popup: { slug, src, top, left, h } });
  }
  handleOver(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (!t.closest) return;
    if (t.closest("[data-popup]")) { this.cancelHide(); return; }
    const a = t.closest(".col-content [data-note], [data-popup] [data-note]") as HTMLElement | null;
    if (!a || t.closest(".md-editor")) return;
    this.cancelHide();
    const root = a.closest("[data-col-root]") as HTMLElement | null;
    let src = this.state.stack.length - 1;
    if (root) src = parseInt(root.getAttribute("data-col-root")!, 10);
    else if (this.state.popup) src = this.state.popup.src;
    this.showPopup(a.getAttribute("data-note")!, src, a.getBoundingClientRect());
  }
  handleOut(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (!t.closest) return;
    const to = e.relatedTarget as Node | null;
    const pop = t.closest("[data-popup]");
    if (pop) { if (to && pop.contains(to)) return; this.scheduleHide(); return; }
    const a = t.closest("[data-note]");
    if (a) { if (to && a.contains(to)) return; this.scheduleHide(); }
  }
  handleDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (!t.closest || t.closest(".md-editor") || t.closest(".ed-title")) return;
    const pop = t.closest("[data-popup]");
    if (pop) {
      const a = t.closest("[data-note]") as HTMLElement | null;
      if (a) {
        e.preventDefault();
        this.openNote(this.state.popup ? this.state.popup.src : this.state.stack.length - 1, a.getAttribute("data-note")!);
      }
      return;
    }
    const root = t.closest("[data-col-root]") as HTMLElement | null;
    if (!root) return;
    const idx = parseInt(root.getAttribute("data-col-root")!, 10);
    const a = t.closest("[data-note]") as HTMLElement | null;
    if (a) { e.preventDefault(); this.openNote(idx, a.getAttribute("data-note")!); return; }
    if (t.closest("[data-spine]")) this.focusColumn(idx);
  }
  handleKey(e: KeyboardEvent) {
    if (e.key === "Escape" && this.state.editing && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  }

  // ---- backlinks (computed from loaded nodes) ----
  computeBacklinks(slug: string) {
    const out: { to: string; title: string; snippet: string }[] = [];
    for (const s in this.data) {
      if (s === slug) continue;
      const nd = this.data[s];
      const b = nd.body || "";
      if (b.includes(`[[${slug}]]`) || b.includes(`](${slug})`)) {
        const text = b.replace(/[#*`>\[\]]/g, "").replace(/\(([^)]*)\)/g, "").replace(/\s+/g, " ").trim();
        out.push({ to: s, title: nd.title || s, snippet: text.length > 150 ? text.slice(0, 150) + "…" : text });
      }
    }
    return out;
  }

  // ---- caret helpers (ported) ----
  caretOffsets(el: HTMLElement) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return { start: 0, end: 0 };
    const r = sel.getRangeAt(0);
    const a = r.cloneRange(); a.selectNodeContents(el); a.setEnd(r.startContainer, r.startOffset);
    const b = r.cloneRange(); b.selectNodeContents(el); b.setEnd(r.endContainer, r.endOffset);
    return { start: a.toString().length, end: b.toString().length };
  }
  setSel(el: HTMLElement, s: number, e: number) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n = w.nextNode();
    if (!n) {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(true);
      const sl = window.getSelection(); sl?.removeAllRanges(); sl?.addRange(r); return;
    }
    let count = 0, cs: Node | null = null, co = 0, ce: Node | null = null, eo = 0;
    while (n) {
      const len = n.nodeValue!.length;
      if (cs === null && count + len >= s) { cs = n; co = s - count; }
      if (count + len >= e) { ce = n; eo = e - count; break; }
      count += len;
      const nx = w.nextNode();
      if (!nx) { ce = n; eo = len; break; }
      n = nx;
    }
    if (cs === null) { cs = ce; co = eo; }
    const r = document.createRange();
    try { r.setStart(cs!, co); r.setEnd(ce!, eo); } catch { r.selectNodeContents(el); r.collapse(false); }
    const sl = window.getSelection(); sl?.removeAllRanges(); sl?.addRange(r);
  }
  setCaret(el: HTMLElement, p: number) { this.setSel(el, p, p); }

  // ---- editor binding ----
  bindEditor() {
    const el = this.bodyRef.current;
    if (!el) return;
    el.oninput = () => this.onBodyInput();
    el.onkeydown = (e) => this.onBodyKey(e);
    el.onpaste = (e) => {
      e.preventDefault();
      const txt = e.clipboardData?.getData("text") || "";
      this.insertText(txt);
    };
    el.onblur = () => setTimeout(() => this.hideAC(), 160);
    if (this.titleRef.current) {
      this.titleRef.current.oninput = () => this.save();
      this.titleRef.current.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); this.bodyRef.current?.focus(); }
      };
    }
  }
  onBodyInput() {
    const el = this.bodyRef.current!;
    const { start } = this.caretOffsets(el);
    const text = el.textContent || "";
    el.innerHTML = renderLiveMarkdown(text);
    this.setCaret(el, start);
    this.save();
    this.checkAutocomplete(text, start);
  }
  onBodyKey(e: KeyboardEvent) {
    if (this._ac?.open) {
      if (e.key === "ArrowDown") { e.preventDefault(); this._ac.index = (this._ac.index + 1) % this._ac.items.length; this.renderACSel(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); this._ac.index = (this._ac.index - 1 + this._ac.items.length) % this._ac.items.length; this.renderACSel(); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); this.selectAC(this._ac.index); return; }
      if (e.key === "Escape") { e.preventDefault(); this.hideAC(); return; }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "b" || e.key === "B")) { e.preventDefault(); this.wrap("**", "**"); return; }
    if (mod && (e.key === "i" || e.key === "I")) { e.preventDefault(); this.wrap("*", "*"); return; }
    if (mod && (e.key === "k" || e.key === "K")) { e.preventDefault(); this.insertLink(); return; }
    if (e.key === "Enter") { e.preventDefault(); this.insertText("\n"); return; }
  }
  insertText(t: string) {
    const el = this.bodyRef.current!;
    const { start, end } = this.caretOffsets(el);
    const text = el.textContent || "";
    const nt = text.slice(0, start) + t + text.slice(end);
    el.innerHTML = renderLiveMarkdown(nt);
    this.setCaret(el, start + t.length);
    this.save();
    if (t === "\n") this.hideAC();
  }
  wrap(pre: string, post: string) {
    const el = this.bodyRef.current!;
    const { start, end } = this.caretOffsets(el);
    const text = el.textContent || "";
    const sel = text.slice(start, end);
    const nt = text.slice(0, start) + pre + sel + post + text.slice(end);
    el.innerHTML = renderLiveMarkdown(nt);
    if (sel) this.setSel(el, start + pre.length, end + pre.length);
    else this.setCaret(el, start + pre.length);
    this.save();
  }
  insertLink() {
    const el = this.bodyRef.current!;
    const { start, end } = this.caretOffsets(el);
    const text = el.textContent || "";
    const sel = text.slice(start, end);
    const ins = "[" + sel + "]()";
    const nt = text.slice(0, start) + ins + text.slice(end);
    el.innerHTML = renderLiveMarkdown(nt);
    const paren = start + 1 + sel.length + 2;
    this.setCaret(el, paren);
    this.save();
    this.checkAutocomplete(el.textContent || "", paren);
  }

  // ---- save (debounced) ----
  save() {
    const slug = this.state.editing;
    if (!slug) return;
    const title = this.titleRef.current?.value.trim() ?? "";
    const body = this.bodyRef.current?.textContent ?? "";
    const nd = this.data[slug];
    this.data[slug] = { ...nd, title, body };
    this.setState({ saved: "Saving…" });
    clearTimeout(this._saveT);
    this._saveT = setTimeout(async () => {
      try {
        const row = await saveNode({ id: nd.id || null, slug, title, body });
        this.data[slug] = row;
        this.setState({ saved: "Saved" });
      } catch (e) {
        this.setState({ saved: "Save failed" });
        console.error("[wiki] save failed", e);
      }
    }, 600);
  }

  // ---- autocomplete ----
  searchNodes(q: string): ACItem[] {
    const ql = q.toLowerCase().trim();
    const cur = this.state.editing;
    return Object.values(this.data)
      .filter((n) => n.slug !== cur && n.title && n.title.toLowerCase().includes(ql))
      .slice(0, 8)
      .map((n) => ({ slug: n.slug, title: n.title }));
  }
  checkAutocomplete(text: string, caret: number) {
    const before = text.slice(0, caret);
    let m = before.match(/\]\(([^)\n]*)$/);
    if (m) {
      const q = m[1];
      const items = this.searchNodes(q);
      const urlish = /[:/]/.test(q);
      if (items.length) { this._ac = { open: true, mode: "link", from: caret - q.length, items, index: 0 }; this.showAC(); return; }
      if (q.trim() && !urlish) { this._ac = { open: true, mode: "link", from: caret - q.length, items: [{ create: true, title: q.trim() }], index: 0 }; this.showAC(); return; }
      this.hideAC(); return;
    }
    m = before.match(/@([^@\n]{0,60})$/);
    if (m) {
      const q = m[1];
      const items = this.searchNodes(q);
      if (items.length) { this._ac = { open: true, mode: "mention", from: caret - m[0].length, items, index: 0 }; this.showAC(); return; }
      if (q.trim()) { this._ac = { open: true, mode: "mention", from: caret - m[0].length, items: [{ create: true, title: q.trim() }], index: 0 }; this.showAC(); return; }
    }
    this.hideAC();
  }
  ensureAC() {
    if (this._acEl) return;
    const d = document.createElement("div");
    d.style.cssText =
      "position:fixed;z-index:3000;display:none;min-width:240px;max-width:360px;max-height:248px;overflow-y:auto;background:var(--card-bg);border:1px solid var(--card-border);border-radius:7px;box-shadow:0 14px 30px rgba(61,38,21,0.24);padding:4px;";
    d.addEventListener("mousedown", (e) => {
      const it = (e.target as HTMLElement).closest("[data-i]");
      if (it) { e.preventDefault(); this.selectAC(parseInt(it.getAttribute("data-i")!, 10)); }
    });
    document.body.appendChild(d);
    this._acEl = d;
  }
  showAC() {
    this.ensureAC();
    const d = this._acEl!;
    const items = this._ac!.items;
    d.innerHTML = items
      .map(
        (it, i) =>
          `<div data-i="${i}" class="md-ac-item" style="padding:7px 11px;border-radius:5px;cursor:pointer;font:14.5px/1.35 var(--font-body);color:${it.create ? "var(--accent)" : "var(--text)"};background:${i === this._ac!.index ? "rgba(92,58,30,0.08)" : "transparent"};">${it.create ? "+ Create note “" + esc(it.title) + "”" : esc(it.title)}</div>`
      )
      .join("");
    const sel = window.getSelection();
    let rect: DOMRect | null = null;
    if (sel && sel.rangeCount) {
      const rr = sel.getRangeAt(0).getClientRects();
      rect = (rr[rr.length - 1] as DOMRect) || sel.getRangeAt(0).getBoundingClientRect();
    }
    if (!rect || (!rect.width && !rect.height && !rect.top)) rect = this.bodyRef.current!.getBoundingClientRect();
    const h = Math.min(248, items.length * 36 + 10);
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = rect.top - 6 - h;
    d.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 368)) + "px";
    d.style.top = Math.max(8, top) + "px";
    d.style.display = "block";
  }
  renderACSel() {
    if (!this._acEl || !this._ac) return;
    [...this._acEl.querySelectorAll("[data-i]")].forEach((el, i) => {
      (el as HTMLElement).style.background = i === this._ac!.index ? "rgba(92,58,30,0.08)" : "transparent";
    });
  }
  hideAC() {
    this._ac = null;
    if (this._acEl) this._acEl.style.display = "none";
  }
  async selectAC(i: number) {
    if (!this._ac || !this.bodyRef.current) return;
    const el = this.bodyRef.current;
    const cur = this.caretOffsets(el);
    const text = el.textContent || "";
    const item = this._ac.items[i];
    if (!item) return;
    let targetSlug = item.slug;
    if (item.create) targetSlug = await this.createNode(item.title);
    const from = this._ac.from;
    if (this._ac.mode === "link") {
      const bracketClose = from - 2;
      const bracketOpen = text.lastIndexOf("[", bracketClose);
      const display = bracketOpen >= 0 ? text.slice(bracketOpen + 1, bracketClose) : "";
      const finalDisplay = display.trim() ? display : item.title;
      const linkStart = bracketOpen >= 0 ? bracketOpen : from;
      const newLink = "[" + finalDisplay + "](" + targetSlug + ")";
      const nt = text.slice(0, linkStart) + newLink + text.slice(cur.start + 1);
      el.innerHTML = renderLiveMarkdown(nt);
      this.setCaret(el, linkStart + newLink.length);
    } else {
      const ins = "[[" + targetSlug + "]] ";
      const nt = text.slice(0, from) + ins + text.slice(cur.start);
      el.innerHTML = renderLiveMarkdown(nt);
      this.setCaret(el, from + ins.length);
    }
    this.hideAC();
    this.save();
    this.bodyRef.current?.focus();
  }
  async createNode(title: string): Promise<string> {
    const slug = makeSlug(title, new Set(Object.keys(this.data)));
    const now = new Date().toISOString();
    this.data[slug] = {
      id: "", slug, title, body: "", body_text: "",
      created_at: now, updated_at: now, created_by: null, last_edited_by: null,
    } as Note;
    try {
      const row = await saveNode({ id: null, slug, title, body: "" });
      this.data[slug] = row;
    } catch (e) {
      console.error("[wiki] createNode failed", e);
    }
    return slug;
  }

  render() {
    const { stack, sides, editing, popup, saved } = this.state;
    const member = this.props.member;
    const titles: Record<string, string> = {};
    Object.values(this.data).forEach((n) => (titles[n.slug] = n.title));
    const openSet = new Set(stack);

    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "14px 28px", borderBottom: "1px solid var(--card-border)", flexShrink: 0, zIndex: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
            <span onClick={() => this.openNote(0, stack[0])} style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 19, color: "var(--text)", cursor: "pointer" }}>
              Papert Lab wiki
            </span>
            <button className="newbtn" onClick={() => this.newNote()} style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-tertiary)", background: "transparent", border: "1px solid var(--card-border)", borderRadius: 5, padding: "4px 10px", cursor: "pointer", letterSpacing: 0.2 }}>
              New note
            </button>
            {saved && <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-tertiary)" }}>{saved}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            {member ? (
              <>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-tertiary)" }}>{member.username}</span>
                <button onClick={async () => { await signOut(); window.location.reload(); }} style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>sign out</button>
              </>
            ) : (
              <a href="/login" style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-tertiary)", textDecoration: "none" }}>Sign in to edit</a>
            )}
          </div>
        </header>

        <div className="scroller" ref={this.scrollRef} style={{ flex: 1, display: "flex", alignItems: "stretch", overflowX: "auto", overflowY: "hidden", position: "relative" }}>
          {stack.map((slug, i) => {
            const note = this.data[slug] || ({ slug, title: slug, body: "" } as Note);
            const isCol = !!sides[i];
            const isEditing = editing === slug;
            const html = renderNoteBody(note.body || "", titles).replace(
              / data-slug="([^"]*)"/g,
              (_m2, s) => ` data-note="${s}"${openSet.has(s) ? ' data-open="1"' : ""}`
            );
            const backlinks = this.computeBacklinks(slug);
            return (
              <div key={slug} data-col-root={i} style={{ position: "sticky", left: i * SPINE, flex: `0 0 ${COL}px`, width: COL, height: "100%", zIndex: i + 1, borderRight: "1px solid var(--card-border)", background: "var(--card-bg)", boxShadow: "-12px 0 26px -16px rgba(61,38,21,0.26)" }}>
                <div data-spine style={{ position: "absolute", top: 0, bottom: 0, width: SPINE, zIndex: 2, left: 0, background: "var(--card-bg)", borderRight: "1px solid var(--card-border)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 30, cursor: "pointer", opacity: isCol ? 1 : 0, pointerEvents: isCol ? "auto" : "none" }}>
                  <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontFamily: "var(--font-sans)", fontSize: 13, letterSpacing: 0.2, color: "var(--text-muted)", whiteSpace: "nowrap", maxHeight: "calc(100vh - 170px)", overflow: "hidden", textOverflow: "ellipsis" }}>{note.title || "Untitled note"}</span>
                </div>
                {stack.length > 1 && i === stack.length - 1 && (
                  <button className="closebtn" title="Close note" onClick={() => this.removeColumn(i)} style={{ position: "absolute", top: 8, right: 14, zIndex: 5, background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 24, lineHeight: 1, padding: "2px 6px" }}>×</button>
                )}
                <div className="col-content" style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "40px 46px 88px", boxSizing: "border-box", background: "var(--card-bg)", zIndex: 1 }}>
                  {isEditing ? (
                    <>
                      <input ref={this.titleRef} className="ed-title" type="text" placeholder="Untitled note" style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none", background: "transparent", fontFamily: "var(--font-body)", fontSize: 28, fontWeight: 400, color: "var(--text)", lineHeight: 1.2, margin: "0 0 16px", letterSpacing: "-0.01em" }} />
                      <div ref={this.bodyRef} className="md-editor" contentEditable suppressContentEditableWarning data-placeholder="Start writing in Markdown… type @ to link a note" style={{ minHeight: "60vh", fontFamily: "var(--font-body)", fontSize: 16, lineHeight: 1.72, color: "var(--text-muted)" }} />
                    </>
                  ) : (
                    <>
                      <h1 onClick={() => this.copyLink(slug)} title="Copy link to this note" style={{ fontFamily: "var(--font-body)", fontSize: 28, lineHeight: 1.18, fontWeight: 400, color: "var(--text)", margin: "0 36px 6px 0", letterSpacing: "-0.01em", cursor: "pointer" }}>
                        {note.title || "Untitled note"}
                      </h1>
                      <div style={{ fontFamily: "var(--font-sans)", fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 22, display: "flex", gap: 14 }}>
                        {note.updated_at && <span>last edited {new Date(note.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>}
                        {member && <button onClick={() => this.setState({ editing: slug }, () => this.recompute())} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", font: "inherit", textTransform: "uppercase", letterSpacing: 0.5 }}>edit</button>}
                      </div>
                      <div className="note-prose" dangerouslySetInnerHTML={{ __html: html }} />
                      {backlinks.length > 0 && (
                        <>
                          <hr style={{ border: 0, borderTop: "1px solid var(--card-border)", margin: "40px 0 22px" }} />
                          <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--text-tertiary)", marginBottom: 18 }}>Links to this note</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "22px 26px" }}>
                            {backlinks.map((bl) => (
                              <a key={bl.to} href="#" data-note={bl.to} style={{ display: "block", textDecoration: "none", color: "inherit", cursor: "pointer", borderRadius: 3, padding: "4px 6px", margin: "-4px -6px", background: openSet.has(bl.to) ? "rgba(184,137,63,0.16)" : "transparent" }}>
                                <div style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "var(--accent)", lineHeight: 1.35, marginBottom: 6 }}>{bl.title}</div>
                                <div style={{ fontFamily: "var(--font-body)", fontSize: 13.5, lineHeight: 1.5, color: "var(--text-tertiary)", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{bl.snippet}</div>
                              </a>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {popup && this.data[popup.slug] && (
          <div data-popup style={{ position: "fixed", top: popup.top, left: popup.left, width: 460, maxWidth: "calc(100vw - 24px)", height: popup.h, boxSizing: "border-box", overflowY: "auto", background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 6, boxShadow: "0 16px 36px rgba(61,38,21,0.26)", padding: "28px 30px 32px", zIndex: 1000 }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 21, fontWeight: 400, color: "var(--text)", lineHeight: 1.25, margin: "0 0 14px" }}>{this.data[popup.slug].title}</div>
            <div className="note-prose" dangerouslySetInnerHTML={{ __html: renderNoteBody(this.data[popup.slug].body || "", titles).replace(/ data-slug="([^"]*)"/g, ' data-note="$1"') }} />
          </div>
        )}
      </div>
    );
  }
}
