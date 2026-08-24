/**
 * Design Canvas Engine — Infinite Canvas with Code Connection
 *
 * Provides an infinite zoom/pan canvas with layers (like Figma but code-connected).
 * Supports live preview of running apps, direct manipulation, multi-select,
 * responsive overrides, and multiple artifact types.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  scale: number;
  translateX: number;
  translateY: number;
}

export type ArtifactType =
  | 'website-page'
  | 'web-app-screen'
  | 'mobile-app-screen'
  | 'slide'
  | 'doc';

export interface Layer {
  id: string;
  name: string;
  type: 'frame' | 'group' | 'component' | 'text' | 'shape' | 'image' | 'iframe' | 'code';
  bounds: Bounds;
  transform?: Transform;
  opacity: number;
  visible: boolean;
  locked: boolean;
  parentId: string | null;
  children: string[];
  zIndex: number;
  // Type-specific properties
  props?: Record<string, any>;
  // Code connection
  codeFile?: string;
  codeComponent?: string;
  // Responsive overrides
  responsiveOverrides?: ResponsiveOverride[];
}

export interface ResponsiveOverride {
  breakpoint: string; // e.g., 'sm', 'md', 'lg', 'xl'
  bounds?: Partial<Bounds>;
  props?: Record<string, any>;
  styles?: Record<string, string>;
}

export interface CanvasState {
  layers: Map<string, Layer>;
  selection: Set<string>;
  viewport: Transform;
  artifacts: Map<string, CanvasArtifact>;
  designSystem: DesignSystem | null;
  history: HistoryEntry[];
  historyIndex: number;
}

export interface CanvasArtifact {
  id: string;
  name: string;
  type: ArtifactType;
  rootLayerId: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  metadata?: Record<string, any>;
}

export interface DesignSystem {
  id: string;
  name: string;
  colors: DesignToken<string>[];
  typography: DesignToken<TypographyValue>[];
  spacing: DesignToken<number>[];
  components: DesignComponent[];
  borderRadius: DesignToken<number>[];
  shadows: DesignToken<string>[];
}

export interface DesignToken<T> {
  id: string;
  name: string;
  value: T;
  description?: string;
  category?: string;
}

export interface TypographyValue {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing?: number;
}

export interface DesignComponent {
  id: string;
  name: string;
  layerId: string; // Root layer of the component definition
  props: ComponentProp[];
  variants: ComponentVariant[];
}

export interface ComponentProp {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'color' | 'enum';
  defaultValue: any;
  description?: string;
  enumValues?: string[];
}

export interface ComponentVariant {
  name: string;
  props: Record<string, any>;
  layerId: string; // Variant-specific layer override
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  action: 'create' | 'update' | 'delete' | 'move' | 'resize' | 'reorder' | 'style';
  layerIds: string[];
  beforeState?: Partial<Layer>[];
  afterState?: Partial<Layer>[];
  description: string;
}

// ============================================================================
// Events
// ============================================================================

export type CanvasEvent =
  | { type: 'layer:created'; layer: Layer }
  | { type: 'layer:updated'; layerId: string; changes: Partial<Layer> }
  | { type: 'layer:deleted'; layerId: string }
  | { type: 'layer:moved'; layerId: string; delta: Point }
  | { type: 'layer:resized'; layerId: string; newBounds: Bounds }
  | { type: 'selection:changed'; selection: Set<string> }
  | { type: 'viewport:changed'; viewport: Transform }
  | { type: 'artifact:created'; artifact: CanvasArtifact }
  | { type: 'artifact:updated'; artifactId: string; changes: Partial<CanvasArtifact> }
  | { type: 'artifact:deleted'; artifactId: string }
  | { type: 'design-system:updated'; designSystem: DesignSystem }
  | { type: 'history:changed'; canUndo: boolean; canRedo: boolean }
  | { type: 'responsive:changed'; breakpoint: string }
  | { type: 'code:sync'; layerId: string; codeFile: string; component: string };

export type CanvasEventListener = (event: CanvasEvent) => void;

// ============================================================================
// Design Canvas Engine
// ============================================================================

export class DesignCanvasEngine extends EventEmitter {
  private state: CanvasState;
  private listeners: Set<CanvasEventListener> = new Set();
  private maxHistorySize = 100;
  private currentBreakpoint = 'lg';
  private breakpoints = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];

  constructor() {
    super();
    this.state = this.createInitialState();
  }

  private createInitialState(): CanvasState {
    return {
      layers: new Map(),
      selection: new Set(),
      viewport: { scale: 1, translateX: 0, translateY: 0 },
      artifacts: new Map(),
      designSystem: null,
      history: [],
      historyIndex: -1,
    };
  }

  // ---------------------------------------------------------------------------
  // Layer Operations
  // ---------------------------------------------------------------------------

  createLayer(layer: Omit<Layer, 'id' | 'children' | 'zIndex'> & { id?: string }): Layer {
    const newLayer: Layer = {
      ...layer,
      id: layer.id || this.generateId(),
      children: [],
      zIndex: this.getMaxZIndex() + 1,
    };

    this.state.layers.set(newLayer.id, newLayer);

    // Add to parent's children
    if (newLayer.parentId) {
      const parent = this.state.layers.get(newLayer.parentId);
      if (parent) {
        parent.children.push(newLayer.id);
      }
    }

    this.recordHistory('create', [newLayer.id], undefined, [{ ...newLayer }], `Created layer "${newLayer.name}"`);
    this.emitEvent({ type: 'layer:created', layer: newLayer });

    return newLayer;
  }

  updateLayer(layerId: string, changes: Partial<Layer>): Layer | null {
    const layer = this.state.layers.get(layerId);
    if (!layer) return null;

    const beforeState = { ...layer };
    const updatedLayer = { ...layer, ...changes };
    this.state.layers.set(layerId, updatedLayer);

    this.recordHistory('update', [layerId], [beforeState], [changes], `Updated layer "${layer.name}"`);
    this.emitEvent({ type: 'layer:updated', layerId, changes });

    return updatedLayer;
  }

  deleteLayer(layerId: string): boolean {
    const layer = this.state.layers.get(layerId);
    if (!layer) return false;

    // Remove from parent's children
    if (layer.parentId) {
      const parent = this.state.layers.get(layer.parentId);
      if (parent) {
        parent.children = parent.children.filter(id => id !== layerId);
      }
    }

    // Delete children recursively
    for (const childId of layer.children) {
      this.deleteLayer(childId);
    }

    this.state.layers.delete(layerId);
    this.state.selection.delete(layerId);

    this.recordHistory('delete', [layerId], [{ ...layer }], undefined, `Deleted layer "${layer.name}"`);
    this.emitEvent({ type: 'layer:deleted', layerId });

    return true;
  }

  moveLayer(layerId: string, delta: Point): Layer | null {
    const layer = this.state.layers.get(layerId);
    if (!layer) return null;

    const newBounds: Bounds = {
      ...layer.bounds,
      x: layer.bounds.x + delta.x,
      y: layer.bounds.y + delta.y,
    };

    return this.updateLayer(layerId, { bounds: newBounds });
  }

  resizeLayer(layerId: string, newBounds: Bounds): Layer | null {
    const layer = this.state.layers.get(layerId);
    if (!layer) return null;

    return this.updateLayer(layerId, { bounds: newBounds });
  }

  reorderLayer(layerId: string, newIndex: number): Layer | null {
    const layer = this.state.layers.get(layerId);
    if (!layer || !layer.parentId) return null;

    const parent = this.state.layers.get(layer.parentId);
    if (!parent) return null;

    const children = [...parent.children];
    const currentIndex = children.indexOf(layerId);
    if (currentIndex === -1) return null;

    children.splice(currentIndex, 1);
    children.splice(newIndex, 0, layerId);

    // Update z-index for all children
    children.forEach((childId, index) => {
      const child = this.state.layers.get(childId);
      if (child) {
        this.state.layers.set(childId, { ...child, zIndex: index });
      }
    });

    parent.children = children;
    this.recordHistory('reorder', [layerId], undefined, undefined, `Reordered layer "${layer.name}"`);

    return layer;
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  selectLayer(layerId: string, addToSelection = false): void {
    if (!addToSelection) {
      this.state.selection.clear();
    }
    if (this.state.layers.has(layerId)) {
      this.state.selection.add(layerId);
    }
    this.emitEvent({ type: 'selection:changed', selection: new Set(this.state.selection) });
  }

  deselectLayer(layerId: string): void {
    this.state.selection.delete(layerId);
    this.emitEvent({ type: 'selection:changed', selection: new Set(this.state.selection) });
  }

  clearSelection(): void {
    this.state.selection.clear();
    this.emitEvent({ type: 'selection:changed', selection: new Set(this.state.selection) });
  }

  selectAll(): void {
    for (const layerId of this.state.layers.keys()) {
      this.state.selection.add(layerId);
    }
    this.emitEvent({ type: 'selection:changed', selection: new Set(this.state.selection) });
  }

  getSelectedLayers(): Layer[] {
    return Array.from(this.state.selection).map(id => this.state.layers.get(id)!).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Viewport
  // ---------------------------------------------------------------------------

  setViewport(viewport: Partial<Transform>): void {
    this.state.viewport = { ...this.state.viewport, ...viewport };
    this.emitEvent({ type: 'viewport:changed', viewport: this.state.viewport });
  }

  getViewport(): Transform {
    return { ...this.state.viewport };
  }

  zoomToFit(layerIds?: string[]): void {
    const layers = layerIds
      ? layerIds.map(id => this.state.layers.get(id)).filter(Boolean) as Layer[]
      : Array.from(this.state.layers.values());

    if (layers.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const layer of layers) {
      minX = Math.min(minX, layer.bounds.x);
      minY = Math.min(minY, layer.bounds.y);
      maxX = Math.max(maxX, layer.bounds.x + layer.bounds.width);
      maxY = Math.max(maxY, layer.bounds.y + layer.bounds.height);
    }

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const padding = 50;

    // Assume canvas size (will be overridden by frontend)
    const canvasWidth = 1920;
    const canvasHeight = 1080;

    const scaleX = (canvasWidth - padding * 2) / contentWidth;
    const scaleY = (canvasHeight - padding * 2) / contentHeight;
    const scale = Math.min(scaleX, scaleY, 3); // Max 3x zoom

    this.setViewport({
      scale,
      translateX: -minX * scale + (canvasWidth - contentWidth * scale) / 2,
      translateY: -minY * scale + (canvasHeight - contentHeight * scale) / 2,
    });
  }

  // ---------------------------------------------------------------------------
  // Artifacts
  // ---------------------------------------------------------------------------

  createArtifact(artifact: Omit<CanvasArtifact, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): CanvasArtifact {
    const newArtifact: CanvasArtifact = {
      ...artifact,
      id: artifact.id || this.generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.state.artifacts.set(newArtifact.id, newArtifact);
    this.emitEvent({ type: 'artifact:created', artifact: newArtifact });

    return newArtifact;
  }

  updateArtifact(artifactId: string, changes: Partial<CanvasArtifact>): CanvasArtifact | null {
    const artifact = this.state.artifacts.get(artifactId);
    if (!artifact) return null;

    const updatedArtifact = { ...artifact, ...changes, updatedAt: Date.now() };
    this.state.artifacts.set(artifactId, updatedArtifact);
    this.emitEvent({ type: 'artifact:updated', artifactId, changes });

    return updatedArtifact;
  }

  deleteArtifact(artifactId: string): boolean {
    const artifact = this.state.artifacts.get(artifactId);
    if (!artifact) return false;

    // Delete all layers belonging to this artifact
    for (const [layerId, layer] of this.state.layers) {
      // Check if layer belongs to this artifact (simplified - in reality would track artifact ownership)
      // For now, we'll just delete the artifact reference
    }

    this.state.artifacts.delete(artifactId);
    this.emitEvent({ type: 'artifact:deleted', artifactId });

    return true;
  }

  getArtifact(artifactId: string): CanvasArtifact | undefined {
    return this.state.artifacts.get(artifactId);
  }

  getAllArtifacts(): CanvasArtifact[] {
    return Array.from(this.state.artifacts.values());
  }

  // ---------------------------------------------------------------------------
  // Design System
  // ---------------------------------------------------------------------------

  setDesignSystem(designSystem: DesignSystem): void {
    this.state.designSystem = designSystem;
    this.emitEvent({ type: 'design-system:updated', designSystem });
  }

  getDesignSystem(): DesignSystem | null {
    return this.state.designSystem;
  }

  // ---------------------------------------------------------------------------
  // Responsive
  // ---------------------------------------------------------------------------

  setBreakpoint(breakpoint: string): void {
    if (!this.breakpoints.includes(breakpoint)) return;
    this.currentBreakpoint = breakpoint;
    this.emitEvent({ type: 'responsive:changed', breakpoint });
  }

  getCurrentBreakpoint(): string {
    return this.currentBreakpoint;
  }

  getBreakpoints(): string[] {
    return [...this.breakpoints];
  }

  applyResponsiveOverride(layerId: string, breakpoint: string, override: ResponsiveOverride): Layer | null {
    const layer = this.state.layers.get(layerId);
    if (!layer) return null;

    const overrides = layer.responsiveOverrides || [];
    const existingIndex = overrides.findIndex(o => o.breakpoint === breakpoint);

    if (existingIndex >= 0) {
      overrides[existingIndex] = { ...overrides[existingIndex], ...override };
    } else {
      overrides.push({ breakpoint, ...override });
    }

    return this.updateLayer(layerId, { responsiveOverrides: overrides });
  }

  // ---------------------------------------------------------------------------
  // Code Connection
  // ---------------------------------------------------------------------------

  connectToCode(layerId: string, codeFile: string, component: string): Layer | null {
    const layer = this.state.layers.get(layerId);
    if (!layer) return null;

    const updated = this.updateLayer(layerId, { codeFile, codeComponent: component });
    if (updated) {
      this.emitEvent({ type: 'code:sync', layerId, codeFile, component });
    }
    return updated;
  }

  // ---------------------------------------------------------------------------
  // History (Undo/Redo)
  // ---------------------------------------------------------------------------

  private recordHistory(
    action: HistoryEntry['action'],
    layerIds: string[],
    beforeState?: Partial<Layer>[],
    afterState?: Partial<Layer>[],
    description = ''
  ): void {
    // Truncate history after current index
    this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);

    const entry: HistoryEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      action,
      layerIds,
      beforeState,
      afterState,
      description,
    };

    this.state.history.push(entry);
    this.state.historyIndex = this.state.history.length - 1;

    // Limit history size
    if (this.state.history.length > this.maxHistorySize) {
      this.state.history.shift();
      this.state.historyIndex--;
    }

    this.emitEvent({
      type: 'history:changed',
      canUndo: this.state.historyIndex >= 0,
      canRedo: this.state.historyIndex < this.state.history.length - 1
    });
  }

  undo(): boolean {
    if (this.state.historyIndex < 0) return false;

    const entry = this.state.history[this.state.historyIndex];

    switch (entry.action) {
      case 'create':
        // Delete created layers
        for (const layerId of entry.layerIds) {
          this.state.layers.delete(layerId);
        }
        break;
      case 'delete':
        // Restore deleted layers
        if (entry.beforeState) {
          for (const layerData of entry.beforeState) {
            this.state.layers.set(layerData.id!, layerData as Layer);
          }
        }
        break;
      case 'update':
        // Restore previous state
        if (entry.beforeState) {
          for (const layerData of entry.beforeState) {
            const layer = this.state.layers.get(layerData.id!);
            if (layer) {
              this.state.layers.set(layerData.id!, { ...layer, ...layerData });
            }
          }
        }
        break;
      case 'move':
      case 'resize':
        // Restore previous bounds
        if (entry.beforeState) {
          for (const layerData of entry.beforeState) {
            const layer = this.state.layers.get(layerData.id!);
            if (layer && layerData.bounds) {
              this.state.layers.set(layerData.id!, { ...layer, bounds: layerData.bounds });
            }
          }
        }
        break;
    }

    this.state.historyIndex--;
    this.emitEvent({
      type: 'history:changed',
      canUndo: this.state.historyIndex >= 0,
      canRedo: true
    });

    return true;
  }

  redo(): boolean {
    if (this.state.historyIndex >= this.state.history.length - 1) return false;

    this.state.historyIndex++;
    const entry = this.state.history[this.state.historyIndex];

    switch (entry.action) {
      case 'create':
        // Re-create layers
        if (entry.afterState) {
          for (const layerData of entry.afterState) {
            this.state.layers.set(layerData.id!, layerData as Layer);
          }
        }
        break;
      case 'delete':
        // Re-delete layers
        for (const layerId of entry.layerIds) {
          this.state.layers.delete(layerId);
        }
        break;
      case 'update':
        // Re-apply changes
        if (entry.afterState) {
          for (const layerData of entry.afterState) {
            const layer = this.state.layers.get(layerData.id!);
            if (layer) {
              this.state.layers.set(layerData.id!, { ...layer, ...layerData });
            }
          }
        }
        break;
      case 'move':
      case 'resize':
        // Re-apply bounds
        if (entry.afterState) {
          for (const layerData of entry.afterState) {
            const layer = this.state.layers.get(layerData.id!);
            if (layer && layerData.bounds) {
              this.state.layers.set(layerData.id!, { ...layer, bounds: layerData.bounds });
            }
          }
        }
        break;
    }

    this.emitEvent({
      type: 'history:changed',
      canUndo: true,
      canRedo: this.state.historyIndex < this.state.history.length - 1
    });

    return true;
  }

  canUndo(): boolean {
    return this.state.historyIndex >= 0;
  }

  canRedo(): boolean {
    return this.state.historyIndex < this.state.history.length - 1;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  serialize(): string {
    const data = {
      layers: Array.from(this.state.layers.entries()),
      selection: Array.from(this.state.selection),
      viewport: this.state.viewport,
      artifacts: Array.from(this.state.artifacts.entries()),
      designSystem: this.state.designSystem,
      currentBreakpoint: this.currentBreakpoint,
    };
    return JSON.stringify(data, null, 2);
  }

  deserialize(json: string): void {
    const data = JSON.parse(json);

    this.state.layers = new Map(data.layers);
    this.state.selection = new Set(data.selection);
    this.state.viewport = data.viewport || { scale: 1, translateX: 0, translateY: 0 };
    this.state.artifacts = new Map(data.artifacts);
    this.state.designSystem = data.designSystem;
    this.currentBreakpoint = data.currentBreakpoint || 'lg';
    this.state.history = [];
    this.state.historyIndex = -1;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private getMaxZIndex(): number {
    let max = 0;
    for (const layer of this.state.layers.values()) {
      max = Math.max(max, layer.zIndex);
    }
    return max;
  }

  private emitEvent(event: CanvasEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Canvas event listener error:', error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------

  on(event: CanvasEventListener): () => void {
    this.listeners.add(event);
    return () => this.listeners.delete(event);
  }

  // ---------------------------------------------------------------------------
  // State Access
  // ---------------------------------------------------------------------------

  getLayers(): Layer[] {
    return Array.from(this.state.layers.values());
  }

  getLayer(layerId: string): Layer | undefined {
    return this.state.layers.get(layerId);
  }

  getState(): Readonly<CanvasState> {
    return this.state;
  }
}

// ============================================================================
// Factory
// ============================================================================

let canvasInstance: DesignCanvasEngine | null = null;

export function getDesignCanvas(): DesignCanvasEngine {
  if (!canvasInstance) {
    canvasInstance = new DesignCanvasEngine();
  }
  return canvasInstance;
}

export function createDesignCanvas(): DesignCanvasEngine {
  return new DesignCanvasEngine();
}