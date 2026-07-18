// 3D "centers of gravity" view of the session's thoughts. The seed thoughts
// (content/session-3-thoughts.json) are read off disk here on the server and handed to the
// client GraphView, which owns all the WebGL / force-graph interactivity. Same seed data the
// /session reader uses, so the two views stay in sync.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Thought } from "@/app/session/session-view";
import GraphView from "./graph-view";

export const dynamic = "force-static";

async function loadThoughts(): Promise<Thought[]> {
  const file = path.join(process.cwd(), "content", "session-3-thoughts.json");
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as Thought[];
}

export default async function GraphPage() {
  const thoughts = await loadThoughts();
  return <GraphView thoughts={thoughts} />;
}
