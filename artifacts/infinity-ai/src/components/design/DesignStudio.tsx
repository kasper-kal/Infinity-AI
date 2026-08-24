/**
 * DesignStudio.tsx — Main Design Studio View
 *
 * Integrates infinite canvas, ambient intelligence, Mobbin sidebar,
 * design system panel, and template picker into a cohesive design environment.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, Palette, Hash, Layout, Sparkles, X, ChevronLeft, ChevronRight, Menu, Settings, Save, Share2, Download, Upload, Eye, Code2, Zap, EyeOff, Lock, Unlock, Box, Type, Square, Image, Monitor, Check, X as XIcon, Cpu, Sparkle } from 'lucide-react';
import { DesignCanvas } from './DesignCanvas';
import { DesignSystemPanel } from './DesignSystemPanel';
import { MobbinSidebar } from './MobbinSidebar';
import { TemplatePicker } from './TemplatePicker';
import type { DesignCanvasEngine, CanvasEvent } from '@/lib/design-canvas-engine';
import { getCanvasEngine } from '@/lib/design-canvas-engine';
import type { MobbinClient } from '@/lib/mobbin-client';
import { getMobbinClient } from '@/lib/mobbin-client';
import { useAmbientSSE } from '@/hooks/use-ambient-sse';
import type { AmbientSuggestion, DesignModelConfig } from '@/lib/design-canvas-engine';

interface DesignStudioProps {
  projectId?: string;
  open?: boolean;
  onClose?: () => void;
  initialImage?: string | null;
}

export function DesignStudio({ projectId, open, onClose, initialImage }: DesignStudioProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [activeSidebar, setActiveSidebar] = useState<'layers' | 'mobbin' | 'templates' | 'ambient' | null>('layers');
  const [showDesignSystem, setShowDesignSystem] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [canvasMode, setCanvasMode] = useState<'design' | 'preview' | 'code'>('design');

  // Ambient Intelligence SSE integration
  const {
    suggestions: ambientSuggestions,
    isConnected: ambientConnected,
    acceptSuggestion,
    rejectSuggestion,
    generateSuggestions,
    availableModels: ambientModels,
    selectedModel: ambientSelectedModel,
    setDesignModel,
  } = useAmbientSSE(projectId ?? null);

  // Initialize engines
  const canvasEngine = useRef<DesignCanvasEngine | null>(null);
  const mobbinClient = useRef<MobbinClient | null>(null);

  useEffect(() => {
    canvasEngine.current = getCanvasEngine();
    mobbinClient.current = getMobbinClient();
  }, []);

  const handleAddMobbinToCanvas = useCallback((screen: any) => {
    // Create an image layer on the canvas
    if (canvasEngine.current) {
      const layer = canvasEngine.current.createLayer({
        id: `mobbin-${screen.id}-${Date.now()}`,
        name: screen.screenName,
        type: 'image',
        bounds: { x: 100, y: 100, width: 400, height: 300 },
        opacity: 1,
        visible: true,
        locked: false,
        parentId: null,
        props: { src: screen.thumbnailUrl },
      });
      console.log('Added Mobbin screen to canvas:', layer.id);
    }
  }, []);

  const handleApplyTemplate = useCallback((template: any) => {
    // Apply template to canvas - create layers for each screen/component
    if (canvasEngine.current) {
      let yOffset = 100;
      for (const screen of template.screens) {
        canvasEngine.current.createLayer({
          id: `template-${template.id}-${screen.id}`,
          name: screen.name,
          type: 'frame',
          bounds: { x: 100, y: yOffset, width: 375, height: 667 },
          opacity: 1,
          visible: true,
          locked: false,
          parentId: null,
          props: { templateScreen: true, templateId: template.id },
        });
        yOffset += 400;
      }
      console.log('Applied template:', template.name);
    }
  }, []);

  const handlePreviewTemplate = useCallback((template: any) => {
    console.log('Preview template:', template.name);
    // Could open preview in new tab or modal
  }, []);

  const handleExportDesign = useCallback(() => {
    if (canvasEngine.current) {
      const data = canvasEngine.current.serialize();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `infinity-design-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, []);

  const handleImportDesign = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file && canvasEngine.current) {
        const reader = new FileReader();
        reader.onload = (event) => {
          canvasEngine.current?.deserialize(event.target?.result as string);
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, []);

  const toggleSidebar = useCallback((sidebar: 'layers' | 'mobbin' | 'templates' | 'ambient') => {
    setActiveSidebar(activeSidebar === sidebar ? null : sidebar);
  }, [activeSidebar]);

  return (
    <div className="design-studio">
      {/* Top Toolbar */}
      <header className="design-toolbar">
        <div className="toolbar-left">
          <button className="icon-btn" onClick={() => window.history.back()}>
            <ChevronLeft size={20} />
          </button>
          <button className="icon-btn" onClick={() => window.history.forward()}>
            <ChevronRight size={20} />
          </button>
          <div className="toolbar-divider" />
          <h1 className="toolbar-title">{t('design.studio.title')}</h1>
        </div>

        <div className="toolbar-center">
          <div className="mode-selector">
            <button
              className={canvasMode === 'design' ? 'active' : ''}
              onClick={() => setCanvasMode('design')}
              title={t('design.mode.design')}
            >
              <Layout size={16} />
            </button>
            <button
              className={canvasMode === 'preview' ? 'active' : ''}
              onClick={() => setCanvasMode('preview')}
              title={t('design.mode.preview')}
            >
              <Eye size={16} />
            </button>
            <button
              className={canvasMode === 'code' ? 'active' : ''}
              onClick={() => setCanvasMode('code')}
              title={t('design.mode.code')}
            >
              <Code2 size={16} />
            </button>
          </div>
        </div>

        <div className="toolbar-right">
          <button className="icon-btn" onClick={handleExportDesign} title={t('design.export')}>
            <Download size={20} />
          </button>
          <button className="icon-btn" onClick={handleImportDesign} title={t('design.import')}>
            <Upload size={20} />
          </button>
          <div className="toolbar-divider" />
          <button className="icon-btn" onClick={() => setShowDesignSystem(!showDesignSystem)} title={t('design.system.title')}>
            <Palette size={20} />
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(!showSettings)} title={t('common.settings')}>
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="design-main">
        {/* Left Sidebar - Layers */}
        <aside className={`design-sidebar left ${activeSidebar === 'layers' ? 'open' : ''} ${activeSidebar && activeSidebar !== 'layers' ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <h3>{t('design.layers')}</h3>
            <button className="icon-btn" onClick={() => toggleSidebar('layers')}>
              <X size={16} />
            </button>
          </div>
          <LayersPanel engine={canvasEngine.current!} />
        </aside>

        {/* Sidebar Toggle Buttons (when collapsed) */}
        <div className="sidebar-toggles left">
          <button
            className={`toggle-btn ${activeSidebar === 'layers' ? 'active' : ''}`}
            onClick={() => toggleSidebar('layers')}
            title={t('design.layers')}
          >
            <Layers size={20} />
          </button>
          <button
            className={`toggle-btn ${activeSidebar === 'mobbin' ? 'active' : ''}`}
            onClick={() => toggleSidebar('mobbin')}
            title={t('mobbin.title')}
          >
            <Hash size={20} />
          </button>
          <button
            className={`toggle-btn ${activeSidebar === 'templates' ? 'active' : ''}`}
            onClick={() => toggleSidebar('templates')}
            title={t('templates.title')}
          >
            <Layout size={20} />
          </button>
          <button
            className={`toggle-btn ${activeSidebar === 'ambient' ? 'active' : ''}`}
            onClick={() => toggleSidebar('ambient')}
            title={t('design.ambient.title')}
          >
            <Zap size={20} />
          </button>
        </div>

        {/* Canvas Area */}
        <main className="design-canvas-area">
          <DesignCanvas
            engine={canvasEngine.current!}
            onLayerSelect={(id) => console.log('Selected:', id)}
            onLayerUpdate={(id, changes) => console.log('Updated:', id, changes)}
          />
        </main>

        {/* Right Sidebar - Mobbin / Templates / Ambient */}
        <aside className={`design-sidebar right ${activeSidebar ? 'open' : ''}`}>
          {activeSidebar === 'mobbin' && mobbinClient.current && (
            <div className="sidebar-content">
              <div className="sidebar-header">
                <h3>{t('mobbin.title')}</h3>
                <button className="icon-btn" onClick={() => toggleSidebar('mobbin')}>
                  <X size={16} />
                </button>
              </div>
              <MobbinSidebar
                client={mobbinClient.current}
                onAddToCanvas={handleAddMobbinToCanvas}
              />
            </div>
          )}

          {activeSidebar === 'templates' && (
            <div className="sidebar-content">
              <div className="sidebar-header">
                <h3>{t('templates.title')}</h3>
                <button className="icon-btn" onClick={() => toggleSidebar('templates')}>
                  <X size={16} />
                </button>
              </div>
              <TemplatePicker
                onApplyTemplate={handleApplyTemplate}
                onPreviewTemplate={handlePreviewTemplate}
              />
            </div>
          )}

          {activeSidebar === 'ambient' && (
            <div className="sidebar-content">
              <div className="sidebar-header">
                <h3>{t('design.ambient.title')}</h3>
                <button className="icon-btn" onClick={() => toggleSidebar('ambient')}>
                  <X size={16} />
                </button>
              </div>
              <AmbientSuggestionsPanel
                suggestions={ambientSuggestions}
                isConnected={ambientConnected}
                onAccept={async (id) => { await acceptSuggestion(id, projectId!); }}
                onReject={async (id) => { await rejectSuggestion(id, projectId!); }}
                onGenerate={async () => { await generateSuggestions(projectId!); }}
                projectId={projectId}
                availableModels={ambientModels}
                selectedModel={ambientSelectedModel}
                onModelChange={async (modelId) => { await setDesignModel(modelId, projectId!); }}
              />
            </div>
          )}

          {activeSidebar === 'layers' && !showDesignSystem && (
            <div className="sidebar-content">
              <LayersPanel engine={canvasEngine.current!} />
            </div>
          )}

          {showDesignSystem && (
            <div className="sidebar-content design-system-sidebar">
              <div className="sidebar-header">
                <h3>{t('design.system.title')}</h3>
                <button className="icon-btn" onClick={() => setShowDesignSystem(false)}>
                  <X size={16} />
                </button>
              </div>
              <DesignSystemPanel
                designSystem={canvasEngine.current?.getDesignSystem() ?? { id: '', name: '', colors: [], typography: [], spacing: [], components: [] }}
                onUpdate={(changes) => {
                  const current = canvasEngine.current?.getDesignSystem();
                  if (current) {
                    canvasEngine.current?.setDesignSystem({ ...current, ...changes });
                  }
                }}
              />
            </div>
          )}
        </aside>
      </div>

      {/* Bottom Status Bar */}
      <footer className="design-statusbar">
        <div className="status-left">
          <span className="status-item">
            <Layers size={12} /> {canvasEngine.current?.getLayers().length || 0} {t('design.layers')}
          </span>
          <span className="status-item">
            {t('design.mode.current')}: {t(`design.mode.${canvasMode}`)}
          </span>
        </div>
        <div className="status-center">
          {ambientSuggestions.length > 0 && (
            <span className="status-item ambient">
              <Sparkles size={12} /> {ambientSuggestions.length} {t('design.ambient.suggestions')}
            </span>
          )}
        </div>
        <div className="status-right">
          <span className="status-item">
            {t('design.viewport.zoom')}: {Math.round((canvasEngine.current?.getViewport().scale || 1) * 100)}%
          </span>
          <span className="status-item">
            {t('design.breakpoint')}: {canvasEngine.current?.getCurrentBreakpoint() || 'lg'}
          </span>
        </div>
      </footer>
    </div>
  );
}

function LayersPanel({ engine }: { engine: DesignCanvasEngine }) {
  const { t } = useTranslation();
  const [layers, setLayers] = useState<ReturnType<DesignCanvasEngine['getLayers']>>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsub = engine.onCanvasEvent((event: CanvasEvent) => {
      if (event.type === 'layer:created' || event.type === 'layer:updated' || event.type === 'layer:deleted') {
        setLayers(engine.getLayers());
      } else if (event.type === 'selection:changed') {
        // Selection handled by parent
      }
    });
    setLayers(engine.getLayers());
    return unsub;
  }, [engine]);

  const rootLayers = layers.filter((l: any) => !l.parentId);

  const renderLayerTree = (layer: any, depth = 0) => {
    const hasChildren = layer.children && layer.children.length > 0;
    const isExpanded = expanded.has(layer.id);
    const selected = engine.getSelectedLayers().some((l: any) => l.id === layer.id);

    return (
      <div key={layer.id} className={`layer-tree-item ${selected ? 'selected' : ''}`} style={{ paddingLeft: depth * 16 }}>
        <div className="layer-row" onClick={() => engine.selectLayer(layer.id)}>
          {hasChildren && (
            <button className="expand-btn" onClick={(e) => { e.stopPropagation(); setExpanded(prev => { const n = new Set(prev); isExpanded ? n.delete(layer.id) : n.add(layer.id); return n; }); }}>
              <ChevronRight size={12} className={isExpanded ? 'expanded' : ''} />
            </button>
          )}
          <span className="layer-icon">
            {getLayerIcon(layer.type)}
          </span>
          <span className="layer-name" title={layer.name}>{layer.name}</span>
          <div className="layer-actions">
            <button className="icon-btn tiny" title={layer.visible ? t('common.hide') : t('common.show')} onClick={(e) => { e.stopPropagation(); engine.updateLayer(layer.id, { visible: !layer.visible }); }}>
              {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            <button className="icon-btn tiny" title={layer.locked ? t('common.unlock') : t('common.lock')} onClick={(e) => { e.stopPropagation(); engine.updateLayer(layer.id, { locked: !layer.locked }); }}>
              {layer.locked ? <Unlock size={12} /> : <Lock size={12} />}
            </button>
          </div>
        </div>
        {hasChildren && isExpanded && (
          <div className="layer-children">
            {layer.children.map((childId: string) => {
              const child = engine.getLayer(childId);
              return child ? renderLayerTree(child, depth + 1) : null;
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="layers-panel">
      {rootLayers.length === 0 ? (
        <div className="layers-empty">
          <Layers size={48} />
          <p>{t('design.layers.empty')}</p>
        </div>
      ) : (
        <div className="layers-tree">
          {rootLayers.map(layer => renderLayerTree(layer))}
        </div>
      )}
    </div>
  );
}

function getLayerIcon(type: string) {
  switch (type) {
    case 'frame': return <Layout size={14} />;
    case 'group': return <Layers size={14} />;
    case 'component': return <Box size={14} />;
    case 'text': return <Type size={14} />;
    case 'shape': return <Square size={14} />;
    case 'image': return <Image size={14} />;
    case 'iframe': return <Monitor size={14} />;
    case 'code': return <Code2 size={14} />;
    default: return <Square size={14} />;
  }
}

function AmbientSuggestionsPanel({
  suggestions,
  isConnected,
  onAccept,
  onReject,
  onGenerate,
  projectId,
  availableModels,
  selectedModel,
  onModelChange
}: {
  suggestions: any[];
  isConnected: boolean;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onGenerate: () => Promise<void>;
  projectId?: string;
  availableModels: DesignModelConfig[];
  selectedModel: string | null;
  onModelChange: (modelId: string | null) => void;
}) {
  const { t } = useTranslation();

  if (suggestions.length === 0) {
    return (
      <div className="ambient-empty">
        <Zap size={48} />
        <p>{t('design.ambient.noSuggestions')}</p>
        <p className="hint">{t('design.ambient.hint')}</p>
        {!isConnected && projectId && (
          <button className="btn primary mt-4" onClick={onGenerate}>
            {t('design.ambient.generate')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ambient-suggestions">
      {/* Model Selector */}
      {availableModels.length > 0 && (
        <div className="ambient-model-selector">
          <label className="model-selector-label">
            <Cpu size={14} /> {t('design.ambient.model')}
          </label>
          <select
            className="model-selector"
            value={selectedModel || ''}
            onChange={(e) => onModelChange(e.target.value || null)}
          >
            <option value="">{t('design.ambient.autoModel')}</option>
            {availableModels.map(model => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
          <p className="model-selector-hint">
            <Sparkle size={12} /> {t('design.ambient.modelHint')}
          </p>
        </div>
      )}

      {suggestions.map(suggestion => (
        <div key={suggestion.id} className="ambient-suggestion">
          <div className="suggestion-header">
            <span className="suggestion-type">{suggestion.type}</span>
            <span className="suggestion-confidence">{Math.round(suggestion.confidence * 100)}%</span>
          </div>
          <h4>{suggestion.title}</h4>
          <p>{suggestion.description}</p>
          <div className="suggestion-actions">
            <button className="btn primary" onClick={() => onAccept(suggestion.id)}>
              {t('design.ambient.accept')}
            </button>
            <button className="btn secondary" onClick={() => onReject(suggestion.id)}>
              {t('design.ambient.reject')}
            </button>
          </div>
        </div>
      ))}
      <button className="btn ghost mt-4" onClick={onGenerate}>
        <Zap size={14} /> {t('design.ambient.generateMore')}
      </button>
    </div>
  );
}

export default DesignStudio;