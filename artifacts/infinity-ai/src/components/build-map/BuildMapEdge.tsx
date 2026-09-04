/**
 * BuildMapEdge Component
 * Renders edges (connections) between nodes in the visual build map
 */

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { BuildMapEdge, BuildMapEdgeType, BuildMapNode } from "@/hooks/useBuildMap";

const EDGE_TYPE_CONFIG: Record<BuildMapEdgeType, { color: string; dashArray: string; label: string; arrowHead: string }> = {
  "depends-on": { color: "stroke-brand-400", dashArray: "none", label: "Depends On", arrowHead: "triangle" },
  "data-flow": { color: "stroke-cyan-400", dashArray: "5,5", label: "Data Flow", arrowHead: "triangle" },
  "user-flow": { color: "stroke-green-400", dashArray: "10,5", label: "User Flow", arrowHead: "triangle" },
  "parent-child": { color: "stroke-purple-400", dashArray: "none", label: "Parent-Child", arrowHead: "none" },
  "related-to": { color: "stroke-gray-400", dashArray: "3,3", label: "Related", arrowHead: "none" },
  "blocks": { color: "stroke-red-400", dashArray: "none", label: "Blocks", arrowHead: "diamond" },
};

interface BuildMapEdgeProps {
  edge: BuildMapEdge;
  sourceNode: BuildMapNode | null;
  targetNode: BuildMapNode | null;
  selected: boolean;
  zoom: number;
  onSelect: (edge: BuildMapEdge) => void;
  showLabels?: boolean;
}

