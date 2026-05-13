import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface CausalLink {
  step: number;
  description: string;
  type: string;
}

interface Props {
  chain: CausalLink[];
}

const TYPE_COLORS: Record<string, string> = {
  observation: '#3b82f6', // blue
  inference: '#a855f7', // purple
  conclusion: '#10b981', // green
};

const NODE_RADIUS = 22;
const ROW_HEIGHT = 90;
const PADDING = 40;

/**
 * D3-rendered vertical causality graph: each step is a circle node connected
 * by an arrow to the next, color-coded by step type. Hover reveals the full
 * description in a tooltip.
 */
export function CausalityGraph({ chain }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || chain.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth || 400;
    const height = chain.length * ROW_HEIGHT + PADDING;
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    svg.attr('width', width).attr('height', height);

    // Arrow marker for the connecting lines
    svg
      .append('defs')
      .append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 10)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#94a3b8');

    const cx = NODE_RADIUS + 20;

    // Connecting lines (drawn behind nodes)
    svg
      .selectAll('line.connector')
      .data(chain.slice(0, -1))
      .enter()
      .append('line')
      .attr('class', 'connector')
      .attr('x1', cx)
      .attr('x2', cx)
      .attr('y1', (_, i) => PADDING + i * ROW_HEIGHT + NODE_RADIUS + 4)
      .attr('y2', (_, i) => PADDING + (i + 1) * ROW_HEIGHT - NODE_RADIUS - 8)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3,3')
      .attr('marker-end', 'url(#arrowhead)');

    // Nodes
    const groups = svg
      .selectAll('g.node')
      .data(chain)
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', (_, i) => `translate(0, ${PADDING + i * ROW_HEIGHT})`);

    groups
      .append('circle')
      .attr('cx', cx)
      .attr('cy', 0)
      .attr('r', NODE_RADIUS)
      .attr('fill', (d) => TYPE_COLORS[d.type] ?? '#64748b')
      .attr('opacity', 0.85)
      .attr('stroke', (d) => TYPE_COLORS[d.type] ?? '#64748b')
      .attr('stroke-width', 2);

    groups
      .append('text')
      .attr('x', cx)
      .attr('y', 0)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', 14)
      .attr('font-weight', 'bold')
      .attr('fill', 'white')
      .text((d) => d.step);

    // Type label (uppercase, small) above the description
    groups
      .append('text')
      .attr('x', cx + NODE_RADIUS + 16)
      .attr('y', -12)
      .attr('font-size', 10)
      .attr('font-weight', '600')
      .attr('letter-spacing', '0.05em')
      .attr('fill', (d) => TYPE_COLORS[d.type] ?? '#64748b')
      .text((d) => d.type.toUpperCase());

    // Description (wraps via foreignObject so we get real text wrapping)
    groups
      .append('foreignObject')
      .attr('x', cx + NODE_RADIUS + 14)
      .attr('y', -2)
      .attr('width', width - cx - NODE_RADIUS - 30)
      .attr('height', ROW_HEIGHT - 20)
      .append('xhtml:div')
      .attr('style', 'font-size: 13px; color: rgb(15 23 42 / 0.9); line-height: 1.4;')
      .html((d) => escapeHtml(d.description));

    // Tooltip on node hover
    groups
      .on('mouseenter', function (event, d) {
        if (!tooltipRef.current) return;
        const tooltip = tooltipRef.current;
        tooltip.style.display = 'block';
        tooltip.style.left = `${event.pageX + 12}px`;
        tooltip.style.top = `${event.pageY - 12}px`;
        tooltip.textContent = `Step ${d.step} · ${d.type} · ${d.description}`;
      })
      .on('mouseleave', () => {
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      });
  }, [chain]);

  if (chain.length === 0) {
    return (
      <div className="border rounded-lg p-12 text-center text-muted-foreground bg-card text-sm">
        No causal chain produced
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card p-2 relative">
      <svg ref={svgRef} className="w-full" role="img" aria-label="Causal chain visualization" />
      <div
        ref={tooltipRef}
        className="fixed z-50 bg-popover text-popover-foreground text-xs px-2 py-1 rounded shadow-lg border border-border pointer-events-none max-w-xs"
        style={{ display: 'none' }}
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
