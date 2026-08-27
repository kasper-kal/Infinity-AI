/**
 * VisualInspector Component
 *
 * Enables hover/click in preview iframe to highlight corresponding JSX
 * in code editor. Bidirectional: select in editor → highlight in preview.
 * Uses postMessage for iframe communication.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge, Separator } from '@/components/ui';
import {
  MousePointer,
  Code,
  Eye,
  EyeOff,
  Target,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  GripVertical,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SelectedElement {
  selector: string;
  tagName: string;
  className: string;
  props: Record<string, any>;
  children: number;
  depth: number;
  xpath: string;
  bounds?: DOMRect;
  id?: string;
}

interface VisualInspectorProps {
  /** Iframe ref for communication */
  iframeRef: React.RefObject<HTMLIFrameElement>;
  /** Callback when element selected in preview */
  onSelectElement: (element: SelectedElement | null) => void;
  /** Currently selected element from code editor (for reverse sync) */
  codeSelectedElement?: SelectedElement | null;
  /** Enable/disable inspector */
  enabled?: boolean;
  /** Show hover preview without selecting */
  showHoverPreview?: boolean;
  className?: string;
}

const SELECTOR_PRIORITY = [
  'data-preview-id',
  'data-testid',
  'id',
  'className',
  'tagName',
];

