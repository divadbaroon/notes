"use client";

import { useMemo, useState } from "react";
import type { NoteListItem } from "@/lib/notes/queries";
import { deleteNode } from "@/lib/notes/client";

const UNTITLED = "Untitled note";

function displayTitle(n: NoteListItem): string {
  return n.title?.trim() ? n.title.trim() : UNTITLED;
}

// Empty titles sort last; otherwise case-insensitive alphabetical.
function sortNotes(a: NoteListItem, b: NoteListItem): number {
  const at = a.title?.trim() ?? "";
  const bt = b.title?.trim() ?? "";
  if (!at && !bt) return a.slug.localeCompare(b.slug);
  if (!at) return 1;
  if (!bt) return -1;
  return at.toLowerCase().localeCompare(bt.toLowerCase());
}

export default function AllNotes({ notes, isMember }: { notes: NoteListItem[]; isMember: boolean }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState(notes);
  const [confirming, setConfirming] = useState<string | null>(null); // slug pending delete-confirm
  const [busy, setBusy] = useState<string | null>(null);

  const sorted = useMemo(() => [...list].sort(sortNotes), [list]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter((n) => displayTitle(n).toLowerCase().includes(needle));
  }, [sorted, q]);

  async function onDelete(slug: string) {
    setBusy(slug);
    try {
      await deleteNode(slug);
      setList((prev) => prev.filter((n) => n.slug !== slug));
    } catch (e) {
      console.error("[all] delete failed", e);
      alert("Delete failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <main style={{ maxWidth: 620, margin: "0 auto", padding: "64px 28px 96px", minHeight: "100vh", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 22 }}>
        <h1 style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontWeight: 400, fontSize: 30, color: "var(--text)", margin: 0, letterSpacing: "-0.01em" }}>
          All notes
        </h1>
        <a href="/" style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-tertiary)", textDecoration: "none" }}>
          back to the wiki
        </a>
      </div>

      <input
        type="text"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search titles"
        style={{
          width: 220,
          maxWidth: "100%",
          boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          color: "var(--text)",
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: 0,
          padding: "5px 8px",
          outline: "none",
          marginBottom: 24,
        }}
      />

      {filtered.length === 0 ? (
        <p style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "var(--text-tertiary)", fontStyle: "italic" }}>
          No notes match.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {filtered.map((n) => (
            <li key={n.slug} style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "0 0 9px" }}>
              <a
                href={"/" + n.slug}
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 16,
                  lineHeight: 1.5,
                  color: "var(--accent)",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                  textDecorationThickness: 1,
                  fontStyle: n.title?.trim() ? "normal" : "italic",
                  opacity: n.title?.trim() ? 1 : 0.65,
                }}
              >
                {displayTitle(n)}
              </a>
              {isMember &&
                (confirming === n.slug ? (
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: 11.5 }}>
                    <button
                      onClick={() => onDelete(n.slug)}
                      disabled={busy === n.slug}
                      style={{ border: "none", background: "none", color: "var(--clay)", cursor: "pointer", padding: 0 }}
                    >
                      {busy === n.slug ? "deleting…" : "confirm delete"}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      style={{ border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 0, marginLeft: 8 }}
                    >
                      cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirming(n.slug)}
                    title="Delete note"
                    style={{ border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11.5, padding: 0 }}
                  >
                    delete
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
