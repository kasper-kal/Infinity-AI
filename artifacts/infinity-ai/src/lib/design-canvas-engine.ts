/**
 * Frontend Design Canvas Engine Wrapper
 *
 * Provides a React-friendly interface to the design canvas engine.
 * Re-exports types and classes from the api-server design-canvas module.
 */

import { useRef, useEffect } from 'react';
import { DesignCanvasEngine, getDesignCanvas, createDesignCanvas } from '../../../api-server/src/lib/design-canvas';
import type { AmbientSuggestion, UserPreferences, DesignModelConfig } from '../../../api-server/src/lib/ambient-intelligence';

// Re-export types
export type {
  Layer,
  Transform,
  CanvasArtifact,
  DesignSystem,
  ArtifactType,
  CanvasEvent,
  DesignCanvasEngine as DesignCanvasEngineType,
} from '../../../api-server/src/lib/design-canvas';

export type { AmbientSuggestion, UserPreferences, DesignModelConfig } from '../../../api-server/src/lib/ambient-intelligence';

// Re-export the engine class and functions
export { DesignCanvasEngine, getDesignCanvas, createDesignCanvas };

// Create a singleton instance
let canvasInstance: DesignCanvasEngine | null = null;

export function getCanvasEngine(): DesignCanvasEngine {
  if (!canvasInstance) {
    canvasInstance = new DesignCanvasEngine();
  }
  return canvasInstance;
}

export function createCanvasEngine(): DesignCanvasEngine {
  return new DesignCanvasEngine();
}

// React hook for using the canvas engine
export function useCanvasEngine(): DesignCanvasEngine {
  const engineRef = useRef<DesignCanvasEngine | null>(null);

  useEffect(() => {
    engineRef.current = getCanvasEngine();
    return () => {
      // Cleanup if needed
    };
  }, []);

  return engineRef.current!;
}