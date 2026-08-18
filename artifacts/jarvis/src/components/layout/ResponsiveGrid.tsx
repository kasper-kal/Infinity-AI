/**
 * ResponsiveGrid Component — Liquid Glass Design System
 * Flexible responsive grid layout with container queries support
 */

import React, { useMemo, ReactNode } from "react";
import "./ResponsiveGrid.css";

export interface ResponsiveGridProps {
  /** Grid children */
  children: ReactNode;
  /** Number of columns at each breakpoint */
  columns?: {
    base?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    "2xl"?: number;
  };
  /** Gap between items */
  gap?: number | string;
  /** Row gap (override gap) */
  rowGap?: number | string;
  /** Column gap (override gap) */
  colGap?: number | string;
  /** Minimum column width */
  minColumnWidth?: number | string;
  /** Maximum column width */
  maxColumnWidth?: number | string;
  /** Auto-fit columns (fill space) */
  autoFit?: boolean;
  /** Auto-fill columns (allow empty) */
  autoFill?: boolean;
  /** Dense packing */
  dense?: boolean;
  /** Grid template areas */
  templateAreas?: string;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
  /** As component */
  as?: React.ElementType;
}

export const ResponsiveGrid: React.FC<ResponsiveGridProps> = ({
  children,
  columns = {},
  gap = "var(--space-4)",
  rowGap,
  colGap,
  minColumnWidth,
  maxColumnWidth,
  autoFit = false,
  autoFill = false,
  dense = false,
  templateAreas,
  className = "",
  style,
  as: Component = "div",
}) => {
  const gridStyles = useMemo(() => {
    const styles: React.CSSProperties = {};

    // Base gap
    styles.gap = typeof gap === "number" ? `${gap}px` : gap;
    if (rowGap) styles.rowGap = typeof rowGap === "number" ? `${rowGap}px` : rowGap;
    if (colGap) styles.columnGap = typeof colGap === "number" ? `${colGap}px` : colGap;

    // Template areas
    if (templateAreas) {
      styles.gridTemplateAreas = templateAreas;
    }

    // Dense packing
    if (dense) {
      styles.gridAutoFlow = "dense";
    }

    // Responsive columns using CSS custom properties
    // These are applied via CSS classes, but we can set inline for dynamic values
    const breakpoints = [
      { key: "base", min: 0 },
      { key: "sm", min: 640 },
      { key: "md", min: 768 },
      { key: "lg", min: 1024 },
      { key: "xl", min: 1280 },
      { key: "2xl", min: 1536 },
    ];

    // Build column definitions for each breakpoint
    // This is a simplified approach - in production you'd use container queries or CSS classes
    let lastCols = columns.base || 1;
    const mediaQueries: string[] = [];

    breakpoints.forEach((bp, i) => {
      const cols = columns[bp.key as keyof typeof columns] ?? lastCols;
      if (cols !== lastCols || i === 0) {
        const minWidth = minColumnWidth || "0";
        const maxWidth = maxColumnWidth || "1fr";

        let trackList: string;
        if (autoFit) {
          trackList = `repeat(auto-fit, minmax(${minWidth}, ${maxWidth}))`;
        } else if (autoFill) {
          trackList = `repeat(auto-fill, minmax(${minWidth}, ${maxWidth}))`;
        } else {
          trackList = `repeat(${cols}, 1fr)`;
        }

        if (i === 0) {
          styles.gridTemplateColumns = trackList;
        } else {
          mediaQueries.push(`@media (min-width: ${bp.min}px) { grid-template-columns: ${trackList}; }`);
        }
        lastCols = cols;
      }
    });

    // Store media queries for CSS-in-JS injection (simplified)
    if (mediaQueries.length > 0) {
      (styles as any).__mediaQueries = mediaQueries.join(" ");
    }

    return styles;
  }, [columns, gap, rowGap, colGap, minColumnWidth, maxColumnWidth, autoFit, autoFill, dense, templateAreas]);

  const classNames = useMemo(() => [
    "responsive-grid",
    autoFit && "responsive-grid--auto-fit",
    autoFill && "responsive-grid--auto-fill",
    dense && "responsive-grid--dense",
    className,
  ].filter(Boolean).join(" "), [autoFit, autoFill, dense, className]);

  return (
    <Component
      className={classNames}
      style={{ ...gridStyles, ...style }}
      role="list"
    >
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child;
        return React.cloneElement(child as React.ReactElement<any>, {
          "data-grid-index": index,
        });
      })}
    </Component>
  );
};

