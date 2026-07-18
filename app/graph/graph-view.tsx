"use client";

// A 3D "centers of gravity" map of the discussion, built on vasturiano's 3d-force-graph
// (https://github.com/vasturiano/3d-force-graph). Concept hubs are the massive nodes; each
// thought orbits the concept(s) it discusses, so the force layout falls into gravitational
// clusters. The heaviest node is whatever the group discussed most.
//
// 3d-force-graph is WebGL/`window`-bound, so it's imported dynamically inside an effect (never
// during SSR) and torn down on unmount. This component owns only rendering + interaction; the
// graph itself comes from lib/thought-graph (pure, testable).

import { useEffect, useMemo, useRef, useState } from "react";
import { buildThoughtGraph, type GraphNode } from "@/lib/thought-graph";
import type { Thought } from "@/app/discussion/session-view";

// 3d-force-graph's default export is a factory; we only need a loose handle to it here.
type ForceGraphInstance = {
  (el: HTMLElement): ForceGraphInstance;
  graphData: (d: unknown) => ForceGraphInstance;
  backgroundColor: (c: string) => ForceGraphInstance;
  showNavInfo: (b: boolean) => ForceGraphInstance;
  numDimensions: (n: number) => ForceGraphInstance;
  nodeVal: (fn: (n: GraphNode) => number) => ForceGraphInstance;
  nodeColor: (fn: (n: GraphNode) => string) => ForceGraphInstance;
  nodeLabel: (fn: (n: GraphNode) => string) => ForceGraphInstance;
  nodeThreeObject: (fn: (n: GraphNode) => unknown) => ForceGraphInstance;
  nodeThreeObjectExtend: (b: boolean) => ForceGraphInstance;
  nodeOpacity: (o: number) => ForceGraphInstance;
  nodeResolution: (r: number) => ForceGraphInstance;
  linkColor: (fn: (l: GraphLinkObj) => string) => ForceGraphInstance;
  linkWidth: (fn: (l: GraphLinkObj) => number) => ForceGraphInstance;
  linkOpacity: (o: number) => ForceGraphInstance;
  linkDirectionalParticles: (fn: (l: GraphLinkObj) => number) => ForceGraphInstance;
  linkDirectionalParticleWidth: (w: number) => ForceGraphInstance;
  linkDirectionalParticleSpeed: (s: number) => ForceGraphInstance;
  onNodeClick: (fn: (n: GraphNode) => void) => ForceGraphInstance;
  onBackgroundClick: (fn: () => void) => ForceGraphInstance;
  onEngineStop: (fn: () => void) => ForceGraphInstance;
  zoomToFit: (ms?: number, px?: number, nodeFilter?: (n: GraphNode) => boolean) => ForceGraphInstance;
  d3Force: (name: string) => { distance?: (fn: (l: GraphLinkObj) => number) => void; strength?: (v: number | ((n: GraphNode) => number)) => void } | undefined;
  d3VelocityDecay: (v: number) => ForceGraphInstance;
  cameraPosition: (pos: { x: number; y: number; z: number }, lookAt?: unknown, ms?: number) => ForceGraphInstance;
  width: (w: number) => ForceGraphInstance;
  height: (h: number) => ForceGraphInstance;
  scene: () => { add: (o: unknown) => void };
  _destructor?: () => void;
};

type GraphLinkObj = {
  kind: "orbit" | "reply";
  source: GraphNode | string;
  target: GraphNode | string;
};

