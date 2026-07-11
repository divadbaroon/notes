"use client";

// A self-contained, local-first notes page. Everything lives in the browser via
// localStorage — no Supabase, no auth, no network. It reuses the app's pure markdown
// renderer and design tokens so it looks like the rest of the wiki. This is a personal
// scratch space, deliberately separate from the shared Supabase-backed app at "/".

import { useEffect, useRef, useState } from "react";
import { renderNoteBody } from "@/lib/markdown/render";

type LocalNote = { id: string; title: string; body: string; updated: number };

const STORAGE_KEY = "papert-local-notes";

function load(): LocalNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as LocalNote[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(notes: LocalNote[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    /* quota / private mode — ignore */
  }
}

function newNote(): LocalNote {
  // crypto.randomUUID is available in every modern browser; fall back just in case.
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(36).slice(2);
  return { id, title: "", body: "", updated: Date.now() };
}

export default function LocalNotesPage() {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // hydrate from localStorage on mount (client-only)
  useEffect(() => {
    const loaded = load();
    setNotes(loaded);
    setActiveId(loaded[0]?.id ?? null);
    setReady(true);
  }, []);

  // persist whenever notes change (after the initial hydrate)
  useEffect(() => {
    if (ready) save(notes);
  }, [notes, ready]);

  const active = notes.find((n) => n.id === activeId) ?? null;

  function create() {
    const n = newNote();
    setNotes((prev) => [n, ...prev]);
    setActiveId(n.id);
    setPreview(false);
    setTimeout(() => bodyRef.current?.focus(), 0);
  }

  function patch(id: string, fields: Partial<LocalNote>) {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...fields, updated: Date.now() } : n))
    );
  }

  function remove(id: string) {
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      if (id === activeId) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  // link resolution isn't wired for local notes; pass an empty title map so [[x]] and
  // [a](b) still render as (harmless) links and all other markdown formats normally.
  const html = active ? renderNoteBody(active.body, {}) : "";

  const S = {
    sidebarItem: (isActive: boolean): React.CSSProperties => ({
      display: "block",
      width: "100%",
      textAlign: "left",
      border: "none",
      cursor: "pointer",
      background: isActive ? "rgba(92,58,30,0.10)" : "transparent",
      borderRadius: 6,
      padding: "9px 11px",
      marginBottom: 2,
      font: "15px/1.35 var(--font-body)",
      color: "var(--text)",
    }),
    ghostBtn: {
      font: "12px/1 var(--font-sans)",
      color: "var(--text-tertiary)",
      background: "none",
      border: "none",
      cursor: "pointer",
    } as React.CSSProperties,
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "14px 28px",
          borderBottom: "1px solid var(--card-border)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 19, color: "var(--text)" }}>
          My local notes
        </span>
        <span style={{ font: "11px/1 var(--font-sans)", letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          stored in this browser
        </span>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Sidebar: note list */}
        <aside
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: "1px solid var(--card-border)",
            padding: "16px 12px",
            overflowY: "auto",
            background: "var(--card-bg)",
          }}
        >
          <button
            onClick={create}
            style={{
              width: "100%",
              padding: "9px 11px",
              marginBottom: 12,
              font: "14px/1 var(--font-sans)",
              color: "var(--bg)",
              background: "var(--accent)",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            + New note
          </button>

          {ready && notes.length === 0 && (
            <p style={{ font: "13px/1.5 var(--font-body)", color: "var(--text-tertiary)", padding: "0 4px" }}>
              No notes yet. Create one — it saves to this browser automatically.
            </p>
          )}

          {notes.map((n) => (
            <div key={n.id} style={{ position: "relative" }}>
              <button onClick={() => { setActiveId(n.id); setPreview(false); }} style={S.sidebarItem(n.id === activeId)}>
                {n.title.trim() || "Untitled note"}
              </button>
              {n.id === activeId && (
                <button
                  onClick={() => remove(n.id)}
                  title="Delete note"
                  style={{ ...S.ghostBtn, position: "absolute", top: 9, right: 8, fontSize: 16, lineHeight: 1, color: "var(--clay)" }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </aside>

        {/* Editor / preview */}
        <main style={{ flex: 1, overflowY: "auto", background: "var(--card-bg)" }}>
          {!active ? (
            <div style={{ maxWidth: 620, margin: "80px auto", padding: "0 28px", color: "var(--text-tertiary)", fontFamily: "var(--font-body)" }}>
              Select a note on the left, or create a new one to start writing.
            </div>
          ) : (
            <div style={{ maxWidth: 620, margin: "0 auto", padding: "40px 28px 88px", boxSizing: "border-box" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button onClick={() => setPreview((p) => !p)} style={S.ghostBtn}>
                  {preview ? "✎ Edit" : "◉ Preview"}
                </button>
              </div>

              <input
                value={active.title}
                onChange={(e) => patch(active.id, { title: e.target.value })}
                placeholder="Untitled note"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontFamily: "var(--font-body)",
                  fontSize: 28,
                  fontWeight: 400,
                  color: "var(--text)",
                  lineHeight: 1.2,
                  margin: "0 0 16px",
                  letterSpacing: "-0.01em",
                }}
              />

              {preview ? (
                <div className="note-prose" dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <textarea
                  ref={bodyRef}
                  value={active.body}
                  onChange={(e) => patch(active.id, { body: e.target.value })}
                  placeholder="Start writing in Markdown…  **bold**, *italic*, # heading, - list, [link](https://…)"
                  spellCheck
                  style={{
                    width: "100%",
                    minHeight: "62vh",
                    boxSizing: "border-box",
                    resize: "vertical",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    fontFamily: "var(--font-mono)",
                    fontSize: 14,
                    lineHeight: 1.7,
                    color: "var(--text-muted)",
                  }}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