/** Grid Item - for explicit placement */
export interface GridItemProps {
  children: ReactNode;
  /** Column start / span */
  colStart?: number | "auto";
  colEnd?: number | "auto" | "span";
  colSpan?: number;
  /** Row start / span */
  rowStart?: number | "auto";
  rowEnd?: number | "auto" | "span";
  rowSpan?: number;
  /** Grid area name */
  area?: string;
  /** Alignment */
  alignSelf?: "start" | "center" | "end" | "stretch";
  justifySelf?: "start" | "center" | "end" | "stretch";
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
  as?: React.ElementType;
}

export const GridItem: React.FC<GridItemProps> = ({
  children,
  colStart,
  colEnd,
  colSpan,
  rowStart,
  rowEnd,
  rowSpan,
  area,
  alignSelf,
  justifySelf,
  className = "",
  style,
  as: Component = "div",
}) => {
  const itemStyles = useMemo(() => {
    const styles: React.CSSProperties = { ...style };

    if (area) styles.gridArea = area;
    if (colStart !== undefined) styles.gridColumnStart = colStart === "auto" ? "auto" : colStart;
    if (colEnd !== undefined) styles.gridColumnEnd = colEnd === "auto" ? "auto" : colEnd === "span" ? `span ${colSpan || 1}` : colEnd;
    else if (colSpan !== undefined) styles.gridColumnEnd = `span ${colSpan}`;
    if (rowStart !== undefined) styles.gridRowStart = rowStart === "auto" ? "auto" : rowStart;
    if (rowEnd !== undefined) styles.gridRowEnd = rowEnd === "auto" ? "auto" : rowEnd === "span" ? `span ${rowSpan || 1}` : rowEnd;
    else if (rowSpan !== undefined) styles.gridRowEnd = `span ${rowSpan}`;
    if (alignSelf) styles.alignSelf = alignSelf;
    if (justifySelf) styles.justifySelf = justifySelf;

    return styles;
  }, [colStart, colEnd, colSpan, rowStart, rowEnd, rowSpan, area, alignSelf, justifySelf, style]);

  return (
    <Component
      className={`grid-item ${className}`}
      style={itemStyles}
      role="listitem"
    >
      {children}
    </Component>
  );
};

/** Masonry Grid - Pinterest-style layout */
export interface MasonryGridProps {
  children: ReactNode;
  /** Number of columns */
  columns?: number | { base: number; sm: number; md: number; lg: number; xl: number; "2xl": number };
  /** Gap between items */
  gap?: number | string;
  /** Column width (for auto columns) */
  columnWidth?: number | string;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
}

export const MasonryGrid: React.FC<MasonryGridProps> = ({
  children,
  columns = 3,
  gap = "var(--space-4)",
  columnWidth,
  className = "",
  style,
}) => {
  // Masonry is typically done with CSS columns or JS layout
  // Using CSS columns for simplicity (no JS layout calculations)
  const columnCount = typeof columns === "number" ? columns : columns.lg || 3;

  const gridStyles = useMemo(() => ({
    ...style,
    columnCount,
    columnGap: typeof gap === "number" ? `${gap}px` : gap,
    ...(columnWidth && { columnWidth: typeof columnWidth === "number" ? `${columnWidth}px` : columnWidth }),
  }), [columnCount, gap, columnWidth, style]);

  return (
    <div
      className={`masonry-grid ${className}`}
      style={gridStyles}
      role="list"
    >
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child;
        return React.cloneElement(child as React.ReactElement<any>, {
          style: {
            ...((child.props as any).style || {}),
            breakInside: "avoid",
            marginBottom: typeof gap === "number" ? `${gap}px` : gap,
            display: "inline-block",
            width: "100%",
          } as React.CSSProperties,
          "data-masonry-index": index,
        });
      })}
    </div>
  );
};

/** Masonry Grid Item */
export interface MasonryGridItemProps {
  children: ReactNode;
  /** Span multiple columns */
  colSpan?: number;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
}