// The three switchable looks. Node colors stay the site's accents (clay/brass/turtle…) in every
// theme; what changes is the background, links, text, and chrome — so the map can read as a cold
// "night sky", a warm "espresso" companion to the book, or a light "constellation on paper".
type ThemeKey = "dark" | "warm" | "light";
type Theme = {
  label: string;
  bg: string;
  link: string; // orbit link
  reply: string; // reply-thread link
  text: string; // primary label / body text
  textDim: string;
  textFaint: string;
  chromeBg: string; // legend / card / switcher panels
  chromeBorder: string;
  tooltipBg: string;
  tooltipText: string;
};
const THEMES: Record<ThemeKey, Theme> = {
  dark: {
    label: "Dark",
    bg: "#0f0d0b",
    link: "rgba(200,180,150,0.28)",
    reply: "#7a9b7a",
    text: "rgba(240,230,215,0.85)",
    textDim: "rgba(240,230,215,0.6)",
    textFaint: "rgba(240,230,215,0.4)",
    chromeBg: "rgba(20,16,12,0.78)",
    chromeBorder: "rgba(255,255,255,0.1)",
    tooltipBg: "rgba(20,16,12,0.92)",
    tooltipText: "#f3ece2",
  },
  warm: {
    label: "Warm",
    bg: "#221a15",
    link: "rgba(214,205,188,0.3)",
    reply: "#7a9b7a",
    text: "rgba(245,240,230,0.88)",
    textDim: "rgba(245,240,230,0.62)",
    textFaint: "rgba(245,240,230,0.42)",
    chromeBg: "rgba(34,26,21,0.82)",
    chromeBorder: "rgba(230,220,205,0.16)",
    tooltipBg: "rgba(34,26,21,0.94)",
    tooltipText: "#f5f0e6",
  },
  light: {
    label: "Light",
    bg: "#f1ead9",
    link: "rgba(92,58,30,0.24)",
    reply: "#4e6b54",
    text: "#3D3530",
    textDim: "#6B6358",
    textFaint: "#9B9488",
    chromeBg: "rgba(250,248,243,0.88)",
    chromeBorder: "rgba(61,38,21,0.16)",
    tooltipBg: "rgba(250,248,243,0.95)",
    tooltipText: "#3D3530",
  },
};
const THEME_ORDER: ThemeKey[] = ["dark", "warm", "light"];
const THEME_STORAGE_KEY = "papert-graph-theme";

