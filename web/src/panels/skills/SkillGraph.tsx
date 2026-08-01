// Force-directed skill graph (PLAN.md §8 item 8). d3-force supplies the
// physics simulation only (positions each tick); d3-zoom supplies the
// pan/zoom transform math only. React owns the actual DOM — nodes/edges are
// plain SVG elements rendered from state, never touched directly by d3
// selections (per PLAN.md §2's own guidance for this panel). Node drag is
// hand-rolled via React pointer events (not d3-drag, which isn't in the
// sanctioned dependency list) and *pins* the node (leaves `fx`/`fy` set)
// once released, per the item's "drag pinning" instruction.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import { select } from 'd3-selection';
import type { SkillEdge, SkillNode } from '@agent-dashboard/shared';
import { colorForCategory } from './colorForCategory';

export interface SkillGraphProps {
  nodes: SkillNode[];
  edges: SkillEdge[];
  selectedId: string | null;
  onSelectNode: (id: string) => void;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  category: string;
}

type SimLink = SimulationLinkDatum<SimNode>;

const WIDTH = 900;
const HEIGHT = 560;
const CLICK_MOVE_THRESHOLD = 4;

export function SkillGraph({ nodes, edges, selectedId, onSelectNode }: SkillGraphProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const [tickNodes, setTickNodes] = useState<SimNode[]>([]);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);

  // (Re)build the simulation whenever the node/edge set changes, preserving
  // any prior position/pin (fx/fy) for nodes that already existed.
  useEffect(() => {
    const prevById = new Map(simNodesRef.current.map((n) => [n.id, n]));
    const simNodes: SimNode[] = nodes.map((n, i) => {
      const prev = prevById.get(n.id);
      if (prev) {
        return { ...prev, label: n.label, category: n.category };
      }
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
      return {
        id: n.id,
        label: n.label,
        category: n.category,
        x: WIDTH / 2 + Math.cos(angle) * 120,
        y: HEIGHT / 2 + Math.sin(angle) * 120,
      };
    });
    const idSet = new Set(simNodes.map((n) => n.id));
    const simLinks: SimLink[] = edges
      .filter((e) => idSet.has(e.from) && idSet.has(e.to))
      .map((e) => ({ source: e.from, target: e.to }));

    simNodesRef.current = simNodes;

    const sim = forceSimulation(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(90)
          .strength(0.6),
      )
      .force('charge', forceManyBody().strength(-260))
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collide', forceCollide(30));

    // Clamp to the viewBox on every tick — forceCenter only pulls the graph's *average*
    // position back to center, individual nodes can still drift outside the visible viewBox
    // under strong charge repulsion otherwise (found via live browser testing, not visible from
    // reading the force config alone).
    const PADDING = 24;
    sim.on('tick', () => {
      for (const n of simNodesRef.current) {
        if (n.x !== undefined) n.x = Math.max(PADDING, Math.min(WIDTH - PADDING, n.x));
        if (n.y !== undefined) n.y = Math.max(PADDING, Math.min(HEIGHT - PADDING, n.y));
      }
      setTickNodes([...simNodesRef.current]);
    });
    simRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [nodes, edges]);

  // d3-zoom: pan/zoom transform math only, applied to a React-rendered <g> via `transform` state.
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const selection = select(svgEl);
    const behavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => setTransform(event.transform));
    selection.call(behavior);
    return () => {
      selection.on('.zoom', null);
    };
  }, []);

  const linksForRender = useMemo(() => {
    const byId = new Map(tickNodes.map((n) => [n.id, n]));
    return edges
      .map((e) => ({ edge: e, from: byId.get(e.from), to: byId.get(e.to) }))
      .filter((l): l is { edge: SkillEdge; from: SimNode; to: SimNode } => Boolean(l.from && l.to));
  }, [edges, tickNodes]);

  function toGraphCoords(clientX: number, clientY: number): { x: number; y: number } {
    const svgEl = svgRef.current;
    if (!svgEl) return { x: 0, y: 0 };
    const rect = svgEl.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * WIDTH;
    const sy = ((clientY - rect.top) / rect.height) * HEIGHT;
    return { x: (sx - transform.x) / transform.k, y: (sy - transform.y) / transform.k };
  }

  function handlePointerDown(event: React.PointerEvent<SVGGElement>, node: SimNode) {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragRef.current = {
      id: node.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
    simRef.current?.alphaTarget(0.3).restart();
  }

  function handlePointerMove(event: React.PointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) drag.moved = true;
    const target = simNodesRef.current.find((n) => n.id === drag.id);
    if (!target) return;
    const { x, y } = toGraphCoords(event.clientX, event.clientY);
    const PADDING = 24;
    target.fx = Math.max(PADDING, Math.min(WIDTH - PADDING, x));
    target.fy = Math.max(PADDING, Math.min(HEIGHT - PADDING, y));
  }

  function handlePointerUp(event: React.PointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    simRef.current?.alphaTarget(0);
    // Pinned: fx/fy stay set (PLAN.md §8 item 8's "drag pinning"), so the
    // node stays put after the simulation cools down.
    if (!drag.moved) onSelectNode(drag.id);
    dragRef.current = null;
  }

  return (
    <svg
      ref={svgRef}
      className="skill-graph"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Skill graph"
    >
      <g transform={transform.toString()}>
        <g className="skill-graph__edges">
          {linksForRender.map(({ edge, from, to }) => (
            <line
              key={`${edge.from}->${edge.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className="skill-graph__edge"
            />
          ))}
        </g>
        <g className="skill-graph__nodes">
          {tickNodes.map((node) => (
            <g
              key={node.id}
              className={`skill-node${selectedId === node.id ? ' skill-node--selected' : ''}`}
              data-skill-id={node.id}
              transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}
              onPointerDown={(event) => handlePointerDown(event, node)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <circle r={16} fill={colorForCategory(node.category)} />
              <text className="skill-node__label" y={30} textAnchor="middle">
                {node.label}
              </text>
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}
