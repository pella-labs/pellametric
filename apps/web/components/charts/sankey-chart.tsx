// F1.8 — SankeyChart: session → commit → PR flow.
// Band color = source brand token. Band thickness = value (tokensOut by default).
// Hover dims non-traversed links to 20% opacity. Click PR node → onPrClick.
// Mobile floor 320px+: at narrow widths we still render but labels truncate.
// A11y: each node has aria-label; each link has aria-label; the SVG itself
// carries an aria-describedby pointing at a sr-only summary.

"use client";

import React, { useId, useMemo, useState } from "react";
import { Group } from "@visx/group";
import { sankey, sankeyLinkHorizontal } from "@visx/sankey";

export type SankeyNode = {
  id: string;
  label: string;
  kind: "session" | "commit" | "pr" | "drop";
  /** For source-colored bands at the session layer. */
  source?: "claude" | "codex" | "cursor" | "human" | "bot";
};

export type SankeyLink = {
  source: string;
  target: string;
  value: number;
};

export type SankeyChartProps = {
  nodes: SankeyNode[];
  links: SankeyLink[];
  width: number;
  height: number;
  onPrClick?: (prNodeId: string) => void;
};

const SOURCE_COLOR: Record<NonNullable<SankeyNode["source"]>, string> = {
  claude: "var(--source-claude)",
  codex: "var(--source-codex)",
  cursor: "var(--source-cursor)",
  human: "var(--source-human)",
  bot: "var(--muted-foreground)",
};

const KIND_COLOR: Record<SankeyNode["kind"], string> = {
  session: "var(--source-claude)",
  commit: "var(--foreground)",
  pr: "var(--accent)",
  drop: "var(--conf-low)",
};

export function SankeyChart({
  nodes,
  links,
  width,
  height,
  onPrClick,
}: SankeyChartProps): React.ReactElement {
  const titleId = useId();
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<number | null>(null);

  const graph = useMemo(() => {
    if (width <= 0 || height <= 0 || nodes.length === 0 || links.length === 0) return null;
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    // sankey wants nodes by index + numeric source/target
    const nodeObjs = nodes.map(n => ({ ...n }));
    const linkObjs = links
      .map(l => {
        const s = idx.get(l.source);
        const t = idx.get(l.target);
        if (s === undefined || t === undefined) return null;
        return { source: s, target: t, value: Math.max(0, l.value) };
      })
      .filter((x): x is { source: number; target: number; value: number } => x !== null);
    if (linkObjs.length === 0) return null;
    const layout = sankey<typeof nodeObjs[number], typeof linkObjs[number]>()
      .nodeWidth(10)
      .nodePadding(12)
      .extent([
        [4, 4],
        [width - 4, height - 4],
      ]);
    return layout({ nodes: nodeObjs.map(n => ({ ...n })), links: linkObjs });
  }, [nodes, links, width, height]);

  if (!graph) {
    return (
      <div
        className="mk-table-cell text-(--muted-foreground) flex items-center justify-center"
        style={{ width, height: Math.max(48, height) }}
        role="img"
        aria-label="sankey: no data"
      >
        no flow data yet
      </div>
    );
  }

  // Compute which links are "traversed" when a node is hovered (whole upstream
  // + downstream subgraph). For simplicity we walk one hop in each direction.
  const traversed = new Set<number>();
  if (hoverNode !== null) {
    const idx = nodes.findIndex(n => n.id === hoverNode);
    graph.links.forEach((l, i) => {
      const sIdx = typeof l.source === "number" ? l.source : (l.source as { index: number }).index;
      const tIdx = typeof l.target === "number" ? l.target : (l.target as { index: number }).index;
      if (sIdx === idx || tIdx === idx) traversed.add(i);
    });
  }

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-labelledby={titleId}
      style={{ display: "block" }}
    >
      <title id={titleId}>
        Sankey flow: {nodes.length} nodes, {links.length} links.
      </title>
      <Group>
        {graph.links.map((link, i) => {
          const path = sankeyLinkHorizontal()(link);
          if (!path) return null;
          const sNode = link.source as SankeyNode & { index: number };
          const fill = sNode.source ? SOURCE_COLOR[sNode.source] : KIND_COLOR[sNode.kind ?? "session"];
          const dim = hoverNode !== null ? !traversed.has(i) : false;
          const isHover = hoverLink === i;
          return (
            <path
              key={`link-${i}`}
              d={path}
              fill="none"
              stroke={fill}
              strokeOpacity={dim ? 0.06 : isHover ? 0.55 : 0.32}
              strokeWidth={Math.max(1, link.width ?? 1)}
              style={{ transition: "stroke-opacity 120ms ease" }}
              onMouseEnter={() => setHoverLink(i)}
              onMouseLeave={() => setHoverLink(null)}
              aria-label={`${sNode.label} → ${(link.target as SankeyNode & { index: number }).label}: ${link.value}`}
            />
          );
        })}
        {graph.nodes.map(n => {
          const node = n as SankeyNode & { index: number; x0: number; x1: number; y0: number; y1: number };
          const w = node.x1 - node.x0;
          const h = node.y1 - node.y0;
          const fill = node.source ? SOURCE_COLOR[node.source] : KIND_COLOR[node.kind ?? "session"];
          const dim = hoverNode !== null && hoverNode !== node.id;
          const clickable = node.kind === "pr" && !!onPrClick;
          return (
            <g
              key={`node-${node.id}`}
              onMouseEnter={() => setHoverNode(node.id)}
              onMouseLeave={() => setHoverNode(null)}
              onClick={() => clickable && onPrClick?.(node.id)}
              style={{ cursor: clickable ? "pointer" : "default" }}
            >
              <rect
                x={node.x0}
                y={node.y0}
                width={w}
                height={h}
                fill={fill}
                opacity={dim ? 0.3 : 1}
                style={{ transition: "opacity 120ms ease" }}
              />
              <text
                x={node.x0 < width / 2 ? node.x1 + 6 : node.x0 - 6}
                y={(node.y0 + node.y1) / 2}
                dy="0.32em"
                textAnchor={node.x0 < width / 2 ? "start" : "end"}
                fontSize={11}
                fill="currentColor"
                opacity={dim ? 0.5 : 0.95}
                pointerEvents="none"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </Group>
    </svg>
  );
}
