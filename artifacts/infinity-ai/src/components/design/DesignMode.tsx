/**
 * DESIGN MODE — Visual Editing Bridge (Cursor Design Mode Parity)
 *
 * Main component that orchestrates:
 * - Design mode toggle in preview toolbar
 * - Element inspector overlay in preview
 * - Visual property editor sidebar
 * - Component playground for isolated testing
 * - Design system token sync
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  createContext,
  useContext,
} from "react";
import { X, MousePointer2, Edit3, Box, Layers, Palette, Code2, Eye, EyeOff, Settings, Sparkles } from "lucide-react";
import { VisualPropertyEditor } from "./VisualPropertyEditor";
import { ComponentPlayground } from "./ComponentPlayground";
import { useDesignMode } from "../../hooks/useDesignMode";
import { useI18n } from "../../lib/i18n";
import { Button, IconButton } from "../ui/Button";
import { Card } from "../ui/Card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/Tabs";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Tooltip } from "../ui/Tooltip";
import { Separator } from "../ui/Separator";
import { Badge } from "../ui/Badge";
import { Slider } from "../ui/Slider";
import { Input } from "../ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select";
import { Checkbox } from "../ui/Checkbox";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "../ui/Sheet";

// ============================================================================
// Types
// ============================================================================

interface InspectedElement {
  id: string;
  selector: string;
  tagName: string;
  className: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  componentInfo?: {
    name: string;
    filePath: string;
    props: ComponentProp[];
    isShadcnComponent: boolean;
    shadcnCategory?: string;
  };
  sourceLocation?: {
    file: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
  };
}

interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
  controlType?: "color" | "spacing" | "typography" | "boolean" | "enum" | "string" | "number";
  options?: string[];
  designTokenPath?: string;
}

interface DesignModeContextValue {
  isActive: boolean;
  selectedElement: InspectedElement | null;
  hoveredElement: InspectedElement | null;
  setSelectedElement: (el: InspectedElement | null) => void;
  setHoveredElement: (el: InspectedElement | null) => void;
  applyPropertyChange: (change: PropertyChange) => Promise<void>;
  registerElement: (el: InspectedElement) => void;
  designTokens: DesignTokens;
  componentRegistry: ComponentRegistryEntry[];
}

interface PropertyChange {
  elementId: string;
  property: string;
  value: string;
  type: "style" | "attribute" | "prop";
  designTokenPath?: string;
}

interface DesignTokens {
  colors: Record<string, Record<string, string>>;
  spacing: Record<string, string>;
  typography: {
    fontFamily: Record<string, string>;
    fontSize: Record<string, string>;
    fontWeight: Record<string, string>;
    lineHeight: Record<string, string>;
    letterSpacing: Record<string, string>;
  };
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
  breakpoints: Record<string, string>;
  zIndex: Record<string, string>;
  transitions: Record<string, string>;
  animation: Record<string, string>;
}

interface ComponentRegistryEntry {
  name: string;
  filePath: string;
  displayName: string;
  category: string;
  props: ComponentProp[];
  exampleUsage: string;
  tags: string[];
}

// ============================================================================
// Design Mode Context
// ============================================================================

const DesignModeContext = createContext<DesignModeContextValue | null>(null);

export function useDesignModeContext(): DesignModeContextValue {
  const ctx = useContext(DesignModeContext);
  if (!ctx) {
    throw new Error("useDesignModeContext must be used within DesignModeProvider");
  }
  return ctx;
}

// ============================================================================
// Main DesignMode Component
// ============================================================================

interface DesignModeProps {
  previewRef: React.RefObject<HTMLIFrameElement>;
  onToggleDesignMode?: (active: boolean) => void;
  designTokens?: DesignTokens;
  className?: string;
}

export function DesignMode({
  previewRef,
  onToggleDesignMode,
  designTokens: initialDesignTokens,
  className = "",
}: DesignModeProps) {
  const { t } = useI18n();
  const [isActive, setIsActive] = useState(false);
  const [selectedElement, setSelectedElement] = useState<InspectedElement | null>(null);
  const [hoveredElement, setHoveredElement] = useState<InspectedElement | null>(null);
  const [showPropertyEditor, setShowPropertyEditor] = useState(true);
  const [showComponentPlayground, setShowComponentPlayground] = useState(false);
  const [designTokens, setDesignTokens] = useState<DesignTokens>(initialDesignTokens || defaultDesignTokens);
  const [componentRegistry, setComponentRegistry] = useState<ComponentRegistryEntry[]>([]);
  const [registeredElements, setRegisteredElements] = useState<Map<string, InspectedElement>>(new Map());
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [playgroundSize, setPlaygroundSize] = useState(400);
  const isResizingRef = useRef(false);

  // Initialize design mode engine connection
  const { connect, disconnect, applyPropertyChange: applyChange, fetchRegistry, fetchTokens } = useDesignMode();

  useEffect(() => {
    if (isActive) {
      connect();
      fetchRegistry().then(setComponentRegistry);
      fetchTokens().then(setDesignTokens);
    } else {
      disconnect();
    }
    return () => disconnect();
  }, [isActive]);

  // Handle messages from preview iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === "DESIGN_MODE_ELEMENT_INSPECT") {
        const element = event.data.payload as InspectedElement;
        setRegisteredElements((prev) => {
          const next = new Map(prev);
          next.set(element.id, element);
          return next;
        });
        setHoveredElement(element);
      } else if (event.data.type === "DESIGN_MODE_ELEMENT_SELECT") {
        const element = event.data.payload as InspectedElement;
        setSelectedElement(element);
      } else if (event.data.type === "DESIGN_MODE_ELEMENT_HOVER") {
        const element = event.data.payload as InspectedElement | null;
        setHoveredElement(element);
      } else if (event.data.type === "DESIGN_MODE_TOKENS_UPDATE") {
        setDesignTokens(event.data.payload);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const toggleDesignMode = useCallback(() => {
    const newActive = !isActive;
    setIsActive(newActive);
    onToggleDesignMode?.(newActive);

    // Send toggle message to preview
    previewRef.current?.contentWindow?.postMessage(
      { type: "DESIGN_MODE_TOGGLE", payload: { active: newActive } },
      "*"
    );
  }, [isActive, onToggleDesignMode, previewRef]);

  const handleApplyPropertyChange = useCallback(
    async (change: PropertyChange) => {
      await applyChange(change);
      // Also send to preview for immediate visual feedback
      previewRef.current?.contentWindow?.postMessage(
        { type: "DESIGN_MODE_PROPERTY_CHANGE", payload: change },
        "*"
      );
    },
    [applyChange, previewRef]
  );

  const handleRegisterElement = useCallback((element: InspectedElement) => {
    setRegisteredElements((prev) => {
      const next = new Map(prev);
      next.set(element.id, element);
      return next;
    });
  }, []);

  const contextValue: DesignModeContextValue = {
    isActive,
    selectedElement,
    hoveredElement,
    setSelectedElement,
    setHoveredElement,
    applyPropertyChange: handleApplyPropertyChange,
    registerElement: handleRegisterElement,
    designTokens,
    componentRegistry,
  };

  return (
    <DesignModeContext.Provider value={contextValue}>
      <div className={`design-mode ${className}`}>
        {/* Design Mode Toolbar */}
        <DesignModeToolbar
          isActive={isActive}
          onToggle={toggleDesignMode}
          showPropertyEditor={showPropertyEditor}
          onTogglePropertyEditor={() => setShowPropertyEditor((v) => !v)}
          showComponentPlayground={showComponentPlayground}
          onToggleComponentPlayground={() => setShowComponentPlayground((v) => !v)}
          sidebarWidth={sidebarWidth}
          onResizeSidebar={setSidebarWidth}
        />

        {/* Overlay for element highlighting in preview */}
        {isActive && (
          <DesignModeOverlay
            previewRef={previewRef}
            hoveredElement={hoveredElement}
            selectedElement={selectedElement}
            onElementClick={(el) => setSelectedElement(el)}
          />
        )}

        {/* Property Editor Sidebar */}
        {isActive && showPropertyEditor && (
          <PropertyEditorSidebar
            selectedElement={selectedElement}
            hoveredElement={hoveredElement}
            width={sidebarWidth}
            onResize={setSidebarWidth}
            onClose={() => setShowPropertyEditor(false)}
          />
        )}

        {/* Component Playground Sheet */}
        {isActive && showComponentPlayground && (
          <ComponentPlaygroundSheet
            componentRegistry={componentRegistry}
            designTokens={designTokens}
            width={playgroundSize}
            onResize={setPlaygroundSize}
            onClose={() => setShowComponentPlayground(false)}
          />
        )}
      </div>
    </DesignModeContext.Provider>
  );
}

