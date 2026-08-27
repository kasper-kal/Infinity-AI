/**
 * UI Components Barrel Export — Liquid Glass Design System
 * Single import for all base UI components
 */

// Button
export { Button, IconButton, ButtonGroup } from "./Button";
export type { ButtonProps, IconButtonProps, ButtonGroupProps } from "./Button";

// Avatar
export { Avatar, AvatarFallback, AvatarImage } from "./avatar";
export type { AvatarProps, AvatarFallbackProps, AvatarImageProps } from "./avatar";

// Card
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "./card";

// Input
export { Input, Textarea, Select } from "./Input";
export type { InputProps, TextareaProps, SelectProps } from "./Input";

// Dialog
export { Dialog, AlertDialog, Drawer } from "./Dialog";
export type { DialogProps, AlertDialogProps, DrawerProps } from "./Dialog";

// Sheet
export { Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, SheetTrigger, SheetClose, SheetOverlay, SheetPortal } from "./sheet";
export type { SheetProps, SheetContentProps, SheetHeaderProps, SheetFooterProps, SheetTitleProps, SheetDescriptionProps, SheetTriggerProps, SheetCloseProps, SheetOverlayProps, SheetPortalProps } from "./sheet";

// Tooltip
export { Tooltip, Toast, ToastContainer, useToast } from "./Tooltip";
export type { TooltipProps, ToastProps, ToastContainerProps } from "./Tooltip";

// Table
export { Table, VirtualizedTable } from "./Table";
export type { TableProps, VirtualizedTableProps, Column, RowAction } from "./Table";

// Tree
export { Tree, FileTree } from "./Tree";
export type { TreeProps, FileTreeProps, TreeNode, FileTreeNode } from "./Tree";

// Tabs
export { Tabs, SegmentedControl, TabsList, TabsTrigger, TabsContent, TabPanel } from "./Tabs";
export type { TabsProps, SegmentedControlProps, TabsListProps, TabsTriggerProps, TabsContentProps, TabPanelProps } from "./Tabs";

// Separator
export { Separator } from "./separator";
export type { SeparatorProps } from "./separator";

// Code Editor
export { CodeEditor, DiffEditor, InlineEditor } from "./CodeEditor";
export type { CodeEditorProps, DiffEditorProps, InlineEditorProps } from "./CodeEditor";

// Terminal
export { Terminal, TerminalSession } from "./Terminal";
export type { TerminalProps, TerminalSessionProps } from "./Terminal";

// Diff View
export { DiffView, InlineDiff, FileDiff } from "./DiffView";
export type { DiffViewProps, InlineDiffProps, FileDiffProps, DiffLine, DiffHunk } from "./DiffView";

// Markdown Renderer
export { MarkdownRenderer, MarkdownEditor } from "./MarkdownRenderer";
export type { MarkdownRendererProps, MarkdownEditorProps } from "./MarkdownRenderer";

// Badge
export { Badge } from "./badge";
export type { BadgeProps } from "./badge";

// Mobile Components (re-export for convenience)
export {
  BottomNav,
  type BottomNavProps,
  type BottomNavItem,
  SheetModal,
  type SheetModalProps,
  type SheetSnapPoint,
  useSwipeGesture,
  SwipeableArea,
  type SwipeGestureOptions,
  type SwipeGestureState,
  type SwipeDirection,
  type SwipeableAreaProps,
  PullToRefresh,
  type PullToRefreshProps,
  type PullToRefreshRef,
  TouchTarget,
  TouchButton,
  TouchIconButton,
  TouchListItem,
  type TouchTargetProps,
  type TouchButtonProps,
  type TouchIconButtonProps,
  type TouchListItemProps,
  TOUCH_TARGET_SIZES,
  type TouchTargetSize,
  touchTargetStyles,
} from "../mobile";