export const BuildMapEdge: React.FC<BuildMapEdgeProps> = ({
  edge,
  sourceNode,
  targetNode,
  selected,
  zoom,
  onSelect,
  showLabels = true,
}) => {
  const { t } = useI18n();

  const typeConfig = EDGE_TYPE_CONFIG[edge.type];

  // Calculate path if both nodes exist
  const pathData = useMemo(() => {
    if (!sourceNode || !targetNode || !sourceNode.position || !targetNode.position) {
      return null;
    }

    const sourceX = sourceNode.position.x + (sourceNode.position?.x ? 100 : 0); // Approximate center
    const sourceY = sourceNode.position.y + 50;
    const targetX = targetNode.position.x + (targetNode.position?.x ? 100 : 0);
    const targetY = targetNode.position.y + 50;

    // Calculate curve control points for smooth bezier
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Determine curve direction based on relative positions
    const curveOffset = Math.min(distance * 0.3, 100);

    let controlX1 = sourceX;
    let controlY1 = sourceY;
    let controlX2 = targetX;
    let controlY2 = targetY;

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal flow
      controlX1 = sourceX + curveOffset * (dx > 0 ? 1 : -1);
      controlX2 = targetX - curveOffset * (dx > 0 ? 1 : -1);
    } else {
      // Vertical flow
      controlY1 = sourceY + curveOffset * (dy > 0 ? 1 : -1);
      controlY2 = targetY - curveOffset * (dy > 0 ? 1 : -1);
    }

    // Arrowhead position (near target)
    const arrowOffset = 20;
    const arrowX = targetX - (dx / distance) * arrowOffset;
    const arrowY = targetY - (dy / distance) * arrowOffset;

    // Label position (midpoint)
    const labelX = (sourceX + targetX) / 2;
    const labelY = (sourceY + targetY) / 2;

    return {
      path: `M ${sourceX} ${sourceY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${targetX} ${targetY}`,
      arrowX,
      arrowY,
      arrowAngle: Math.atan2(targetY - controlY2, targetX - controlX2) * 180 / Math.PI,
      labelX,
      labelY,
    };
  }, [sourceNode, targetNode]);

  if (!pathData) return null;

  const strokeWidth = Math.max(1, Math.min(3, 2 * zoom));
  const isSelected = selected;
  const isHovered = false; // Could add hover state

  return (
    <g className={cn("cursor-pointer", isSelected && "filter drop-shadow(0 0 4px currentColor)")} onClick={(e) => { e.stopPropagation(); onSelect(edge); }}>
      {/* Edge path */}
      <path
        d={pathData.path}
        fill="none"
        stroke={isSelected ? "url(#brand-gradient)" : `var(--${typeConfig.color.replace("stroke-", "")})`}
        strokeWidth={strokeWidth}
        strokeDasharray={typeConfig.dashArray}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          "transition-all duration-150",
          isSelected && "stroke-brand-400 stroke-width-[3px]",
          !isSelected && "opacity-60 hover:opacity-100"
        )}
        style={{
          opacity: zoom < 0.3 ? 0.3 : 1,
        }}
      />

      {/* Arrowhead */}
      {typeConfig.arrowHead !== "none" && (
        <g transform={`translate(${pathData.arrowX}, ${pathData.arrowY}) rotate(${pathData.arrowAngle})`}>
          {typeConfig.arrowHead === "triangle" && (
            <polygon
              points="0,0 -8,-4 -8,4"
              fill={isSelected ? "var(--brand-400)" : `var(--${typeConfig.color.replace("stroke-", "")})`}
              className="transition-colors"
            />
          )}
          {typeConfig.arrowHead === "diamond" && (
            <polygon
              points="0,0 -6,-4 -12,0 -6,4"
              fill={isSelected ? "var(--brand-400)" : `var(--${typeConfig.color.replace("stroke-", "")})`}
              className="transition-colors"
            />
          )}
        </g>
      )}

      {/* Label */}
      {showLabels && edge.label && zoom > 0.5 && (
        <text
          x={pathData.labelX}
          y={pathData.labelY - 8}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={Math.max(8, Math.min(11, 10 * zoom))}
          fill="var(--muted-foreground)"
          className="pointer-events-none"
          style={{ fontFamily: "inherit" }}
        >
          {edge.label}
        </text>
      )}

      {/* Edge type label (small) */}
      {showLabels && !edge.label && zoom > 0.7 && (
        <text
          x={pathData.labelX}
          y={pathData.labelY - 8}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={Math.max(7, Math.min(9, 8 * zoom))}
          fill="var(--muted-foreground)"
          className="pointer-events-none"
          style={{ fontFamily: "inherit", opacity: 0.6 }}
        >
          {t(`buildMap.edgeTypes.${edge.type}`)}
        </text>
      )}
    </g>
  );
};

/**
 * BuildMapEdges - Renders all edges efficiently
 */
interface BuildMapEdgesProps {
  edges: BuildMapEdge[];
  nodes: BuildMapNode[];
  selectedEdgeId: string | null;
  zoom: number;
  onEdgeSelect: (edge: BuildMapEdge) => void;
  showLabels?: boolean;
}

export const BuildMapEdges: React.FC<BuildMapEdgesProps> = ({
  edges,
  nodes,
  selectedEdgeId,
  zoom,
  onEdgeSelect,
  showLabels = true,
}) => {
  const nodeMap = useMemo(() => {
    const map = new Map<string, BuildMapNode>();
    nodes.forEach(node => map.set(node.id, node));
    return map;
  }, [nodes]);

  // Filter edges at low zoom for performance
  const visibleEdges = edges.filter(() => zoom > 0.15);

  return (
    <g className="build-map-edges">
      {visibleEdges.map(edge => {
        const sourceNode = nodeMap.get(edge.source) || null;
        const targetNode = nodeMap.get(edge.target) || null;

        if (!sourceNode || !targetNode) return null;

        return (
          <BuildMapEdge
            key={edge.id}
            edge={edge}
            sourceNode={sourceNode}
            targetNode={targetNode}
            selected={selectedEdgeId === edge.id}
            zoom={zoom}
            onSelect={onEdgeSelect}
            showLabels={showLabels}
          />
        );
      })}
    </g>
  );
};

export default BuildMapEdge;