// ============================================================================
// Design Mode Toolbar
// ============================================================================

interface DesignModeToolbarProps {
  isActive: boolean;
  onToggle: () => void;
  showPropertyEditor: boolean;
  onTogglePropertyEditor: () => void;
  showComponentPlayground: boolean;
  onToggleComponentPlayground: () => void;
  sidebarWidth: number;
  onResizeSidebar: (width: number) => void;
}

function DesignModeToolbar({
  isActive,
  onToggle,
  showPropertyEditor,
  onTogglePropertyEditor,
  showComponentPlayground,
  onToggleComponentPlayground,
  sidebarWidth,
  onResizeSidebar,
}: DesignModeToolbarProps) {
  const { t } = useI18n();

  return (
    <div
      className={`design-mode-toolbar ${isActive ? "active" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <div className="toolbar-left">
        <Tooltip content={t("designMode.tooltip.toggle")}>
          <Button
            variant={isActive ? "primary" : "ghost"}
            size="sm"
            onClick={onToggle}
            className="design-mode-toggle"
            aria-pressed={isActive}
          >
            <MousePointer2 className="w-4 h-4 mr-1" />
            {isActive ? t("designMode.exit") : t("designMode.enter")}
          </Button>
        </Tooltip>

        {isActive && (
          <>
            <Tooltip content={t("designMode.tooltip.inspector")}>
              <IconButton
                variant="ghost"
                size="sm"
                aria-pressed={true}
                disabled
                title={t("designMode.inspectorActive")}
              >
                <MousePointer2 className="w-4 h-4" />
              </IconButton>
            </Tooltip>

            <Tooltip content={t("designMode.tooltip.propertyEditor")}>
              <IconButton
                variant={showPropertyEditor ? "secondary" : "ghost"}
                size="sm"
                onClick={onTogglePropertyEditor}
                aria-pressed={showPropertyEditor}
              >
                <Edit3 className="w-4 h-4" />
              </IconButton>
            </Tooltip>

            <Tooltip content={t("designMode.tooltip.componentPlayground")}>
              <IconButton
                variant={showComponentPlayground ? "secondary" : "ghost"}
                size="sm"
                onClick={onToggleComponentPlayground}
                aria-pressed={showComponentPlayground}
              >
                <Box className="w-4 h-4" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>

      <div className="toolbar-center">
        {isActive && (
          <DesignModeStatus selectedElement={null} />
        )}
      </div>

      <div className="toolbar-right">
        {isActive && (
          <Tooltip content={t("designMode.tooltip.settings")}>
            <IconButton variant="ghost" size="sm" onClick={() => {}}>
              <Settings className="w-4 h-4" />
            </IconButton>
          </Tooltip>
        )}
      </div>

      {/* Resize handle for sidebar */}
      {isActive && showPropertyEditor && (
        <div
          className="sidebar-resize-handle"
          style={{ right: sidebarWidth }}
          onMouseDown={(e) => {
            e.preventDefault();
            isResizingRef.current = true;
            const startX = e.clientX;
            const startWidth = sidebarWidth;

            const handleMouseMove = (moveEvent: MouseEvent) => {
              if (!isResizingRef.current) return;
              const newWidth = Math.max(240, Math.min(600, startWidth - (moveEvent.clientX - startX)));
              onResizeSidebar(newWidth);
            };

            const handleMouseUp = () => {
              isResizingRef.current = false;
              document.removeEventListener("mousemove", handleMouseMove);
              document.removeEventListener("mouseup", handleMouseUp);
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Design Mode Status
// ============================================================================

interface DesignModeStatusProps {
  selectedElement: InspectedElement | null;
}

function DesignModeStatus({ selectedElement }: DesignModeStatusProps) {
  const { t } = useI18n();

  if (!selectedElement) {
    return (
      <span className="design-mode-status">
        <span className="status-dot active" />
        {t("designMode.hoverToInspect")}
      </span>
    );
  }

  return (
    <div className="design-mode-status selected">
      <span className="status-dot active" />
      <span className="element-tag">{"<" + selectedElement.tagName.toLowerCase() + ">"}</span>
      {selectedElement.componentInfo && (
        <>
          <Separator orientation="vertical" className="mx-1" />
          <Badge variant="outline" className="component-badge">
            {selectedElement.componentInfo.name}
          </Badge>
        </>
      )}
      {selectedElement.sourceLocation && (
        <>
          <Separator orientation="vertical" className="mx-1" />
          <span className="source-location">
            {selectedElement.sourceLocation.file}:{selectedElement.sourceLocation.line}
          </span>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Design Mode Overlay (Element Highlighting)
// ============================================================================

interface DesignModeOverlayProps {
  previewRef: React.RefObject<HTMLIFrameElement>;
  hoveredElement: InspectedElement | null;
  selectedElement: InspectedElement | null;
  onElementClick: (el: InspectedElement) => void;
}

function DesignModeOverlay({
  previewRef,
  hoveredElement,
  selectedElement,
  onElementClick,
}: DesignModeOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Sync overlay position with preview
  useEffect(() => {
    const preview = previewRef.current;
    const overlay = overlayRef.current;
    if (!preview || !overlay) return;

    const updatePosition = () => {
      const rect = preview.getBoundingClientRect();
      overlay.style.position = "fixed";
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "9999";
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition);
    };
  }, [previewRef]);

  const renderHighlight = (element: InspectedElement | null, className: string) => {
    if (!element) return null;

    return (
      <div
        className={`design-mode-highlight ${className}`}
        style={{
          position: "absolute",
          left: element.bounds.x,
          top: element.bounds.y,
          width: element.bounds.width,
          height: element.bounds.height,
          pointerEvents: "none",
          boxSizing: "border-box",
        }}
      >
        <div className="highlight-box" />
        <div className="highlight-label">
          {element.tagName.toLowerCase()}
          {element.className && `.${element.className.split(" ")[0]}`}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={overlayRef}
      className="design-mode-overlay"
      style={{ pointerEvents: "none" }}
    >
      {renderHighlight(hoveredElement, "hovered")}
      {renderHighlight(selectedElement, "selected")}
    </div>
  );
}

// ============================================================================
// Property Editor Sidebar
// ============================================================================

interface PropertyEditorSidebarProps {
  selectedElement: InspectedElement | null;
  hoveredElement: InspectedElement | null;
  width: number;
  onResize: (width: number) => void;
  onClose: () => void;
}

function PropertyEditorSidebar({
  selectedElement,
  hoveredElement,
  width,
  onResize,
  onClose,
}: PropertyEditorSidebarProps) {
  const { t } = useI18n();
  const element = selectedElement || hoveredElement;

  if (!element) {
    return (
      <div
        className="design-mode-sidebar empty"
        style={{ width }}
      >
        <div className="sidebar-header">
          <h3>{t("designMode.properties")}</h3>
          <IconButton variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconButton>
        </div>
        <div className="sidebar-empty-state">
          <MousePointer2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-center text-muted-foreground">
            {t("designMode.selectElement")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="design-mode-sidebar"
      style={{ width }}
    >
      <div className="sidebar-header">
        <div className="header-left">
          <h3>{t("designMode.properties")}</h3>
          <Badge variant="outline" className="element-type-badge">
            {"<" + element.tagName.toLowerCase() + ">"}
          </Badge>
          {element.componentInfo && (
            <Badge variant="secondary" className="component-badge">
              {element.componentInfo.name}
            </Badge>
          )}
        </div>
        <IconButton variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4" />
        </IconButton>
      </div>

      <Separator />

      <ScrollArea className="sidebar-content">
        <VisualPropertyEditor
          element={element}
          designTokens={defaultDesignTokens}
          onChange={async () => {}}
        />
      </ScrollArea>

      {element.sourceLocation && (
        <div className="sidebar-footer">
          <Separator />
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
            <Code2 className="w-4 h-4" />
            {t("designMode.goToCode")} {element.sourceLocation.file}:{element.sourceLocation.line}
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Component Playground Sheet
// ============================================================================

interface ComponentPlaygroundSheetProps {
  componentRegistry: ComponentRegistryEntry[];
  designTokens: DesignTokens;
  width: number;
  onResize: (width: number) => void;
  onClose: () => void;
}

function ComponentPlaygroundSheet({
  componentRegistry,
  designTokens,
  width,
  onResize,
  onClose,
}: ComponentPlaygroundSheetProps) {
  const { t } = useI18n();

  return (
    <Sheet open={true} onOpenChange={onClose}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm">
          <Box className="w-4 h-4 mr-1" />
          {t("designMode.componentPlayground")}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[400px] max-w-[90vw] p-0">
        <SheetHeader>
          <SheetTitle>{t("designMode.componentPlayground")}</SheetTitle>
          <SheetDescription>
            {t("designMode.playgroundDescription")}
          </SheetDescription>
        </SheetHeader>
        <ComponentPlayground
          componentRegistry={componentRegistry}
          designTokens={designTokens}
        />
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// Default Design Tokens
// ============================================================================

const defaultDesignTokens: DesignTokens = {
  colors: {
    primary: { 50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e" },
    secondary: { 50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a" },
    success: { 500: "#22c55e", 600: "#16a34a" },
    warning: { 500: "#f59e0b", 600: "#d97706" },
    danger: { 500: "#ef4444", 600: "#dc2626" },
    background: { DEFAULT: "#ffffff", secondary: "#f8fafc" },
    foreground: { DEFAULT: "#0f172a", muted: "#64748b" },
    border: { DEFAULT: "#e2e8f0", focus: "#0ea5e9" },
  },
  spacing: { 0: "0", 1: "0.25rem", 2: "0.5rem", 3: "0.75rem", 4: "1rem", 5: "1.25rem", 6: "1.5rem", 8: "2rem", 10: "2.5rem", 12: "3rem", 16: "4rem", 20: "5rem", 24: "6rem" },
  typography: {
    fontFamily: { sans: "Inter, system-ui, sans-serif", mono: "JetBrains Mono, monospace" },
    fontSize: { xs: "0.75rem", sm: "0.875rem", base: "1rem", lg: "1.125rem", xl: "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem", "4xl": "2.25rem" },
    fontWeight: { normal: "400", medium: "500", semibold: "600", bold: "700" },
    lineHeight: { tight: "1.25", normal: "1.5", relaxed: "1.75" },
    letterSpacing: { tight: "-0.025em", normal: "0", wide: "0.025em" },
  },
  borderRadius: { none: "0", sm: "0.125rem", DEFAULT: "0.25rem", md: "0.375rem", lg: "0.5rem", xl: "0.75rem", "2xl": "1rem", full: "9999px" },
  shadows: { sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)", DEFAULT: "0 1px 3px 0 rgb(0 0 0 / 0.1)", md: "0 4px 6px -1px rgb(0 0 0 / 0.1)", lg: "0 10px 15px -3px rgb(0 0 0 / 0.1)", xl: "0 20px 25px -5px rgb(0 0 0 / 0.1)" },
  breakpoints: { sm: "640px", md: "768px", lg: "1024px", xl: "1280px", "2xl": "1536px" },
  zIndex: { auto: "auto", 0: "0", 10: "10", 20: "20", 30: "30", 40: "40", 50: "50" },
  transitions: { fast: "150ms ease", DEFAULT: "200ms ease", slow: "300ms ease" },
  animation: { spin: "spin 1s linear infinite", ping: "ping 1s cubic-bezier(0, 0, 0.2, 1) infinite", pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" },
};

export default DesignMode;