// Turns the flat thought stream (content/session-*-thoughts.json) into a graph of
// "centers of gravity": a handful of recurring concepts the discussion keeps returning to,
// each a massive hub node, with every thought orbiting the concept(s) it touches. The most
// discussed concept ends up the heaviest node (mass = how many thoughts pull on it), so the
// force-directed layout naturally sorts the conversation into gravitational clusters.
//
// Kept framework-free (no three.js, no React) so it can be unit-tested and reused; the
// client view (app/graph/graph-view.tsx) only handles rendering.

import type { Thought } from "@/app/discussion/session-view";

// A recurring concept the group orbits. `match` is the set of lowercase cues we scan each
// thought's text + quoted passage for; any hit links that thought to this concept.
export type Concept = {
  id: string;
  label: string;
  color: string;
  match: string[];
};

// The centers of gravity, drawn from what the July 11 session actually circled back to.
// Order is only cosmetic; mass is computed from how many thoughts land on each.
export const CONCEPTS: Concept[] = [
  {
    id: "children-learning",
    label: "Children & Learning",
    color: "#c2664a", // clay
    match: ["children", "child", "kids", "learn", "learning", "educat", "play", "mathland", "differential geometry", "toys"],
  },
  {
    id: "authentic-interest",
    label: "Authentic Interest",
    color: "#b8893f", // ochre
    match: ["interest", "authentic", "authenticity", "curiosity", "curious", "conviction", "self-actualization", "passion", "lived experience", "genuinely", "bs", "paycheck"],
  },
  {
    id: "purpose-goals",
    label: "Purpose & Goals",
    color: "#7a9b7a", // turtle green
    match: ["purpose", "goal", "objective", "criteri", "success", "intent", "aim", "why so important", "start with"],
  },
  {
    id: "domain-expertise",
    label: "Domain Expertise",
    color: "#5c8a9a", // slate blue
    match: ["expert", "expertise", "domain", "foundational", "knowledge", "know what", "what to include", "what needs"],
  },
  {
    id: "profit-vs-values",
    label: "Profit vs. Values",
    color: "#a0526d", // mulberry
    match: ["profit", "money", "commercial", "organization", "organisation", "society", "pull towards", "not being used"],
  },
  {
    id: "tools-environments",
    label: "Tools & Environments",
    color: "#8a6fb0", // violet
    match: ["tool", "environment", "medium", "floor", "ceiling", "park", "ride", "adapt", "mathematica"],
  },
  {
    id: "collaboration-people",
    label: "Collaboration & People",
    color: "#6f8fb0", // steel
    match: ["collaborat", "people", "educators", "users", "instructor", "community", "research lab", "connect", "wide range", "domain experts"],
  },
];

export type GraphNode = {
  id: string;
  kind: "concept" | "thought";
  label: string; // short label for hover / concept caption
  color: string;
  // Force-graph draws each node sized by this. Concepts scale with mass (thought count);
  // thoughts are a constant small size.
  val: number;
  // thought-only extras, surfaced in the detail panel
  author?: string;
  text?: string;
  quote?: string | null;
  timestamp?: string;
  concepts?: string[]; // concept ids this thought links to
  // Reply metadata (thought nodes only) — set when this thought replies to another in the set.
  parentId?: string | null;
  replyToAuthor?: string;
  replyToText?: string;
};

export type GraphLink = {
  source: string;
  target: string;
  kind: "orbit" | "reply"; // thought→concept vs. reply→parent thought
};

export type ThoughtGraph = {
  nodes: GraphNode[];
  links: GraphLink[];
};

const AUTHOR_COLORS: Record<string, string> = {
  David: "#3f6f9f",
  Moonwara: "#c0724a",
};
const AUTHOR_FALLBACK = "#8a8072";

function authorColor(author: string): string {
  return AUTHOR_COLORS[author] ?? AUTHOR_FALLBACK;
}

// Which concepts a single thought pulls on: scan its text and quoted passage for any concept's
// cues. A thought can land on several concepts at once (it then floats between those centers of
// gravity, which is exactly the reading we want).
export function conceptsForThought(t: Thought): string[] {
  const hay = `${t.text} ${t.quote ?? ""}`.toLowerCase();
  return CONCEPTS.filter((c) => c.match.some((m) => hay.includes(m))).map((c) => c.id);
}

// Trim a thought to a legible node caption.
function shortLabel(s: string, n = 46): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n - 1).trimEnd() + "…" : clean;
}

// Build the full graph. A top-level thought orbits each concept it touches (its centers of
// gravity); a reply instead hangs off the thought it answers — a chain of sub-thoughts off the
// original — so threads read as visible branches rather than each reply floating to a concept on
// its own. A thought that matched nothing is tethered to a neutral "Open threads" concept. Every
// thought (replies included) still counts toward concept mass, so the hub sizes are unchanged.
export function buildThoughtGraph(thoughts: Thought[]): ThoughtGraph {
  const orbitCount = new Map<string, number>(); // concept id → thoughts touching it (mass)
  const links: GraphLink[] = [];
  const thoughtNodes: GraphNode[] = [];
  const byId = new Map(thoughts.map((t) => [t.id, t]));

  const UNSORTED = "open-threads";
  let usedUnsorted = false;

  for (const t of thoughts) {
    let concepts = conceptsForThought(t);
    if (concepts.length === 0) {
      concepts = [UNSORTED];
      usedUnsorted = true;
    }
    // A reply is one whose parent is present in this set; it attaches to the parent, not concepts.
    const parent = t.parentId ? byId.get(t.parentId) ?? null : null;
    for (const c of concepts) {
      orbitCount.set(c, (orbitCount.get(c) ?? 0) + 1); // mass counts every thought
      if (!parent) links.push({ source: t.id, target: c, kind: "orbit" }); // only top-level orbits
    }
    if (parent) {
      links.push({ source: t.id, target: parent.id, kind: "reply" });
    }
    thoughtNodes.push({
      id: t.id,
      kind: "thought",
      label: shortLabel(t.text),
      color: authorColor(t.author),
      val: 1,
      author: t.author,
      text: t.text,
      quote: t.quote ?? null,
      timestamp: t.timestamp,
      concepts,
      parentId: parent ? parent.id : null,
      replyToAuthor: parent?.author,
      replyToText: parent?.text,
    });
  }

  // Concept hubs. Mass grows with the number of thoughts orbiting — the most-discussed concept
  // becomes the largest, heaviest node. Only emit concepts that actually attracted a thought.
  const conceptDefs = [...CONCEPTS];
  if (usedUnsorted) {
    conceptDefs.push({ id: UNSORTED, label: "Open Threads", color: "#9a9186", match: [] });
  }
  const conceptNodes: GraphNode[] = conceptDefs
    .filter((c) => (orbitCount.get(c.id) ?? 0) > 0)
    .map((c) => {
      const mass = orbitCount.get(c.id) ?? 0;
      return {
        id: c.id,
        kind: "concept" as const,
        label: c.label,
        color: c.color,
        // Area-ish scaling so a concept twice as discussed reads as clearly bigger without
        // swamping the thought nodes. Base 6 keeps even a single-thought concept legible.
        val: 6 + mass * mass * 1.6,
      };
    });

  return { nodes: [...conceptNodes, ...thoughtNodes], links };
}
