/**
 * Tree Component — Liquid Glass Design System
 */

import React, { useState, useMemo, useRef, useEffect, ReactNode, KeyboardEvent } from "react";
import "./Tree.css";

export interface TreeNode<T = unknown> {
  id: string;
  label: ReactNode;
  children?: TreeNode<T>[];
  data?: T;
  disabled?: boolean;
  selected?: boolean;
  expanded?: boolean;
  icon?: ReactNode;
  className?: string;
}

export interface TreeProps<T = unknown> {
  nodes: TreeNode<T>[];
  onSelect?: (node: TreeNode<T>, selected: boolean) => void;
  onToggle?: (node: TreeNode<T>, expanded: boolean) => void;
  onClick?: (node: TreeNode<T>, e: React.MouseEvent) => void;
  onDoubleClick?: (node: TreeNode<T>, e: React.MouseEvent) => void;
  multiSelect?: boolean;
  selectedIds?: string[];
  expandedIds?: string[];
  defaultExpandedIds?: string[];
  renderNode?: (node: TreeNode<T>, props: { selected: boolean; expanded: boolean; level: number }) => ReactNode;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}

export function Tree<T = unknown>({
  nodes,
  onSelect,
  onToggle,
  onClick,
  onDoubleClick,
  multiSelect = false,
  selectedIds = [],
  expandedIds: controlledExpandedIds,
  defaultExpandedIds = [],
  renderNode,
  className = "",
  style,
  autoFocus = false,
}: TreeProps<T>) {
  const [uncontrolledExpandedIds, setUncontrolledExpandedIds] = useState<Set<string>>(
    new Set(defaultExpandedIds)
  );
  const treeRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const isControlled = controlledExpandedIds !== undefined;
  const expandedIds = isControlled ? new Set(controlledExpandedIds) : uncontrolledExpandedIds;

  const handleToggle = (node: TreeNode<T>) => {
    const newExpanded = !expandedIds.has(node.id);
    if (isControlled) {
      onToggle?.(node, newExpanded);
    } else {
      setUncontrolledExpandedIds((prev) => {
        const next = new Set(prev);
        if (newExpanded) next.add(node.id);
        else next.delete(node.id);
        return next;
      });
    }
    onToggle?.(node, newExpanded);
  };

  const handleSelect = (node: TreeNode<T>, e: React.MouseEvent) => {
    if (node.disabled) return;
    const selected = !selectedIds.includes(node.id);
    if (multiSelect) {
      onSelect?.(node, selected);
    } else {
      onSelect?.(node, true);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>, node: TreeNode<T>) => {
    if (node.disabled) return;

    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        handleSelect(node, e as unknown as React.MouseEvent);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (node.children?.length && !expandedIds.has(node.id)) {
          handleToggle(node);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (node.children?.length && expandedIds.has(node.id)) {
          handleToggle(node);
        } else if (node.parentId) {
          // Focus parent
          nodeRefs.current.get(node.parentId)?.focus();
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        focusNextNode(node.id);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusPrevNode(node.id);
        break;
      case "Home":
        e.preventDefault();
        focusFirstNode();
        break;
      case "End":
        e.preventDefault();
        focusLastNode();
        break;
    }
  };

  const focusNextNode = (currentId: string) => {
    const allNodes = getAllNodeIds(nodes);
    const currentIndex = allNodes.indexOf(currentId);
    if (currentIndex < allNodes.length - 1) {
      nodeRefs.current.get(allNodes[currentIndex + 1])?.focus();
    }
  };

  const focusPrevNode = (currentId: string) => {
    const allNodes = getAllNodeIds(nodes);
    const currentIndex = allNodes.indexOf(currentId);
    if (currentIndex > 0) {
      nodeRefs.current.get(allNodes[currentIndex - 1])?.focus();
    }
  };

  const focusFirstNode = () => {
    const allNodes = getAllNodeIds(nodes);
    if (allNodes.length > 0) {
      nodeRefs.current.get(allNodes[0])?.focus();
    }
  };

  const focusLastNode = () => {
    const allNodes = getAllNodeIds(nodes);
    if (allNodes.length > 0) {
      nodeRefs.current.get(allNodes[allNodes.length - 1])?.focus();
    }
  };

  useEffect(() => {
    if (autoFocus && treeRef.current) {
      treeRef.current.focus();
    }
  }, [autoFocus]);

  const classNames = ["tree", className].filter(Boolean).join(" ");

  return (
    <div
      ref={treeRef}
      className={classNames}
      style={style}
      role="tree"
      tabIndex={0}
      aria-multiselectable={multiSelect}
    >
      <ul className="tree__list" role="group">
        {nodes.map((node, index) => (
          <TreeNodeComponent
            key={node.id}
            node={node}
            level={0}
            index={index}
            total={nodes.length}
            expandedIds={expandedIds}
            selectedIds={selectedIds}
            multiSelect={multiSelect}
            onToggle={handleToggle}
            onSelect={handleSelect}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onKeyDown={handleKeyDown}
            renderNode={renderNode}
            nodeRefs={nodeRefs}
            parentId={undefined}
          />
        ))}
      </ul>
    </div>
  );
}

function getAllNodeIds<T>(nodes: TreeNode<T>[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    if (node.children?.length && ids.includes(node.id)) { // expanded check would need context
      // We'll just flatten all for keyboard nav
      ids.push(...getAllNodeIds(node.children));
    }
  }
  return ids;
}

interface TreeNodeComponentProps<T> {
  node: TreeNode<T>;
  level: number;
  index: number;
  total: number;
  expandedIds: Set<string>;
  selectedIds: string[];
  multiSelect: boolean;
  onToggle: (node: TreeNode<T>) => void;
  onSelect: (node: TreeNode<T>, e: React.MouseEvent) => void;
  onClick?: (node: TreeNode<T>, e: React.MouseEvent) => void;
  onDoubleClick?: (node: TreeNode<T>, e: React.MouseEvent) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>, node: TreeNode<T>) => void;
  renderNode?: (node: TreeNode<T>, props: { selected: boolean; expanded: boolean; level: number }) => ReactNode;
  nodeRefs: React.RefObject<Map<string, HTMLDivElement>>;
  parentId?: string;
}

function TreeNodeComponent<T>({
  node,
  level,
  index,
  total,
  expandedIds,
  selectedIds,
  multiSelect,
  onToggle,
  onSelect,
  onClick,
  onDoubleClick,
  onKeyDown,
  renderNode,
  nodeRefs,
  parentId,
}: TreeNodeComponentProps<T>) {
  const expanded = expandedIds.has(node.id);
  const selected = selectedIds.includes(node.id);
  const hasChildren = node.children && node.children.length > 0;
  const isLast = index === total - 1;

  const handleClick = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLButtonElement && e.target.closest(".tree__toggle")) {
      return; // Let toggle button handle it
    }
    onSelect(node, e);
    onClick?.(node, e);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (hasChildren) {
      onToggle(node);
    }
    onDoubleClick?.(node, e);
  };

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(node);
  };

  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (nodeRef.current) {
      nodeRefs.current.set(node.id, nodeRef.current);
    }
    return () => {
      nodeRefs.current.delete(node.id);
    };
  }, [node.id, nodeRefs]);

  if (renderNode) {
    return (
      <li className="tree__item" role="treeitem" aria-level={level + 1} aria-expanded={expanded} aria-selected={selected}>
        <div
          ref={nodeRef}
          className={`tree__node ${selected ? "tree__node--selected" : ""} ${node.disabled ? "tree__node--disabled" : ""} ${node.className || ""}`}
          tabIndex={node.disabled ? -1 : 0}
          role="treeitem"
          aria-level={level + 1}
          aria-expanded={hasChildren ? expanded : undefined}
          aria-selected={selected}
          aria-disabled={node.disabled}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onKeyDown={(e) => onKeyDown(e, node)}
          style={{ "--tree-level": level }}
        >
          {renderNode(node, { selected, expanded, level })}
        </div>
        {hasChildren && expanded && (
          <ul className="tree__list" role="group">
            {node.children!.map((child, i) => (
              <TreeNodeComponent
                key={child.id}
                node={{ ...child, parentId: node.id }}
                level={level + 1}
                index={i}
                total={node.children!.length}
                expandedIds={expandedIds}
                selectedIds={selectedIds}
                multiSelect={multiSelect}
                onToggle={onToggle}
                onSelect={onSelect}
                onClick={onClick}
                onDoubleClick={onDoubleClick}
                onKeyDown={onKeyDown}
                renderNode={renderNode}
                nodeRefs={nodeRefs}
                parentId={node.id}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li className="tree__item" role="treeitem" aria-level={level + 1} aria-expanded={expanded} aria-selected={selected}>
      <div
        ref={nodeRef}
        className={`tree__node ${selected ? "tree__node--selected" : ""} ${node.disabled ? "tree__node--disabled" : ""} ${node.className || ""}`}
        tabIndex={node.disabled ? -1 : 0}
        role="treeitem"
        aria-level={level + 1}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={selected}
        aria-disabled={node.disabled}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(e) => onKeyDown(e, node)}
        style={{ "--tree-level": level }}
      >
        <span className="tree__indent" aria-hidden="true">
          {Array.from({ length: level }).map((_, i) => (
            <span key={i} className="tree__indent-guide" style={{ "--guide-index": i }} />
          ))}
          {hasChildren && (
            <button
              className={`tree__toggle ${expanded ? "tree__toggle--expanded" : ""}`}
              onClick={handleToggleClick}
              aria-label={expanded ? "Collapse" : "Expand"}
              aria-expanded={expanded}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}
          {!hasChildren && <span className="tree__toggle tree__toggle--leaf" aria-hidden="true" />}
        </span>
        {node.icon && <span className="tree__icon" aria-hidden="true">{node.icon}</span>}
        <span className="tree__label">{node.label}</span>
      </div>
      {hasChildren && expanded && (
        <ul className="tree__list" role="group">
          {node.children!.map((child, i) => (
            <TreeNodeComponent
              key={child.id}
              node={{ ...child, parentId: node.id }}
              level={level + 1}
              index={i}
              total={node.children!.length}
              expandedIds={expandedIds}
              selectedIds={selectedIds}
              multiSelect={multiSelect}
              onToggle={onToggle}
              onSelect={onSelect}
              onClick={onClick}
              onDoubleClick={onDoubleClick}
              onKeyDown={onKeyDown}
              renderNode={renderNode}
              nodeRefs={nodeRefs}
              parentId={node.id}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Tree View — File tree with context menu support */
export interface FileTreeNode extends TreeNode {
  type: "file" | "folder";
  path: string;
  size?: number;
  modified?: Date;
}

export interface FileTreeProps {
  nodes: FileTreeNode[];
  selectedPaths?: string[];
  onSelect?: (paths: string[]) => void;
  onOpen?: (path: string) => void;
  onContextMenu?: (node: FileTreeNode, e: React.MouseEvent) => void;
  className?: string;
}

export const FileTree: React.FC<FileTreeProps> = ({
  nodes,
  selectedPaths = [],
  onSelect,
  onOpen,
  onContextMenu,
  className = "",
}) => {
  const handleSelect = (node: FileTreeNode, selected: boolean) => {
    const newSelection = selected
      ? [...selectedPaths, node.path]
      : selectedPaths.filter((p) => p !== node.path);
    onSelect?.(newSelection);
  };

  const handleClick = (node: FileTreeNode, e: React.MouseEvent) => {
    if (node.type === "file" && e.detail === 2) {
      onOpen?.(node.path);
    }
  };

  const handleContextMenu = (node: FileTreeNode, e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu?.(node, e);
  };

  const renderNode = (node: FileTreeNode, { selected, expanded }: { selected: boolean; expanded: boolean }) => (
    <>
      <span className={`tree__file-icon tree__file-icon--${node.type}`} aria-hidden="true">
        {node.type === "folder" ? (
          expanded ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          )
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )}
      </span>
      <span className="tree__label">{node.label}</span>
      {node.size && <span className="tree__meta">{(node.size / 1024).toFixed(1)} KB</span>}
      {node.modified && <span className="tree__meta">{node.modified.toLocaleDateString()}</span>}
    </>
  );

  return (
    <Tree
      nodes={nodes}
      selectedIds={selectedPaths}
      onSelect={handleSelect}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      renderNode={renderNode}
      className={`file-tree ${className}`}
    />
  );
};