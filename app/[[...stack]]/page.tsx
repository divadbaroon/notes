import { notFound } from "next/navigation";
import { getNodeBySlug, getSlugTitleMap } from "@/lib/notes/queries";
import { renderNoteBody } from "@/lib/markdown/render";
import { formatEdited } from "@/lib/util/format";

const HOME_SLUG = "evergreen";

export default async function Page({
  params,
}: {
  params: Promise<{ stack?: string[] }>;
}) {
  const { stack = [] } = await params;
  const slug = stack[stack.length - 1] ?? HOME_SLUG;
  const note = await getNodeBySlug(slug);
  if (!note) notFound();

  const titles = await getSlugTitleMap();
  const html = renderNoteBody(note.body, titles);
  const edited = formatEdited(note.updated_at);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "14px 28px",
          borderBottom: "1px solid var(--card-border)",
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: "var(--font-body)",
            fontStyle: "italic",
            fontSize: 19,
            color: "var(--text)",
            textDecoration: "none",
          }}
        >
          Papert Lab wiki
        </a>
        <a
          href="https://papertlab.org"
          target="_blank"
          rel="noopener"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            textDecoration: "none",
          }}
        >
          Papert Lab
        </a>
      </header>

      <article
        style={{
          maxWidth: 640,
          width: "100%",
          margin: "0 auto",
          padding: "40px 28px 88px",
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 28,
            fontWeight: 400,
            color: "var(--text)",
            margin: "0 0 8px",
            letterSpacing: "-0.01em",
          }}
        >
          {note.title || "Untitled note"}
        </h1>
        {edited && (
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              marginBottom: 22,
            }}
          >
            last edited {edited}
          </div>
        )}
        <div className="note-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  );
}