export const VisualInspector: React.FC<VisualInspectorProps> = ({
  iframeRef,
  onSelectElement,
  codeSelectedElement,
  enabled = true,
  showHoverPreview = true,
  className,
}) => {
  const [hoveredElement, setHoveredElement] = useState<SelectedElement | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [elementStack, setElementStack] = useState<SelectedElement[]>([]);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Listen for messages from iframe
  useEffect(() => {
    if (!enabled) return;

    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from our iframe
      if (event.source !== iframeRef.current?.contentWindow) return;

      const { type, payload } = event.data;

      switch (type) {
        case 'element-hover':
          if (showHoverPreview && payload) {
            clearTimeout(hoverTimeoutRef.current!);
            hoverTimeoutRef.current = setTimeout(() => {
              setHoveredElement(payload);
            }, 50);
          }
          break;

        case 'element-unhover':
          clearTimeout(hoverTimeoutRef.current!);
          setHoveredElement(null);
          break;

        case 'element-click':
          if (payload) {
            setElementStack(prev => [...prev, payload]);
            onSelectElement(payload);
            setIsInspecting(false);
          }
          break;

        case 'element-selected':
          // Reverse sync from code editor
          if (payload && iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
              type: 'highlight-element',
              payload: { selector: payload.selector, action: 'select' },
            }, '*');
          }
          break;

        case 'element-unselected':
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
              type: 'highlight-element',
              payload: { selector: payload?.selector, action: 'unselect' },
            }, '*');
          }
          break;

        case 'dom-ready':
          // Inject inspection scripts
          injectInspectionScripts();
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(hoverTimeoutRef.current!);
    };
  }, [enabled, showHoverPreview, iframeRef, onSelectElement, codeSelectedElement]);

  // Sync code selection to preview
  useEffect(() => {
    if (!enabled || !iframeRef.current?.contentWindow || !codeSelectedElement) return;

    iframeRef.current.contentWindow.postMessage({
      type: 'highlight-element',
      payload: { selector: codeSelectedElement.selector, action: 'select' },
    }, '*');

    return () => {
      if (iframeRef.current?.contentWindow && codeSelectedElement) {
        iframeRef.current.contentWindow.postMessage({
          type: 'highlight-element',
          payload: { selector: codeSelectedElement.selector, action: 'unselect' },
        }, '*');
      }
    };
  }, [codeSelectedElement, enabled, iframeRef]);

  const injectInspectionScripts = useCallback(() => {
    if (!iframeRef.current?.contentWindow) return;

    const script = `
      (function() {
        if (window.__infinityInspectorInjected) return;
        window.__infinityInspectorInjected = true;

        let currentHovered = null;
        let isInspecting = false;

        // Generate unique selector for element
        function getSelector(element) {
          // Priority: data-preview-id > data-testid > id > className > tagName
          if (element.dataset.previewId) return '[data-preview-id="' + element.dataset.previewId + '"]';
          if (element.dataset.testid) return '[data-testid="' + element.dataset.testid + '"]';
          if (element.id) return '#' + element.id;
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\\s+/).filter(c => c);
            if (classes.length > 0) return '.' + classes.join('.');
          }
          return element.tagName.toLowerCase();
        }

        // Get full xpath
        function getXPath(element) {
          if (!element) return '';
          if (element.id) return '//*[@id="' + element.id + '"]';
          if (element === document.body) return '/html/body';

          let ix = 0;
          const siblings = element.parentNode ? Array.from(element.parentNode.children) : [];
          for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling === element) {
              return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
            }
            if (sibling.tagName === element.tagName) ix++;
          }
          return '';
        }

        // Get computed styles for visual highlight
        function getElementInfo(element) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            selector: getSelector(element),
            tagName: element.tagName.toLowerCase(),
            className: element.className || '',
            id: element.id || '',
            props: Array.from(element.attributes).reduce((acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            }, {}),
            children: element.children.length,
            depth: getDepth(element),
            xpath: getXPath(element),
            bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        }

        function getDepth(element) {
          let depth = 0;
          let current = element.parentElement;
          while (current && current !== document.body) {
            depth++;
            current = current.parentElement;
          }
          return depth;
        }

        // Highlight overlay
        let highlightOverlay = null;
        let hoverOverlay = null;

        function createOverlay(className) {
          const div = document.createElement('div');
          div.className = className;
          div.style.cssText = \`
            position: fixed;
            pointer-events: none;
            z-index: 2147483647;
            border: 2px solid #3b82f6;
            background: rgba(59, 130, 246, 0.1);
            box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            transition: all 50ms ease-out;
            display: none;
          \`;
          document.body.appendChild(div);
          return div;
        }

        function updateOverlay(overlay, info) {
          if (!overlay || !info) return;
          overlay.style.display = 'block';
          overlay.style.left = info.bounds.x + 'px';
          overlay.style.top = info.bounds.y + 'px';
          overlay.style.width = info.bounds.width + 'px';
          overlay.style.height = info.bounds.height + 'px';
        }

        function removeOverlay(overlay) {
          if (overlay) {
            overlay.style.display = 'none';
          }
        }

        // Event handlers
        function onMouseOver(e) {
          if (!isInspecting) return;
          e.stopPropagation();

          const target = e.target;
          if (target === highlightOverlay || target === hoverOverlay) return;

          const info = getElementInfo(target);

          if (!hoverOverlay) hoverOverlay = createOverlay('infinity-hover-overlay');
          updateOverlay(hoverOverlay, info);

          // Show tooltip
          showTooltip(target, info);

          window.parent.postMessage({
            type: 'element-hover',
            payload: info,
          }, '*');
        }

        function onMouseOut(e) {
          if (!isInspecting) return;
          e.stopPropagation();

          const target = e.target;
          if (!target.contains(e.relatedTarget as Node)) {
            removeOverlay(hoverOverlay);
            hideTooltip();

            window.parent.postMessage({
              type: 'element-unhover',
              payload: null,
            }, '*');
          }
        }

        function onClick(e) {
          if (!isInspecting) return;
          e.preventDefault();
          e.stopPropagation();

          const target = e.target;
          const info = getElementInfo(target);

          window.parent.postMessage({
            type: 'element-click',
            payload: info,
          }, '*');

          // Stop inspecting after click
          stopInspecting();
        }

        // Tooltip
        let tooltip = null;
        function showTooltip(element, info) {
          if (tooltip) tooltip.remove();

          tooltip = document.createElement('div');
          tooltip.style.cssText = \`
            position: fixed;
            z-index: 2147483647;
            background: #1e1e1e;
            color: #fff;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-family: monospace;
            white-space: nowrap;
            pointer-events: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          \`;
          tooltip.textContent = info.selector + ' (' + info.tagName + ')';
          document.body.appendChild(tooltip);

          const rect = element.getBoundingClientRect();
          tooltip.style.left = rect.right + 8 + 'px';
          tooltip.style.top = rect.top + 'px';
        }

        function hideTooltip() {
          if (tooltip) {
            tooltip.remove();
            tooltip = null;
          }
        }

        function startInspecting() {
          isInspecting = true;
          document.addEventListener('mouseover', onMouseOver, true);
          document.addEventListener('mouseout', onMouseOut, true);
          document.addEventListener('click', onClick, true);
          document.body.style.cursor = 'crosshair';
        }

        function stopInspecting() {
          isInspecting = false;
          document.removeEventListener('mouseover', onMouseOver, true);
          document.removeEventListener('mouseout', onMouseOut, true);
          document.removeEventListener('click', onClick, true);
          document.body.style.cursor = '';
          removeOverlay(highlightOverlay);
          removeOverlay(hoverOverlay);
          hideTooltip();
        }

        // Listen for commands from parent
        window.addEventListener('message', (event) => {
          if (event.data.type === 'highlight-element') {
            const { selector, action } = event.data.payload;
            const element = document.querySelector(selector);
            if (element) {
              const info = getElementInfo(element);
              if (action === 'select') {
                if (!highlightOverlay) highlightOverlay = createOverlay('infinity-select-overlay');
                highlightOverlay.style.borderColor = '#22c55e';
                highlightOverlay.style.background = 'rgba(34, 197, 94, 0.15)';
                updateOverlay(highlightOverlay, info);
              } else if (action === 'unselect') {
                removeOverlay(highlightOverlay);
              }
            }
          } else if (event.data.type === 'start-inspect') {
            startInspecting();
          } else if (event.data.type === 'stop-inspect') {
            stopInspecting();
          }
        });

        // Notify parent that DOM is ready
        window.parent.postMessage({ type: 'dom-ready', payload: null }, '*');
      })();
    `;

    iframeRef.current.contentWindow.postMessage({
      type: 'inject-script',
      payload: script,
    }, '*');
  }, [iframeRef]);

  const startInspecting = useCallback(() => {
    setIsInspecting(true);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'start-inspect' }, '*');
    }
  }, [iframeRef]);

  const stopInspecting = useCallback(() => {
    setIsInspecting(false);
    setHoveredElement(null);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'stop-inspect' }, '*');
    }
  }, [iframeRef]);

  const handleClearSelection = useCallback(() => {
    onSelectElement(null);
    setElementStack([]);
    stopInspecting();
  }, [onSelectElement, stopInspecting]);

  const handleNavigateStack = useCallback((direction: 'up' | 'down') => {
    if (elementStack.length === 0) return;

    let index = elementStack.length - 1;
    if (direction === 'up' && index > 0) index--;
    else if (direction === 'down' && index < elementStack.length - 1) index++;

    const element = elementStack[index];
    onSelectElement(element);

    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'highlight-element',
        payload: { selector: element.selector, action: 'select' },
      }, '*');
    }
  }, [elementStack, onSelectElement, iframeRef]);

  // Drag-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = elementStack.findIndex(el => el.selector === active.id);
      const newIndex = elementStack.findIndex(el => el.selector === over?.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newStack = [...elementStack];
        const [moved] = newStack.splice(oldIndex, 1);
        newStack.splice(newIndex, 0, moved);
        setElementStack(newStack);

        // Notify iframe to reorder elements
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({
            type: 'reorder-elements',
            payload: { fromIndex: oldIndex, toIndex: newIndex },
          }, '*');
        }
      }
    }
  }, [elementStack, iframeRef]);

  const SortableItem = ({ element, index }: { element: SelectedElement; index: number }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: element.selector });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'p-2 rounded border border-border bg-muted/30 flex items-center gap-2 cursor-grab active:cursor-grabbing',
          index === elementStack.length - 1 && 'ring-1 ring-primary',
          isDragging && 'shadow-lg ring-2 ring-primary'
        )}
      >
        <button {...attributes} {...listeners} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Drag to reorder">
          <GripVertical className="w-4 h-4" />
        </button>
        <code className="text-sm font-mono text-foreground flex-1">{element.tagName}</code>
        {element.className && (
          <Badge variant="secondary" className="text-xs font-mono">
            .{element.className.split(' ').join(' .')}
          </Badge>
        )}
        {element.id && (
          <Badge variant="outline" className="text-xs font-mono">
            #{element.id}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          Depth: {element.depth}
        </span>
      </div>
    );
  };

  return (
    <div className={cn('p-3 border-b border-border bg-background/95 backdrop-blur', className)}>
      {/* Inspector Toolbar */}
      <div className="flex items-center gap-2 mb-2">
        <Button
          variant={isInspecting ? 'default' : 'outline'}
          size="sm"
          onClick={isInspecting ? stopInspecting : startInspecting}
          className="flex-1"
        >
          {isInspecting ? (
            <>
              <Target className="w-3.5 h-3.5 mr-1.5 animate-pulse" />
              Inspecting...
            </>
          ) : (
            <>
              <MousePointer className="w-3.5 h-3.5 mr-1.5" />
              Inspect
            </>
          )}
        </Button>

        {isInspecting && (
          <Button variant="ghost" size="sm" onClick={stopInspecting} title="Stop inspecting (Esc)">
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* Element Stack / Breadcrumb */}
      {(elementStack.length > 0 || hoveredElement) && (
        <div className="mb-2">
          <div className="flex items-center gap-1 text-xs mb-1">
            <Code className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Element Path</span>
            {elementStack.length > 1 && (
              <div className="flex items-center gap-1 ml-auto">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleNavigateStack('up')}
                  disabled={elementStack.length <= 1}
                  title="Parent element"
                >
                  <ChevronUp className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleNavigateStack('down')}
                  disabled={elementStack.length <= 1}
                  title="Child element"
                >
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={elementStack.map(el => el.selector)} strategy={verticalListSortingStrategy}>
                {elementStack.map((el, i) => (
                  <SortableItem key={el.selector} element={el} index={i} />
                ))}
              </SortableContext>
              <DragOverlay>
                {(({ activatorEvent, active }: any) => {
                  if (!activatorEvent || !active) return null;
                  const element = elementStack.find(el => el.selector === active.id);
                  if (!element) return null;
                  const transform = activatorEvent?.transform
                    ? CSS.Transform.toString(activatorEvent.transform)
                    : undefined;
                  return (
                    <div
                      style={{
                        transform,
                        opacity: 0.9,
                      }}
                      className="p-2 rounded border border-primary bg-primary/10 shadow-lg flex items-center gap-2 cursor-grabbing z-50"
                    >
                      <GripVertical className="w-4 h-4 text-primary" />
                      <code className="text-sm font-mono text-foreground">{element.tagName}</code>
                      {element.className && (
                        <Badge variant="secondary" className="text-xs font-mono">
                          .{element.className.split(' ').join(' .')}
                        </Badge>
                      )}
                    </div>
                  );
                }) as any}
              </DragOverlay>
            </DndContext>
            {hoveredElement && elementStack.length === 0 && (
              <Badge variant="secondary" className="text-xs font-mono px-2 py-0.5 opacity-60">
                {hoveredElement.tagName}
                {hoveredElement.className && <span className="ml-1">.{hoveredElement.className.split(' ')[0]}</span>}
                <span className="ml-1 opacity-50">(hover)</span>
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Selected Element Details */}
      {elementStack.length > 0 && (
        <div className="space-y-2">
          <Separator />

          {elementStack.map((el, i) => (
            <div key={i} className={cn('p-2 rounded border border-border bg-muted/30', i === elementStack.length - 1 && 'ring-1 ring-primary')}>
              <div className="flex items-center gap-2 mb-1">
                <code className="text-sm font-mono text-foreground">{el.tagName}</code>
                {el.className && (
                  <Badge variant="secondary" className="text-xs font-mono">
                    .{el.className.split(' ').join(' .')}
                  </Badge>
                )}
                {el.id && (
                  <Badge variant="outline" className="text-xs font-mono">
                    #{el.id}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  Depth: {el.depth} | Children: {el.children}
                </span>
              </div>

              <div className="text-xs text-muted-foreground font-mono truncate">
                Selector: {el.selector}
              </div>

              <div className="text-xs text-muted-foreground font-mono truncate">
                XPath: {el.xpath}
              </div>

              {el.bounds && (
                <div className="text-xs text-muted-foreground">
                  Position: {Math.round(el.bounds.x)}, {Math.round(el.bounds.y)} | Size: {Math.round(el.bounds.width)}×{Math.round(el.bounds.height)}
                </div>
              )}
            </div>
          ))}

          <Button variant="outline" size="sm" className="w-full" onClick={handleClearSelection}>
            <X className="w-3.5 h-3.5 mr-1.5" />
            Clear Selection
          </Button>
        </div>
      )}

      {/* Keyboard hint */}
      {isInspecting && (
        <div className="mt-3 p-2 bg-primary/5 border border-primary/20 rounded text-xs text-primary">
          <kbd className="px-1.5 py-0.5 bg-background rounded border border-border mr-1">Esc</kbd> to stop |
          <kbd className="px-1.5 py-0.5 bg-background rounded border border-border mx-1">Click</kbd> to select |
          <kbd className="px-1.5 py-0.5 bg-background rounded border border-border mx-1">↑/↓</kbd> to navigate
        </div>
      )}
    </div>
  );
};

/**
 * Hook for using visual inspector with LivePreview
 */
export function useVisualInspector(iframeRef: React.RefObject<HTMLIFrameElement>) {
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [hoveredElement, setHoveredElement] = useState<SelectedElement | null>(null);

  const handleSelect = useCallback((element: SelectedElement | null) => {
    setSelectedElement(element);
  }, []);

  return {
    selectedElement,
    hoveredElement,
    onSelectElement: handleSelect,
    inspectorProps: {
      iframeRef,
      onSelectElement: handleSelect,
      codeSelectedElement: selectedElement,
    } as VisualInspectorProps,
  };
}

export default VisualInspector;