/**
 * Frontend Design Canvas Engine Wrapper
 *
 * Provides a React-friendly interface to the design canvas engine.
 * Re-exports types and classes from the api-server design-canvas module.
 */

// Re-export types
export type {
  Layer,
  Transform,
  CanvasArtifact,
  DesignSystem,
  ArtifactType,
  CanvasEvent,
} from '../../../api-server/src/lib/design-canvas';

// Re-export the engine class
export { DesignCanvasEngine } from '../../../api-server/src/lib/design-canvas';

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
import { useRef, useEffect } from 'react';

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