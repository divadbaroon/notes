// A reading-group discussion, addressed by its date slug: /discussion/<date> loads the essay
// (content/tools-for-thought.md) plus that date's seed thoughts (content/session-<date>-thoughts.json)
// off disk on the server, then hands them to the client SessionView (two-pane reader + thought
// stream / 3D concept map). Only dates that have a thoughts file are valid — e.g. /discussion/7-11-26;
// any other slug 404s (dynamicParams = false + generateStaticParams below).

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import SessionView, { type Thought } from "../session-view";

export const dynamicParams = false; // only the dates enumerated below exist; others → 404

const CONTENT_DIR = path.join(process.cwd(), "content");

// One static route per session-<date>-thoughts.json file present in /content.
export async function generateStaticParams(): Promise<{ date: string }[]> {
  const files = await readdir(CONTENT_DIR);
  return files
    .map((f) => /^session-(.+)-thoughts\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ date: m[1] }));
}

async function loadContent(date: string): Promise<{ essay: string; thoughts: Thought[] }> {
  const essay = await readFile(path.join(CONTENT_DIR, "tools-for-thought.md"), "utf8");
  let raw: string;
  try {
    raw = await readFile(path.join(CONTENT_DIR, `session-${date}-thoughts.json`), "utf8");
  } catch {
    notFound(); // no thoughts file for this date
  }
  return { essay, thoughts: JSON.parse(raw!) as Thought[] };
}

export default async function SessionDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const { essay, thoughts } = await loadContent(date);
  return <SessionView essay={essay} fileThoughts={thoughts} />;
}
