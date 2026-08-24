/**
 * DesignCanvas.tsx — Infinite Design Canvas with Code Connection
 *
 * An infinite zoom/pan canvas with layers (like Figma but code-connected).
 * Supports live preview of running apps, direct manipulation, multi-select,
 * responsive overrides, and multiple artifact types.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ZoomIn, ZoomOut, Maximize, MousePointer2, Hand, Square, Type, Image, Code2, Layers, Undo2, Redo2, Smartphone, Tablet, Monitor } from 'lucide-react';
import type { Layer, ArtifactType, Transform, CanvasEvent } from '@/lib/design-canvas-engine';
import type { DesignCanvasEngine } from '@/lib/design-canvas-engine';

interface DesignCanvasProps {
  engine: DesignCanvasEngine;
  onLayerSelect?: (layerId: string | null) => void;
  onLayerUpdate?: (layerId: string, changes: Partial<Layer>) => void;
  compact?: boolean;
}

type Tool = 'select' | 'pan' | 'rect' | 'text' | 'image' | 'iframe';

export function DesignCanvas({ engine, onLayerSelect, onLayerUpdate, compact = false }: DesignCanvasProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [viewport, setViewport] = useState<Transform>(engine.getViewport());
  const [layers, setLayers] = useState<Layer[]>(engine.getLayers());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; viewport: Transform } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Subscribe to engine events
  useEffect(() => {
    const unsub = engine.on((event: CanvasEvent) => {
      if (event.type === 'viewport:changed') {
        setViewport(event.viewport);
      } else if (event.type === 'layer:created' || event.type === 'layer:updated' || event.type === 'layer:deleted') {
        setLayers(engine.getLayers());
      } else if (event.type === 'selection:changed') {
        const sel = Array.from(event.selection)[0] ?? null;
        setSelectedId(sel);
        onLayerSelect?.(sel);
      }
    });
    return unsub;
  }, [engine, onLayerSelect]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || tool === 'pan') {
      // Pan mode
      setPanning(true);
      setDragStart({ x: e.clientX, y: e.clientY, viewport });
      return;
    }

    if (tool === 'select') {
      const target = e.currentTarget as HTMLElement;
      const layerEl = target.closest('[data-layer-id]') as HTMLElement | null;
      if (layerEl) {
        const layerId = layerEl.dataset.layerId!;
        engine.selectLayer(layerId, e.shiftKey);
        setDragging(layerId);
        setDragStart({ x: e.clientX, y: e.clientY, viewport });
      } else {
        // Start selection box
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          setSelectionBox({ x, y, w: 0, h: 0 });
          setDragStart({ x: e.clientX, y: e.clientY, viewport });
        }
      }
    } else {
      // Create new element
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const x = (e.clientX - rect.left - viewport.translateX) / viewport.scale;
        const y = (e.clientY - rect.top - viewport.translateY) / viewport.scale;
        createLayer(tool, x, y);
      }
    }
  }, [tool, viewport, engine]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (panning && dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      engine.setViewport({
        translateX: dragStart.viewport.translateX + dx,
        translateY: dragStart.viewport.translateY + dy,
      });
    } else if (dragging && dragStart) {
      const dx = (e.clientX - dragStart.x) / viewport.scale;
      const dy = (e.clientY - dragStart.y) / viewport.scale;
      const layer = engine.getLayer(dragging);
      if (layer) {
        engine.updateLayer(dragging, {
          bounds: {
            ...layer.bounds,
            x: layer.bounds.x + dx,
            y: layer.bounds.y + dy,
          }
        });
        onLayerUpdate?.(dragging, engine.getLayer(dragging)!);
      }
    } else if (selectionBox && dragStart) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setSelectionBox({
          x: selectionBox.x,
          y: selectionBox.y,
          w: x - selectionBox.x,
          h: y - selectionBox.y,
        });
        updateSelectionFromBox(selectionBox.x, selectionBox.y, x - selectionBox.x, y - selectionBox.y);
      }
    }
  }, [panning, dragging, dragStart, viewport, engine, selectionBox, onLayerUpdate]);

  const handleMouseUp = useCallback(() => {
    setPanning(false);
    setDragging(null);
    setSelectionBox(null);
    setDragStart(null);
  }, []);

  const createLayer = (tool: Tool, x: number, y: number) => {
    const id = `${tool}-${Date.now()}`;
    const defaultSize = tool === 'text' ? { width: 200, height: 40 } : { width: 160, height: 120 };

    engine.createLayer({
      id,
      name: `${tool.charAt(0).toUpperCase()}${tool.slice(1)} ${engine.getLayers().length + 1}`,
      type: tool === 'iframe' ? 'iframe' : tool as any,
      bounds: { x, y, ...defaultSize },
      opacity: 1,
      visible: true,
      locked: false,
      parentId: null,
      props: tool === 'text' ? { text: 'Text', fontSize: 16 } : {},
    });
  };

  const updateSelectionFromBox = (x: number, y: number, w: number, h: number) => {
    const boxLeft = Math.min(x, x + w);
    const boxRight = Math.max(x, x + w);
    const boxTop = Math.min(y, y + h);
    const boxBottom = Math.max(y, y + h);

    engine.clearSelection();
    for (const layer of engine.getLayers()) {
      const layerLeft = layer.bounds.x * viewport.scale + viewport.translateX;
      const layerRight = (layer.bounds.x + layer.bounds.width) * viewport.scale + viewport.translateX;
      const layerTop = layer.bounds.y * viewport.scale + viewport.translateY;
      const layerBottom = (layer.bounds.y + layer.bounds.height) * viewport.scale + viewport.translateY;

      if (layerLeft >= boxLeft && layerRight <= boxRight && layerTop >= boxTop && layerBottom <= boxBottom) {
        engine.selectLayer(layer.id, true);
      }
    }
  };

  const zoom = (factor: number) => {
    const newScale = Math.min(4, Math.max(0.1, viewport.scale * factor));
    engine.setViewport({ scale: newScale });
  };

  const zoomToFit = () => {
    engine.zoomToFit();
  };

  return (
    <div className={`design-canvas ${compact ? 'compact' : ''}`}>
      {/* Toolbar */}
      <div className="canvas-toolbar">
        <div className="tool-group">
          <button
            className={tool === 'select' ? 'active' : ''}
            onClick={() => setTool('select')}
            title={t('design.tools.select')}
          >
            <MousePointer2 size={16} />
          </button>
          <button
            className={tool === 'pan' ? 'active' : ''}
            onClick={() => setTool('pan')}
            title={t('design.tools.pan')}
          >
            <Hand size={16} />
          </button>
        </div>

        <div className="tool-divider" />

        <div className="tool-group">
          <button
            className={tool === 'rect' ? 'active' : ''}
            onClick={() => setTool('rect')}
            title={t('design.tools.rect')}
          >
            <Square size={16} />
          </button>
          <button
            className={tool === 'text' ? 'active' : ''}
            onClick={() => setTool('text')}
            title={t('design.tools.text')}
          >
            <Type size={16} />
          </button>
          <button
            className={tool === 'image' ? 'active' : ''}
            onClick={() => setTool('image')}
            title={t('design.tools.image')}
          >
            <Image size={16} />
          </button>
          <button
            className={tool === 'iframe' ? 'active' : ''}
            onClick={() => setTool('iframe')}
            title={t('design.tools.iframe')}
          >
            <Code2 size={16} />
          </button>
        </div>

        <div className="tool-divider" />

        <div className="tool-group">
          <button onClick={() => engine.undo()} title={t('design.tools.undo')}>
            <Undo2 size={16} />
          </button>
          <button onClick={() => engine.redo()} title={t('design.tools.redo')}>
            <Redo2 size={16} />
          </button>
        </div>

        <div className="tool-divider" />

        <div className="tool-group">
          <button onClick={() => zoom(1.2)} title={t('design.tools.zoomIn')}>
            <ZoomIn size={16} />
          </button>
          <span className="zoom-label">{Math.round(viewport.scale * 100)}%</span>
          <button onClick={() => zoom(0.8)} title={t('design.tools.zoomOut')}>
            <ZoomOut size={16} />
          </button>
          <button onClick={zoomToFit} title={t('design.tools.zoomToFit')}>
            <Maximize size={16} />
          </button>
        </div>

        <div className="tool-divider" />

        <div className="tool-group">
          <button onClick={() => engine.setBreakpoint('xs')} className={engine.getCurrentBreakpoint() === 'xs' ? 'active' : ''}>
            <Smartphone size={14} />
          </button>
          <button onClick={() => engine.setBreakpoint('md')} className={engine.getCurrentBreakpoint() === 'md' ? 'active' : ''}>
            <Tablet size={14} />
          </button>
          <button onClick={() => engine.setBreakpoint('lg')} className={engine.getCurrentBreakpoint() === 'lg' ? 'active' : ''}>
            <Monitor size={14} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="canvas-viewport"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: tool === 'pan' || panning ? 'grab' : 'default' }}
      >
        <div
          className="canvas-world"
          style={{
            transform: `translate(${viewport.translateX}px, ${viewport.translateY}px) scale(${viewport.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {layers.map(layer => (
            <LayerView
              key={layer.id}
              layer={layer}
              selected={selectedId === layer.id}
              onUpdate={(changes) => {
                engine.updateLayer(layer.id, changes);
                onLayerUpdate?.(layer.id, changes);
              }}
            />
          ))}
        </div>

        {selectionBox && (
          <div
            className="selection-box"
            style={{
              left: selectionBox.x,
              top: selectionBox.y,
              width: selectionBox.w,
              height: selectionBox.h,
            }}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="canvas-statusbar">
        <span className="status-item">
          <Layers size={12} /> {layers.length} {t('design.layers')}
        </span>
        <span className="status-item">
          {t('design.viewport')}: {Math.round(viewport.scale * 100)}%
        </span>
        <span className="status-item">
          {t('design.breakpoint')}: {engine.getCurrentBreakpoint()}
        </span>
      </div>
    </div>
  );
}

interface LayerViewProps {
  layer: Layer;
  selected: boolean;
  onUpdate: (changes: Partial<Layer>) => void;
}

function LayerView({ layer, selected, onUpdate }: LayerViewProps) {
  if (!layer.visible) return null;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: layer.bounds.x,
    top: layer.bounds.y,
    width: layer.bounds.width,
    height: layer.bounds.height,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
    border: selected ? '2px solid var(--primary)' : '1px solid transparent',
    pointerEvents: layer.locked ? 'none' : 'auto',
  };

  switch (layer.type) {
    case 'text':
      return (
        <div
          data-layer-id={layer.id}
          style={{
            ...style,
            display: 'flex',
            alignItems: 'center',
            fontSize: layer.props?.fontSize || 16,
            color: layer.props?.color || '#1a1a1a',
          }}
        >
          {layer.props?.text || 'Text'}
        </div>
      );

    case 'iframe':
      return (
        <div data-layer-id={layer.id} style={style}>
          {layer.props?.src ? (
            <iframe
              src={layer.props.src}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title={layer.name}
            />
          ) : (
            <div className="iframe-placeholder">
              <Code2 size={24} />
              <span>{layer.props?.component || 'Live Preview'}</span>
            </div>
          )}
        </div>
      );

    case 'image':
      return (
        <div data-layer-id={layer.id} style={style}>
          {layer.props?.src ? (
            <img src={layer.props.src} alt={layer.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div className="image-placeholder">
              <Image size={24} />
            </div>
          )}
        </div>
      );

    default:
      return (
        <div
          data-layer-id={layer.id}
          style={{
            ...style,
            backgroundColor: layer.props?.backgroundColor || '#e5e7eb',
            borderRadius: layer.props?.borderRadius || 0,
          }}
        />
      );
  }
}

export default DesignCanvas;