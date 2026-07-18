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
import type { Thought } from "@/app/session/session-view";

// 3d-force-graph's default export is a factory; we only need a loose handle to it here.
type ForceGraphInstance = {
  (el: HTMLElement): ForceGraphInstance;
  graphData: (d: unknown) => ForceGraphInstance;
  backgroundColor: (c: string) => ForceGraphInstance;
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

export default function GraphView({ thoughts, embedded = false }: { thoughts: Thought[]; embedded?: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphInstance | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);

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

    (async () => {
      const mod = await import("3d-force-graph");
      const THREE = await import("three");
      if (disposed || !el) return;
      const ForceGraph3D = mod.default as unknown as () => ForceGraphInstance;

      const Graph = ForceGraph3D()(el)
        .backgroundColor("#0f0d0b")
        .width(el.clientWidth)
        .height(el.clientHeight)
        .nodeVal((n) => n.val)
        .nodeColor((n) => n.color)
        .nodeResolution(16)
        .nodeOpacity(0.92)
        .nodeLabel((n) =>
          n.kind === "concept"
            ? `<div style="font:600 13px sans-serif;color:${n.color};padding:2px 4px">${n.label}</div>`
            : `<div style="max-width:240px;font:12px/1.45 sans-serif;color:#f3ece2;background:rgba(20,16,12,0.92);padding:7px 9px;border-radius:6px;border:1px solid rgba(255,255,255,0.12)"><b style="color:${n.color}">${n.author}</b><br/>${escapeHtml(n.label)}</div>`
        )
        // Concept hubs also get a floating text sprite so the centers of gravity are labeled in 3D.
        .nodeThreeObjectExtend(true)
        .nodeThreeObject((n) => {
          if (n.kind !== "concept") return null;
          const sprite = makeTextSprite(THREE, n.label, n.color);
          // lift the caption just above the (large) hub sphere
          sprite.position.set(0, Math.cbrt(n.val) * 4 + 6, 0);
          return sprite;
        })
        .linkColor((l) => (l.kind === "reply" ? "#7a9b7a" : "rgba(200,180,150,0.28)"))
        .linkWidth((l) => (l.kind === "reply" ? 0.8 : 0.4))
        .linkOpacity(0.5)
        .linkDirectionalParticles((l) => (l.kind === "reply" ? 2 : 0))
        .linkDirectionalParticleWidth(1.6)
        .linkDirectionalParticleSpeed(0.006)
        .onNodeClick((n) => {
          setSelected(n);
          // ease the camera toward the clicked node
          const g = graphRef.current;
          const node = n as GraphNode & { x?: number; y?: number; z?: number };
          if (g && node.x != null) {
            const dist = 90;
            const r = Math.hypot(node.x, node.y!, node.z!) || 1;
            g.cameraPosition(
              { x: node.x * (1 + dist / r), y: node.y! * (1 + dist / r), z: node.z! * (1 + dist / r) },
              node,
              900
            );
          }
        })
        .onBackgroundClick(() => setSelected(null))
        .graphData(data);

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

      // Track the container's size (not just the window) so the canvas fits whether it's a
      // full page or the /session side panel, and re-fits when the panel is toggled/resized.
      const ro = new ResizeObserver(() => {
        if (el.clientWidth > 0 && el.clientHeight > 0) Graph.width(el.clientWidth).height(el.clientHeight);
      });
      ro.observe(el);
      (Graph as unknown as { __ro?: ResizeObserver }).__ro = ro;
    })();

    return () => {
      disposed = true;
      const g = graphRef.current as (ForceGraphInstance & { __ro?: ResizeObserver }) | null;
      g?.__ro?.disconnect();
      g?._destructor?.();
      graphRef.current = null;
      if (el) el.innerHTML = "";
    };
  }, [data]);

  return (
    <div style={{ position: "relative", height: embedded ? "100%" : "100dvh", width: "100%", overflow: "hidden", background: "#0f0d0b" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      {/* Title + framing — dropped when embedded (the panel header already gives context) */}
      {!embedded && (
        <div style={{ position: "absolute", top: 20, left: 24, zIndex: 5, pointerEvents: "none", maxWidth: 360 }}>
          <div style={{ font: "600 11px/1 sans-serif", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(240,230,215,0.55)" }}>
            Discussion III · Centers of Gravity
          </div>
          <div style={{ marginTop: 8, font: "13px/1.5 Georgia, serif", color: "rgba(240,230,215,0.72)" }}>
            Each concept is a mass; the more it was discussed, the heavier it pulls. Every thought
            orbits the concept(s) it touches.
          </div>
        </div>
      )}

      {/* Legend — concepts by mass. Tucks to the top-left in the panel (no title there). */}
      <div
        style={{
          position: "absolute",
          top: embedded ? 12 : 20,
          ...(embedded ? { left: 12 } : { right: 24 }),
          zIndex: 5,
          background: "rgba(20,16,12,0.72)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10,
          padding: "12px 14px",
          backdropFilter: "blur(6px)",
          maxWidth: embedded ? 190 : 230,
        }}
      >
        <div style={{ font: "600 10px/1 sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(240,230,215,0.5)", marginBottom: 9 }}>
          Centers of gravity
        </div>
        {legend.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, flexShrink: 0, boxShadow: `0 0 8px ${c.color}` }} />
            <span style={{ font: "12px/1.3 sans-serif", color: "rgba(240,230,215,0.85)", flex: 1 }}>{c.label}</span>
            <span style={{ font: "11px/1 sans-serif", color: "rgba(240,230,215,0.45)" }}>{c.mass}</span>
          </div>
        ))}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", font: "10.5px/1.4 sans-serif", color: "rgba(240,230,215,0.4)" }}>
          Number = thoughts orbiting it
        </div>
      </div>

      {/* Selected-node detail */}
      {selected && (
        <div
          style={{
            position: "absolute",
            bottom: 24,
            left: 24,
            right: embedded ? 24 : undefined,
            zIndex: 6,
            maxWidth: 400,
            background: "rgba(20,16,12,0.86)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: "16px 18px",
            backdropFilter: "blur(8px)",
          }}
        >
          {selected.kind === "concept" ? (
            <>
              <div style={{ font: "600 15px/1.2 sans-serif", color: selected.color }}>{selected.label}</div>
              <div style={{ marginTop: 6, font: "12.5px/1.5 sans-serif", color: "rgba(240,230,215,0.7)" }}>
                A center of gravity for this session — the thicker its orbit, the more the group
                circled back to it.
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <span style={{ font: "600 13px/1 sans-serif", color: selected.color }}>{selected.author}</span>
                <span style={{ font: "11px/1 sans-serif", color: "rgba(240,230,215,0.4)" }}>{selected.timestamp?.slice(0, 10)}</span>
              </div>
              {selected.quote && (
                <div style={{ margin: "9px 0 0", padding: "6px 10px", borderLeft: "3px solid rgba(200,180,150,0.5)", font: "italic 12.5px/1.5 Georgia, serif", color: "rgba(240,230,215,0.6)" }}>
                  “{selected.quote}”
                </div>
              )}
              <div style={{ marginTop: 9, font: "14px/1.55 Georgia, serif", color: "rgba(240,230,215,0.9)" }}>{selected.text}</div>
              {selected.concepts && selected.concepts.length > 0 && (
                <div style={{ marginTop: 11, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {selected.concepts.map((cid) => {
                    const c = legend.find((l) => l.id === cid);
                    if (!c) return null;
                    return (
                      <span key={cid} style={{ font: "11px/1 sans-serif", color: c.color, border: `1px solid ${c.color}`, borderRadius: 999, padding: "3px 9px", opacity: 0.85 }}>
                        {c.label}
                      </span>
                    );
                  })}
                </div>
              )}
            </>
          )}
          <button
            onClick={() => setSelected(null)}
            style={{ marginTop: 12, font: "11px/1 sans-serif", color: "rgba(240,230,215,0.5)", background: "none", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, padding: "5px 11px", cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      )}

      {/* hint */}
      <div style={{ position: "absolute", bottom: 20, right: 24, zIndex: 5, font: "11px/1.5 sans-serif", color: "rgba(240,230,215,0.35)", pointerEvents: "none", textAlign: "right" }}>
        drag to orbit · scroll to zoom · click a node
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
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
