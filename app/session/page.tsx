// Reading-group session page. The essay (content/tools-for-thought.md) and the seed
// thoughts (content/session-3-thoughts.json) are read from disk here on the server, then
// handed to the client SessionView which owns all the interactivity (two-pane layout,
// localStorage thought stream, add/export/clear). Kept a thin server shell only because a
// client component can't read files off disk; everything the /local page does client-side,
// SessionView still does.

import { readFile } from "node:fs/promises";
import path from "node:path";
import SessionView, { type Thought } from "./session-view";

export const dynamic = "force-static";

async function loadContent(): Promise<{ essay: string; thoughts: Thought[] }> {
  const dir = path.join(process.cwd(), "content");
  const essay = await readFile(path.join(dir, "tools-for-thought.md"), "utf8");
  const raw = await readFile(path.join(dir, "session-3-thoughts.json"), "utf8");
  const thoughts = JSON.parse(raw) as Thought[];
  return { essay, thoughts };
}

export default async function SessionPage() {
  const { essay, thoughts } = await loadContent();
  return <SessionView essay={essay} fileThoughts={thoughts} />;
}
