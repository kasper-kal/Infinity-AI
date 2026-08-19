/**
 * Table Component — Liquid Glass Design System
 */

import React, { forwardRef, useState, useMemo, ReactNode, CSSProperties } from "react";
import "./Table.css";

export interface Column<T> {
  key: string;
  header: string;
  accessor: (row: T) => ReactNode;
  width?: string | number;
  minWidth?: string | number;
  maxWidth?: string | number;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  renderHeader?: () => ReactNode;
  className?: string;
  style?: CSSProperties;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyAccessor: (row: T) => string;
  sortable?: boolean;
  defaultSortKey?: string;
  defaultSortDirection?: "asc" | "desc";
  onSort?: (key: string, direction: "asc" | "desc") => void;
  selectable?: boolean;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  striped?: boolean;
  hoverable?: boolean;
  bordered?: boolean;
  compact?: boolean;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
  style?: CSSProperties;
  renderRowActions?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string;
}

export type RowAction<T> = (row: T) => ReactNode;

export function Table<T>({
  columns,
  data,
  keyAccessor,
  sortable = false,
  defaultSortKey,
  defaultSortDirection = "asc",
  onSort,
  selectable = false,
  selectedKeys = [],
  onSelectionChange,
  striped = true,
  hoverable = true,
  bordered = false,
  compact = false,
  loading = false,
  emptyMessage = "No data",
  className = "",
  style,
  renderRowActions,
  rowClassName,
}: TableProps<T>) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(
    defaultSortKey ? { key: defaultSortKey, direction: defaultSortDirection } : null
  );

  const sortedData = useMemo(() => {
    if (!sortConfig || !sortable) return data;
    return [...data].sort((a, b) => {
      const column = columns.find((c) => c.key === sortConfig.key);
      if (!column || !column.sortable) return 0;
      const aVal = column.accessor(a);
      const bVal = column.accessor(b);
      const aStr = String(aVal);
      const bStr = String(bVal);
      const comparison = aStr.localeCompare(bStr, undefined, { numeric: true });
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });
  }, [data, sortConfig, columns, sortable]);

  const handleSort = (key: string) => {
    if (!sortable) return;
    const column = columns.find((c) => c.key === key);
    if (!column?.sortable) return;
    const direction = sortConfig?.key === key && sortConfig.direction === "asc" ? "desc" : "asc";
    setSortConfig({ key, direction });
    onSort?.(key, direction);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    if (checked) {
      onSelectionChange?.(sortedData.map(keyAccessor));
    } else {
      onSelectionChange?.([]);
    }
  };

  const handleSelectRow = (key: string, checked: boolean) => {
    if (checked) {
      onSelectionChange?.([...selectedKeys, key]);
    } else {
      onSelectionChange?.(selectedKeys.filter((k) => k !== key));
    }
  };

  const isSelected = (key: string) => selectedKeys.includes(key);
  const allSelected = data.length > 0 && data.every((row) => isSelected(keyAccessor(row)));

  const classNames = [
    "table-container",
    striped && "table--striped",
    hoverable && "table--hoverable",
    bordered && "table--bordered",
    compact && "table--compact",
    loading && "table--loading",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} style={style}>
      {loading && <div className="table__loading" aria-hidden="true" />}
      <div className="table__wrapper" role="region" aria-label="Data table" tabIndex={0}>
        <table className="table">
          <thead className="table__head">
            <tr className="table__row">
              {selectable && (
                <th className="table__cell table__cell--checkbox" scope="col" style={{ width: "48px" }}>
                  <input
                    type="checkbox"
                    className="table__checkbox"
                    checked={allSelected}
                    onChange={handleSelectAll}
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`table__cell table__header-cell ${column.className || ""} ${column.sortable ? "table__header--sortable" : ""}`}
                  scope="col"
                  style={{
                    width: column.width,
                    minWidth: column.minWidth,
                    maxWidth: column.maxWidth,
                    textAlign: column.align,
                    ...column.style,
                  }}
                  onClick={() => column.sortable && handleSort(column.key)}
                >
                  <div className="table__header-content">
                    {column.renderHeader ? column.renderHeader() : column.header}
                    {column.sortable && (
                      <span className="table__sort-icon" aria-hidden="true">
                        {sortConfig?.key === column.key ? (
                          sortConfig.direction === "asc" ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 15l-6-6-6 6" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          )
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                            <path d="M18 15l-6-6-6 6M6 9l6 6 6-6" />
                          </svg>
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
              {renderRowActions && (
                <th className="table__cell table__cell--actions" scope="col" style={{ width: "1%" }}>
                  <span className="table__header-content">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="table__body">
            {sortedData.length === 0 ? (
              <tr className="table__row table__row--empty">
                <td colSpan={columns.length + (selectable ? 1 : 0) + (renderRowActions ? 1 : 0)} className="table__empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedData.map((row) => {
                const rowKey = keyAccessor(row);
                return (
                  <tr
                    key={rowKey}
                    className={`table__row ${rowClassName?.(row) || ""} ${isSelected(rowKey) ? "table__row--selected" : ""}`}
                  >
                    {selectable && (
                      <td className="table__cell table__cell--checkbox">
                        <input
                          type="checkbox"
                          className="table__checkbox"
                          checked={isSelected(rowKey)}
                          onChange={(e) => handleSelectRow(rowKey, e.target.checked)}
                          aria-label={`Select row ${rowKey}`}
                        />
                      </td>
                    )}
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`table__cell ${column.className || ""}`}
                        style={{
                          textAlign: column.align,
                          ...column.style,
                        }}
                      >
                        {column.accessor(row)}
                      </td>
                    ))}
                    {renderRowActions && (
                      <td className="table__cell table__cell--actions">
                        <div className="table__actions">{renderRowActions(row)}</div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Virtualized Table for large datasets */
export interface VirtualizedTableProps<T> extends Omit<TableProps<T>, "hoverable" | "striped"> {
  rowHeight?: number;
  overscan?: number;
  containerHeight?: number;
}

export function VirtualizedTable<T>({
  columns,
  data,
  keyAccessor,
  sortable = false,
  defaultSortKey,
  defaultSortDirection = "asc",
  onSort,
  selectable = false,
  selectedKeys = [],
  onSelectionChange,
  bordered = false,
  compact = false,
  loading = false,
  emptyMessage = "No data",
  className = "",
  style,
  renderRowActions,
  rowClassName,
  rowHeight = 44,
  overscan = 5,
  containerHeight = 400,
}: VirtualizedTableProps<T>) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(
    defaultSortKey ? { key: defaultSortKey, direction: defaultSortDirection } : null
  );
  const [scrollTop, setScrollTop] = useState(0);

  const sortedData = useMemo(() => {
    if (!sortConfig || !sortable) return data;
    return [...data].sort((a, b) => {
      const column = columns.find((c) => c.key === sortConfig.key);
      if (!column || !column.sortable) return 0;
      const aVal = column.accessor(a);
      const bVal = column.accessor(b);
      const aStr = String(aVal);
      const bStr = String(bVal);
      const comparison = aStr.localeCompare(bStr, undefined, { numeric: true });
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });
  }, [data, sortConfig, columns, sortable]);

  const handleSort = (key: string) => {
    if (!sortable) return;
    const column = columns.find((c) => c.key === key);
    if (!column?.sortable) return;
    const direction = sortConfig?.key === key && sortConfig.direction === "asc" ? "desc" : "asc";
    setSortConfig({ key, direction });
    onSort?.(key, direction);
  };

  const visibleCount = Math.ceil(containerHeight / rowHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(sortedData.length, startIndex + visibleCount + overscan * 2);
  const visibleRows = sortedData.slice(startIndex, endIndex);
  const offsetY = startIndex * rowHeight;
  const totalHeight = sortedData.length * rowHeight;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const classNames = [
    "table-container",
    bordered && "table--bordered",
    compact && "table--compact",
    loading && "table--loading",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} style={style}>
      {loading && <div className="table__loading" aria-hidden="true" />}
      <div className="table__wrapper" role="region" aria-label="Data table" tabIndex={0}>
        <table className="table">
          <thead className="table__head">
            <tr className="table__row">
              {selectable && (
                <th className="table__cell table__cell--checkbox" scope="col" style={{ width: "48px" }}>
                  <input
                    type="checkbox"
                    className="table__checkbox"
                    checked={false}
                    onChange={() => {}}
                    aria-label="Select all rows"
                    disabled
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`table__cell table__header-cell ${column.className || ""} ${column.sortable ? "table__header--sortable" : ""}`}
                  scope="col"
                  style={{
                    width: column.width,
                    minWidth: column.minWidth,
                    maxWidth: column.maxWidth,
                    textAlign: column.align,
                    ...column.style,
                  }}
                  onClick={() => column.sortable && handleSort(column.key)}
                >
                  <div className="table__header-content">
                    {column.renderHeader ? column.renderHeader() : column.header}
                    {column.sortable && (
                      <span className="table__sort-icon" aria-hidden="true">
                        {sortConfig?.key === column.key ? (
                          sortConfig.direction === "asc" ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 15l-6-6-6 6" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          )
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                            <path d="M18 15l-6-6-6 6M6 9l6 6 6-6" />
                          </svg>
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
              {renderRowActions && (
                <th className="table__cell table__cell--actions" scope="col" style={{ width: "1%" }}>
                  <span className="table__header-content">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="table__body">
            {sortedData.length === 0 ? (
              <tr className="table__row table__row--empty">
                <td colSpan={columns.length + (selectable ? 1 : 0) + (renderRowActions ? 1 : 0)} className="table__empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              <>
                <tr className="table__spacer" style={{ height: offsetY }} aria-hidden="true">
                  <td colSpan={columns.length + (selectable ? 1 : 0) + (renderRowActions ? 1 : 0)} />
                </tr>
                {(() => {
                  const isSelected = (key: string) => selectedKeys.includes(key);
                  return visibleRows.map((row) => {
                    const rowKey = keyAccessor(row);
                    return (
                      <tr
                        key={rowKey}
                        className={`table__row ${rowClassName?.(row) || ""} ${isSelected(rowKey) ? "table__row--selected" : ""}`}
                        style={{ height: rowHeight }}
                      >
                        {selectable && (
                          <td className="table__cell table__cell--checkbox">
                            <input
                              type="checkbox"
                              className="table__checkbox"
                              checked={selectedKeys.includes(rowKey)}
                              onChange={(e) => onSelectionChange?.(e.target.checked ? [...selectedKeys, rowKey] : selectedKeys.filter((k) => k !== rowKey))}
                              aria-label={`Select row ${rowKey}`}
                            />
                          </td>
                        )}
                        {columns.map((column) => (
                          <td
                            key={column.key}
                            className={`table__cell ${column.className || ""}`}
                            style={{
                              textAlign: column.align,
                              ...column.style,
                            }}
                          >
                            {column.accessor(row)}
                          </td>
                        ))}
                        {renderRowActions && (
                          <td className="table__cell table__cell--actions">
                            <div className="table__actions">{renderRowActions(row)}</div>
                          </td>
                        )}
                      </tr>
                    );
                  });
                })()}
                <tr className="table__spacer" style={{ height: totalHeight - offsetY - visibleRows.length * rowHeight }} aria-hidden="true">
                  <td colSpan={columns.length + (selectable ? 1 : 0) + (renderRowActions ? 1 : 0)} />
                </tr>
              </>
            )}
          </tbody>
        </table>
        <div
          className="table__virtual-scroll"
          style={{ height: totalHeight }}
          onScroll={handleScroll}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}