export default function GraphView({
  thoughts,
  embedded = false,
  focusNodeId = null,
}: {
  thoughts: Thought[];
  embedded?: boolean;
  // When set (e.g. driven by /session playback), fly the camera to this node and open its detail.
  focusNodeId?: string | null;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphInstance | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const selectedIdRef = useRef<string | null>(null); // id of the glowing node (read by node accessor)
  const refreshHighlightRef = useRef<(() => void) | null>(null); // re-paints the glow on change
  const [cardHover, setCardHover] = useState(false); // reveal the card's concept badge on hover
  const [legendOpen, setLegendOpen] = useState(false); // right-side "centers of gravity" dropdown
  const [themeKey, setThemeKey] = useState<ThemeKey>("warm"); // dark | warm | light — see THEMES
  const theme = THEMES[themeKey];
  const [isNarrow, setIsNarrow] = useState(false); // phone-width: compact chrome so controls don't collide
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  // True while an external focus (playback) owns the camera, so a resize won't fight it.
  const focusActiveRef = useRef(false);
  useEffect(() => { focusActiveRef.current = !!focusNodeId; }, [focusNodeId]);
  // Keep the latest theme readable inside the (once-created) graph effect without recreating it.
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  // Restore the saved theme choice (client-only, after mount to avoid any hydration mismatch).
  useEffect(() => {
    try {
      const s = localStorage.getItem(THEME_STORAGE_KEY);
      if (s === "dark" || s === "warm" || s === "light") setThemeKey(s);
    } catch { /* ignore */ }
  }, []);
  const chooseTheme = (k: ThemeKey) => {
    setThemeKey(k);
    try { localStorage.setItem(THEME_STORAGE_KEY, k); } catch { /* ignore */ }
  };

  const data = useMemo(() => buildThoughtGraph(thoughts), [thoughts]);

  // Concept legend, biggest (most-discussed) first.
  const legend = useMemo(
    () =>
      data.nodes
        .filter((n) => n.kind === "concept")
        .map((n) => ({ ...n, mass: Math.round((n.val - 6) ** 0.5 / (1.6 ** 0.5)) }))
        .sort((a, b) => b.val - a.val),
    [data]
  );

  useEffect(() => {
    let disposed = false;
    const el = mountRef.current;
    if (!el) return;

    // Framing padding for zoomToFit. On the embedded panel we use a negative padding proportional
    // to the panel width: it zooms in past the bounding-sphere fit so the node cloud fills the
    // landscape panel's width (z-depth would otherwise leave large side margins), and scales with
    // the panel so it fills consistently whether the window is narrow or very wide.
    const fitPadding = () => {
      if (!embedded) return 60;
      const w = el.clientWidth;
      const h = el.clientHeight;
      // Portrait/phone panels: use a small POSITIVE padding so zoomToFit reliably frames every
      // node with a margin. (A negative "fill the width" padding over-zooms past the flat node
      // plane on real mobile Safari — whose viewport differs from desktop — and hides everything.)
      return h > w * 1.25 ? 12 : -Math.round(w * 0.15);
    };
    let didInitialFit = false;

    (async () => {
      const mod = await import("3d-force-graph");
      const THREE = await import("three");
      if (disposed || !el) return;
      const ForceGraph3D = mod.default as unknown as () => ForceGraphInstance;

      // On phones the panel is small & portrait; a flat (2D) layout has no z-depth, so nothing
      // projects on top of anything else (no "clumping") and the cloud fills the panel far better.
      const narrow = window.matchMedia("(max-width: 768px)").matches;

      // Per-node 3D extras: concept hubs carry their floating caption; the selected node also gets
      // a soft glow halo in its own colour.
      const nodeThreeAccessor = (n: GraphNode): import("three").Object3D | null => {
        const parts: import("three").Object3D[] = [];
        if (n.kind === "concept") {
          const sprite = makeTextSprite(THREE, n.label, n.color);
          // Lift the caption above the hub sphere; smaller lift on phones so labels don't inflate
          // the zoom-to-fit box (which would push the cloud down/small).
          sprite.position.set(0, Math.cbrt(n.val) * (narrow ? 2.4 : 4) + (narrow ? 3 : 6), 0);
          parts.push(sprite);
        }
        if (n.id === selectedIdRef.current) {
          parts.push(makeGlowSprite(THREE, n.color, Math.cbrt(n.val) * 6 + 9));
        }
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0];
        const group = new THREE.Group();
        parts.forEach((p) => group.add(p));
        return group;
      };

      const Graph = ForceGraph3D()(el)
        .showNavInfo(false) // hide the library's built-in controls line; we show our own hint
        .numDimensions(narrow ? 2 : 3)
        .width(el.clientWidth)
        .height(el.clientHeight)
        .nodeVal((n) => n.val)
        .nodeColor((n) => n.color)
        .nodeResolution(16)
        .nodeOpacity(0.92)
        // Concept hubs get a floating text caption; the selected node also gets a soft glow halo.
        .nodeThreeObjectExtend(true)
        .nodeThreeObject(nodeThreeAccessor)
        .linkWidth((l) => (l.kind === "reply" ? 0.8 : 0.4))
        .linkOpacity(0.5)
        .linkDirectionalParticles((l) => (l.kind === "reply" ? 2 : 0))
        .linkDirectionalParticleWidth(1.6)
        .linkDirectionalParticleSpeed(0.006)
        .onNodeClick((n) => {
          setSelected(n);
          moveCameraTo(graphRef.current, n, 900, narrow);
        })
        .onBackgroundClick(() => setSelected(null))
        // A final fit once the simulation fully cools (safety net; may be many seconds out).
        .onEngineStop(() => { if (!focusActiveRef.current) Graph.zoomToFit(600, fitPadding()); })
        .graphData(data);

      // Re-evaluate the node three-objects so the newly-selected node glows (and the previous one
      // stops). A fresh wrapper closure each call so kapsule always repaints.
      refreshHighlightRef.current = () => {
        graphRef.current?.nodeThreeObject((n) => nodeThreeAccessor(n));
      };

      // Paint the current theme (background/links/tooltips). Live theme switches are handled by a
      // separate effect below; here we set the initial look from the latest chosen theme.
      applyTheme(Graph, themeRef.current);

      // Physics: give the heavy concept hubs a strong pull and let thoughts settle into orbits.
      // Orbit links sit farther out than reply links so replies visibly bunch beside their parent.
      const linkForce = Graph.d3Force("link");
      linkForce?.distance?.((l: GraphLinkObj) => (l.kind === "reply" ? 14 : 46));
      const charge = Graph.d3Force("charge");
      // Concepts repel hard (spreading the centers of gravity apart); thoughts barely repel so
      // they cluster tightly around whichever concept holds them.
      charge?.strength?.((n: GraphNode) => (n.kind === "concept" ? -420 : -18));
      Graph.d3VelocityDecay(0.28);

      graphRef.current = Graph;

      // Frame the node cloud into the panel as the layout settles — the engine's own cooldown can
      // be many seconds, so we fit on a short schedule (skipping if playback owns the camera).
      const fit = () => { if (!disposed && graphRef.current && !focusActiveRef.current) { Graph.zoomToFit(600, fitPadding()); didInitialFit = true; } };
      const fitTimers = [setTimeout(fit, 1400), setTimeout(fit, 3000)];
      (Graph as unknown as { __fitTimers?: ReturnType<typeof setTimeout>[] }).__fitTimers = fitTimers;

      // Track the container's size (not just the window) so the canvas fits whether it's a
      // full page or the /session side panel. On resize, re-fit the node cloud to the new width
      // (unless playback currently owns the camera) so it always fills the panel with padding.
      let refitTimer: ReturnType<typeof setTimeout> | undefined;
      const ro = new ResizeObserver(() => {
        if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
        Graph.width(el.clientWidth).height(el.clientHeight);
        if (didInitialFit && !focusActiveRef.current) {
          clearTimeout(refitTimer);
          refitTimer = setTimeout(() => Graph.zoomToFit(400, fitPadding()), 120);
        }
      });
      ro.observe(el);
      (Graph as unknown as { __ro?: ResizeObserver }).__ro = ro;
    })();

    return () => {
      disposed = true;
      const g = graphRef.current as (ForceGraphInstance & { __ro?: ResizeObserver; __fitTimers?: ReturnType<typeof setTimeout>[] }) | null;
      g?.__fitTimers?.forEach(clearTimeout);
      g?.__ro?.disconnect();
      g?._destructor?.();
      graphRef.current = null;
      if (el) el.innerHTML = "";
    };
  }, [data]);

  // Playback / external focus: when focusNodeId changes, open that node's detail and fly to it.
  // The graph may still be mounting or the node not yet positioned by the simulation, so poll
  // briefly for a settled coordinate before moving the camera.
  useEffect(() => {
    if (!focusNodeId) return;
    const node = data.nodes.find((n) => n.id === focusNodeId);
    if (!node) return;
    setSelected(node);
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const go = () => {
      const g = graphRef.current;
      const positioned = (node as GraphNode & { x?: number }).x != null;
      if (g && positioned) {
        moveCameraTo(g, node, 1100, isNarrow);
        return;
      }
      if (tries++ < 45) timer = setTimeout(go, 120);
    };
    go();
    return () => clearTimeout(timer);
  }, [focusNodeId, data, isNarrow]);

  // Live theme switch: repaint the already-created graph's background/links/tooltips.
  useEffect(() => {
    if (graphRef.current) applyTheme(graphRef.current, theme);
  }, [theme]);

  // Glow the selected node; clears when nothing is selected.
  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
    refreshHighlightRef.current?.();
  }, [selected]);

  return (
    <div
      style={{
        position: "relative",
        height: embedded ? "100%" : "100dvh",
        width: "100%",
        overflow: "hidden",
        background: theme.bg,
        transition: "background 300ms ease",
        // Embedded in the /session panel it reads as an inset card, framed like the reading pane.
        borderRadius: embedded ? 12 : 0,
        border: embedded ? "1px solid var(--card-border)" : undefined,
      }}
    >
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      {/* Theme switcher — dark / warm / light, pinned top-left. */}
      <div
        style={{
          position: "absolute",
          top: embedded ? 12 : 20,
          left: embedded ? 12 : 24,
          zIndex: 6,
          display: "flex",
          gap: 2,
          padding: 3,
          background: theme.chromeBg,
          border: `1px solid ${theme.chromeBorder}`,
          borderRadius: 8,
          backdropFilter: "blur(6px)",
        }}
      >
        {THEME_ORDER.map((k) => {
          const active = k === themeKey;
          return (
            <button
              key={k}
              onClick={() => chooseTheme(k)}
              title={`${THEMES[k].label} theme`}
              aria-pressed={active}
              style={{
                font: `600 ${isNarrow ? 9.5 : 10.5}px/1 sans-serif`,
                letterSpacing: "0.03em",
                color: active ? theme.text : theme.textFaint,
                background: active ? "rgba(140,130,115,0.22)" : "none",
                border: "none",
                borderRadius: 6,
                padding: isNarrow ? "4px 6px" : "5px 9px",
                cursor: "pointer",
              }}
            >
              {/* On phones, single-letter labels keep the switcher small enough to clear the legend */}
              {isNarrow ? THEMES[k].label[0] : THEMES[k].label}
            </button>
          );
        })}
      </div>

      {/* Title + framing — dropped when embedded (the panel header already gives context) */}
      {!embedded && (
        <div style={{ position: "absolute", top: 64, left: 24, zIndex: 5, pointerEvents: "none", maxWidth: 360 }}>
          <div style={{ font: "600 11px/1 sans-serif", letterSpacing: "0.14em", textTransform: "uppercase", color: theme.textDim }}>
            Discussion III · Centers of Gravity
          </div>
          <div style={{ marginTop: 8, font: "13px/1.5 Georgia, serif", color: theme.textDim }}>
            Each concept is a mass; the more it was discussed, the heavier it pulls. Every thought
            orbits the concept(s) it touches.
          </div>
        </div>
      )}

      {/* Legend — concepts by mass. A collapsible dropdown pinned to the right, closed by default.
          Collapsed it shrinks to fit its label (so it clears the theme switcher on phones); open it
          takes a fixed comfortable width for the list. */}
      <div
        style={{
          position: "absolute",
          top: embedded ? 12 : 20,
          right: embedded ? 12 : 24,
          zIndex: 5,
          width: legendOpen ? 216 : "auto",
          maxWidth: "calc(100% - 24px)",
          background: theme.chromeBg,
          border: `1px solid ${theme.chromeBorder}`,
          borderRadius: 10,
          backdropFilter: "blur(6px)",
          overflow: "hidden",
        }}
      >
        {/* Header — always visible; toggles the list open/closed */}
        <button
          onClick={() => setLegendOpen((o) => !o)}
          aria-expanded={legendOpen}
          title={legendOpen ? "Hide centers of gravity" : "Show centers of gravity"}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "10px 12px",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          <span style={{ font: "600 10px/1 sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: theme.textDim, whiteSpace: "nowrap" }}>
            {isNarrow && !legendOpen ? "Gravity" : "Centers of gravity"}
          </span>
          {/* chevron rotates when open */}
          <span
            style={{
              font: "10px/1 sans-serif",
              color: theme.textFaint,
              transform: legendOpen ? "rotate(180deg)" : "none",
              transition: "transform 180ms ease",
            }}
          >
            ▾
          </span>
        </button>

        {legendOpen && (
          <div style={{ padding: "2px 12px 12px" }}>
            {legend.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, flexShrink: 0, boxShadow: `0 0 8px ${c.color}` }} />
                <span style={{ font: "12px/1.3 sans-serif", color: theme.text, flex: 1 }}>{c.label}</span>
                <span style={{ font: "11px/1 sans-serif", color: theme.textFaint }}>{c.mass}</span>
              </div>
            ))}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${theme.chromeBorder}`, font: "10.5px/1.4 sans-serif", color: theme.textFaint }}>
              Number = thoughts orbiting it
            </div>
          </div>
        )}
      </div>

      {/* Selected-node detail */}
      {selected && (
        <div
          onMouseEnter={() => setCardHover(true)}
          onMouseLeave={() => setCardHover(false)}
          style={{
            position: "absolute",
            bottom: 24,
            left: 24,
            right: embedded ? 24 : undefined,
            zIndex: 6,
            maxWidth: 400,
            background: theme.chromeBg,
            border: `1px solid ${theme.chromeBorder}`,
            borderRadius: 12,
            padding: "16px 18px",
            backdropFilter: "blur(8px)",
          }}
        >
          {selected.kind === "concept" ? (
            <>
              <div style={{ font: "600 15px/1.2 sans-serif", color: selected.color }}>{selected.label}</div>
              <div style={{ marginTop: 6, font: "12.5px/1.5 sans-serif", color: theme.textDim }}>
                A center of gravity for this session — the thicker its orbit, the more the group
                circled back to it.
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <span style={{ display: "inline-flex", alignItems: "baseline", gap: 7 }}>
                  <span style={{ font: "600 13px/1 sans-serif", color: selected.color }}>{selected.author}</span>
                  {selected.replyToAuthor && (
                    // Obvious "this is a reply" badge, in the same green as the reply links.
                    <span style={{ font: "600 9.5px/1 sans-serif", letterSpacing: "0.06em", textTransform: "uppercase", color: REPLY_GREEN, border: `1px solid ${REPLY_GREEN}`, borderRadius: 999, padding: "3px 7px" }}>
                      ↳ Reply
                    </span>
                  )}
                </span>
                <span style={{ font: "11px/1 sans-serif", color: theme.textFaint }}>{selected.timestamp?.slice(0, 10)}</span>
              </div>
              {selected.replyToAuthor && (
                // What this thought is replying to — parent author + a snippet of their thought.
                <div style={{ margin: "9px 0 0", padding: "6px 10px", borderLeft: `3px solid ${REPLY_GREEN}`, background: "rgba(122,155,122,0.1)", borderRadius: 4 }}>
                  <div style={{ font: "600 10px/1.3 sans-serif", letterSpacing: "0.05em", textTransform: "uppercase", color: REPLY_GREEN }}>
                    Replying to {selected.replyToAuthor}
                  </div>
                  <div style={{ marginTop: 3, font: "italic 12px/1.45 Georgia, serif", color: theme.textDim }}>
                    {truncate(selected.replyToText ?? "", 96)}
                  </div>
                </div>
              )}
              {selected.quote && (
                <div style={{ margin: "9px 0 0", padding: "6px 10px", borderLeft: "3px solid var(--clay)", font: "italic 12.5px/1.5 Georgia, serif", color: theme.textDim }}>
                  “{selected.quote}”
                </div>
              )}
              <div style={{ marginTop: 9, font: "14px/1.55 Georgia, serif", color: theme.text }}>{selected.text}</div>
              {/* Which center(s) of gravity this thought orbits — hidden by default, revealed (with a
                  fade) on hover. Each pill is filled in the concept's own colour so it clearly
                  matches the hub node it connects to. */}
              {selected.concepts && selected.concepts.length > 0 && (
                <div
                  style={{
                    overflow: "hidden",
                    maxHeight: cardHover ? 120 : 0,
                    marginTop: cardHover ? 11 : 0,
                    opacity: cardHover ? 1 : 0,
                    transition: "max-height 220ms ease, opacity 200ms ease, margin-top 220ms ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <span style={{ font: "600 9.5px/1 sans-serif", letterSpacing: "0.07em", textTransform: "uppercase", color: theme.textFaint }}>
                      Orbits
                    </span>
                    {selected.concepts.map((cid) => {
                      const c = legend.find((l) => l.id === cid);
                      if (!c) return null;
                      return (
                        <span
                          key={cid}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            font: "600 11px/1 sans-serif",
                            color: "#fdf9f2",
                            background: c.color,
                            borderRadius: 999,
                            padding: "4px 10px",
                          }}
                        >
                          {c.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          <button
            onClick={() => setSelected(null)}
            style={{ marginTop: 12, font: "11px/1 sans-serif", color: theme.textDim, background: "none", border: `1px solid ${theme.chromeBorder}`, borderRadius: 6, padding: "5px 11px", cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      )}

      {/* hint */}
      <div style={{ position: "absolute", bottom: 20, right: 24, zIndex: 5, font: "11px/1.5 sans-serif", color: theme.textFaint, pointerEvents: "none", textAlign: "right" }}>
        drag to orbit · scroll to zoom · click a node
      </div>
    </div>
  );
}

// Paint a theme onto a live graph instance: background, link colors, and hover tooltips (the
// only theme-dependent three.js/DOM bits; node sphere colors are the same accents in every theme).
function applyTheme(g: ForceGraphInstance, theme: Theme): void {
  g.backgroundColor(theme.bg)
    .linkColor((l) => (l.kind === "reply" ? theme.reply : theme.link))
    .nodeLabel((n) =>
      n.kind === "concept"
        ? `<div style="font:600 13px sans-serif;color:${n.color};padding:2px 4px">${n.label}</div>`
        : `<div style="max-width:240px;font:12px/1.45 sans-serif;color:${theme.tooltipText};background:${theme.tooltipBg};padding:7px 9px;border-radius:6px;border:1px solid ${theme.chromeBorder}"><b style="color:${n.color}">${n.author}</b><br/>${escapeHtml(n.label)}</div>`
    );
}

// Ease the camera to sit a little way out from a node, looking at it. Concepts are big, so we
// pull back farther for them than for a thought. No-op until the node has a settled position.
// `flat` = the mobile 2D layout, where every node lies in the z=0 plane: there we must keep the
// camera ABOVE the plane looking straight down, or scaling the (zero) z lands it coplanar with the
// nodes and the whole flat graph disappears edge-on.
function moveCameraTo(g: ForceGraphInstance | null, node: GraphNode, ms: number, flat: boolean): void {
  const n = node as GraphNode & { x?: number; y?: number; z?: number };
  if (!g || n.x == null) return;
  if (flat) {
    // In 2D the nodes have no z at all (undefined, not 0), so we must give the camera an explicit
    // look-at point with z:0 — passing the node would put NaN in its z and blank the view.
    const dist = node.kind === "concept" ? 190 : 120;
    g.cameraPosition({ x: n.x, y: n.y!, z: dist }, { x: n.x, y: n.y!, z: 0 }, ms);
    return;
  }
  const dist = node.kind === "concept" ? 150 : 80;
  const r = Math.hypot(n.x, n.y!, n.z!) || 1;
  g.cameraPosition(
    { x: n.x * (1 + dist / r), y: n.y! * (1 + dist / r), z: n.z! * (1 + dist / r) },
    node,
    ms
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

// Green used for reply links + the card's reply badge/banner (the --turtle token).
const REPLY_GREEN = "#7a9b7a";

// Parse a #rrggbb / #rgb hex to [r,g,b] (0–255). Falls back to warm grey on anything else.
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(int)) return [200, 180, 150];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

// A soft radial-gradient sprite in the node's colour, additively blended — a *slight* glow so the
// selected node reads as gently lit. `size` is its world-space diameter.
function makeGlowSprite(THREE: typeof import("three"), color: string, size: number): import("three").Sprite {
  const [r, g, b] = hexToRgb(color);
  const d = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = d;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
  // Gentle and tight: a soft core that fades to transparent well before the sprite edge, so the
  // glow hugs the node rather than spreading far out.
  grad.addColorStop(0, `rgba(${r},${g},${b},0.6)`);
  grad.addColorStop(0.3, `rgba(${r},${g},${b},0.22)`);
  grad.addColorStop(0.62, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, d, d);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size, 1);
  return sprite;
}

// Trim text to a legible snippet for the card's "replying to" banner.
function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n - 1).trimEnd() + "…" : clean;
}

// A cheap canvas-texture text sprite so concept hubs carry a legible 3D caption.
function makeTextSprite(
  THREE: typeof import("three"),
  text: string,
  color: string
): import("three").Sprite {
  const pad = 16;
  const font = 44;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `600 ${font}px sans-serif`;
  const w = ctx.measureText(text).width;
  canvas.width = w + pad * 2;
  canvas.height = font + pad * 2;
  const c2 = canvas.getContext("2d")!;
  c2.font = `600 ${font}px sans-serif`;
  c2.fillStyle = color;
  c2.textBaseline = "middle";
  c2.shadowColor = "rgba(0,0,0,0.85)";
  c2.shadowBlur = 8;
  c2.fillText(text, pad, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const scale = 0.16;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  return sprite;
}