export const MasonryGridItem: React.FC<MasonryGridItemProps> = ({
  children,
  colSpan = 1,
  className = "",
  style,
}) => {
  // CSS columns don't support col-span natively
  // This would need JS layout for true masonry with spanning
  return (
    <div
      className={`masonry-grid-item ${className}`}
      style={{
        ...style,
        ...(colSpan > 1 && { columnSpan: String(colSpan) }), // Not widely supported
      } as React.CSSProperties}
      role="listitem"
    >
      {children}
    </div>
  );
};

/** Flex Grid - Flexbox-based grid for simpler layouts */
export interface FlexGridProps {
  children: ReactNode;
  /** Items per row at each breakpoint */
  itemsPerRow?: {
    base?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    "2xl"?: number;
  };
  /** Gap */
  gap?: number | string;
  /** Row gap */
  rowGap?: number | string;
  /** Column gap */
  colGap?: number | string;
  /** Alignment */
  alignItems?: "stretch" | "flex-start" | "center" | "flex-end" | "baseline";
  justifyContent?: "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly";
  /** Flex wrap */
  wrap?: boolean;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
}

export const FlexGrid: React.FC<FlexGridProps> = ({
  children,
  itemsPerRow = {},
  gap = "var(--space-4)",
  rowGap,
  colGap,
  alignItems = "stretch",
  justifyContent = "flex-start",
  wrap = true,
  className = "",
  style,
}) => {
  const gridStyles = useMemo(() => ({
    ...style,
    display: "flex",
    flexWrap: wrap ? "wrap" : "nowrap",
    alignItems,
    justifyContent,
    gap: typeof gap === "number" ? `${gap}px` : gap,
    rowGap: rowGap ? (typeof rowGap === "number" ? `${rowGap}px` : rowGap) : undefined,
    columnGap: colGap ? (typeof colGap === "number" ? `${colGap}px` : colGap) : undefined,
  }), [gap, rowGap, colGap, alignItems, justifyContent, wrap, style]);

  // Calculate item basis from itemsPerRow
  const itemStyles = useMemo(() => {
    const baseItems = itemsPerRow.base || 1;
    const basis = `calc(100% / ${baseItems} - ${typeof gap === "number" ? gap : "var(--space-4)"} * (${baseItems} - 1) / ${baseItems})`;

    // Media queries would be handled via CSS classes in production
    return { flex: `0 0 ${basis}`, minWidth: 0 };
  }, [itemsPerRow, gap]);

  return (
    <div className={`flex-grid ${className}`} style={gridStyles} role="list">
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child;
        return React.cloneElement(child as React.ReactElement<any>, {
          style: { ...itemStyles, ...((child.props as any).style || {}) },
          "data-flex-index": index,
        });
      })}
    </div>
  );
};

/** Container Query Grid - uses CSS container queries for true responsive behavior */
export interface ContainerQueryGridProps {
  children: ReactNode;
  /** Container name */
  containerName?: string;
  /** Grid template columns per container size */
  columns?: Record<string, string>;
  /** Gap */
  gap?: number | string;
  /** Class name */
  className?: string;
  /** Style */
  style?: React.CSSProperties;
}

export const ContainerQueryGrid: React.FC<ContainerQueryGridProps> = ({
  children,
  containerName = "grid-container",
  columns = {},
  gap = "var(--space-4)",
  className = "",
  style,
}) => {
  const gridStyles = useMemo(() => ({
    ...style,
    containerName,
    containerType: "inline-size",
    display: "grid",
    gap: typeof gap === "number" ? `${gap}px` : gap,
    gridTemplateColumns: columns.base || "repeat(auto-fit, minmax(250px, 1fr))",
  }), [containerName, columns, gap, style]);

  // Build container query styles
  // In production, these would be in a stylesheet or CSS-in-JS
  const containerQueries = Object.entries(columns)
    .filter(([key]) => key !== "base")
    .map(([size, template]) => `@container ${containerName} (min-width: ${size}) { grid-template-columns: ${template}; }`)
    .join(" ");

  return (
    <div
      className={`container-query-grid ${className}`}
      style={gridStyles}
      role="list"
      data-container-queries={containerQueries}
    >
      {children}
    </div>
  );
};