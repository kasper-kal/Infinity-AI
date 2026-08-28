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

// Select (Radix UI Select components) - exported with RadixSelect prefix to avoid conflict
export {
  Select as RadixSelect,
  SelectGroup as RadixSelectGroup,
  SelectValue as RadixSelectValue,
  SelectTrigger as RadixSelectTrigger,
  SelectContent as RadixSelectContent,
  SelectLabel as RadixSelectLabel,
  SelectItem as RadixSelectItem,
  SelectSeparator as RadixSelectSeparator,
  SelectScrollUpButton as RadixSelectScrollUpButton,
  SelectScrollDownButton as RadixSelectScrollDownButton,
} from "./select";
export type {
  SelectProps as RadixSelectProps,
  SelectGroupProps as RadixSelectGroupProps,
  SelectValueProps as RadixSelectValueProps,
  SelectTriggerProps as RadixSelectTriggerProps,
  SelectContentProps as RadixSelectContentProps,
  SelectLabelProps as RadixSelectLabelProps,
  SelectItemProps as RadixSelectItemProps,
  SelectSeparatorProps as RadixSelectSeparatorProps,
} from "./select";

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

// ScrollArea
export { ScrollArea } from "./scroll-area";
export type { ScrollAreaProps } from "./scroll-area";

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

// Checkbox
export { Checkbox } from "./checkbox";
export type { CheckboxProps } from "./checkbox";

// Label
export { Label } from "./label";
export type { LabelProps } from "./label";

// Alert
export { Alert, AlertTitle, AlertDescription } from "./alert";
export type { AlertProps, AlertTitleProps, AlertDescriptionProps } from "./alert";

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