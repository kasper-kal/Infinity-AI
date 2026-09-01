/**
 * useDesignMode Hook
 *
 * Client-side hook for connecting to the Design Mode Engine.
 * Provides bidirectional sync between preview iframe and visual editor.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  InspectedElement,
  VisualPropertyChange,
  DesignTokens,
  ComponentRegistryEntry,
  VisualControlConfig,
} from "@/lib/design-mode";

interface UseDesignModeOptions {
  projectId?: string;
  previewRef: React.RefObject<HTMLIFrameElement>;
  onElementInspect?: (element: InspectedElement) => void;
  onElementSelect?: (element: InspectedElement | null) => void;
  onPropertyChange?: (change: VisualPropertyChange) => void;
}

interface UseDesignModeReturn {
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  applyPropertyChange: (change: VisualPropertyChange) => Promise<void>;
  fetchRegistry: () => Promise<ComponentRegistryEntry[]>;
  fetchTokens: () => Promise<DesignTokens>;
  registerElement: (element: InspectedElement) => void;
  selectedElement: InspectedElement | null;
  setSelectedElement: (el: InspectedElement | null) => void;
  hoveredElement: InspectedElement | null;
  setHoveredElement: (el: InspectedElement | null) => void;
  designTokens: DesignTokens;
  componentRegistry: ComponentRegistryEntry[];
  getVisualControlsForProp: (propName: string, propType: string) => VisualControlConfig | null;
}

export function useDesignMode(options: UseDesignModeOptions): UseDesignModeReturn {
  const { projectId, previewRef, onElementInspect, onElementSelect, onPropertyChange } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [designTokens, setDesignTokens] = useState<DesignTokens>({} as DesignTokens);
  const [componentRegistry, setComponentRegistry] = useState<ComponentRegistryEntry[]>([]);
  const [selectedElement, setSelectedElement] = useState<InspectedElement | null>(null);
  const [hoveredElement, setHoveredElement] = useState<InspectedElement | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);

  // Initialize session
  const connect = useCallback(async () => {
    if (!projectId) return;

    try {
      // Create design mode session via API
      const response = await fetch(`/api/infinity/design-mode/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });

      const data = await response.json();
      if (data.ok && data.sessionId) {
        sessionIdRef.current = data.sessionId;
        setIsConnected(true);

        // Connect to SSE for real-time updates
        const eventSource = new EventSource(`/api/infinity/design-mode/session/${data.sessionId}/stream`);
        eventSourceRef.current = eventSource;

        eventSource.addEventListener("element:inspected", (event) => {
          const element = JSON.parse(event.data) as InspectedElement;
          onElementInspect?.(element);
        });

        eventSource.addEventListener("element:selected", (event) => {
          const element = JSON.parse(event.data) as InspectedElement | null;
          onElementSelect?.(element);
        });

        eventSource.addEventListener("tokens:updated", (event) => {
          const tokens = JSON.parse(event.data) as DesignTokens;
          setDesignTokens(tokens);
        });

        eventSource.addEventListener("registry:updated", (event) => {
          const registry = JSON.parse(event.data) as ComponentRegistryEntry[];
          setComponentRegistry(registry);
        });

        eventSource.onerror = () => {
          console.warn("[DesignMode] SSE connection error");
        };
      }
    } catch (error) {
      console.error("[DesignMode] Failed to connect:", error);
    }
  }, [projectId, onElementInspect, onElementSelect]);

  // Disconnect session
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (sessionIdRef.current) {
      fetch(`/api/infinity/design-mode/session/${sessionIdRef.current}`, { method: "DELETE" }).catch(() => {});
      sessionIdRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Apply property change
  const applyPropertyChange = useCallback(async (change: VisualPropertyChange) => {
    if (!sessionIdRef.current) return;

    try {
      const response = await fetch(`/api/infinity/design-mode/session/${sessionIdRef.current}/property`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });

      const result = await response.json();
      if (result.success && result.codeChange) {
        // Send code change to preview for live update
        previewRef.current?.contentWindow?.postMessage(
          { type: "DESIGN_MODE_CODE_UPDATE", payload: { code: result.codeChange } },
          "*"
        );
      }

      // Also notify preview for immediate visual feedback
      previewRef.current?.contentWindow?.postMessage(
        { type: "DESIGN_MODE_PROPERTY_CHANGE", payload: change },
        "*"
      );

      onPropertyChange?.(change);
    } catch (error) {
      console.error("[DesignMode] Failed to apply property change:", error);
    }
  }, [previewRef, onPropertyChange]);

  // Fetch component registry
  const fetchRegistry = useCallback(async (): Promise<ComponentRegistryEntry[]> => {
    if (!projectId) return [];

    try {
      const response = await fetch(`/api/infinity/design-mode/registry?projectId=${encodeURIComponent(projectId)}`);
      const data = await response.json();
      if (data.ok && data.registry) {
        setComponentRegistry(data.registry);
        return data.registry;
      }
    } catch (error) {
      console.error("[DesignMode] Failed to fetch registry:", error);
    }
    return [];
  }, [projectId]);

  // Fetch design tokens
  const fetchTokens = useCallback(async (): Promise<DesignTokens> => {
    if (!projectId) return {} as DesignTokens;

    try {
      const response = await fetch(`/api/infinity/design-mode/tokens?projectId=${encodeURIComponent(projectId)}`);
      const data = await response.json();
      if (data.ok && data.tokens) {
        setDesignTokens(data.tokens);
        return data.tokens;
      }
    } catch (error) {
      console.error("[DesignMode] Failed to fetch tokens:", error);
    }
    return {} as DesignTokens;
  }, [projectId]);

  // Register inspected element
  const registerElement = useCallback((element: InspectedElement) => {
    if (!sessionIdRef.current) return;

    fetch(`/api/infinity/design-mode/session/${sessionIdRef.current}/element`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(element),
    }).catch(() => {});
  }, []);

  // Handle messages from preview iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== previewRef.current?.contentWindow) return;

      const { type, payload } = event.data;

      switch (type) {
        case "DESIGN_MODE_ELEMENT_INSPECT":
          setHoveredElement(payload);
          onElementInspect?.(payload);
          break;

        case "DESIGN_MODE_ELEMENT_SELECT":
          setSelectedElement(payload);
          onElementSelect?.(payload);
          break;

        case "DESIGN_MODE_ELEMENT_HOVER":
          setHoveredElement(payload);
          break;

        case "DESIGN_MODE_TOKENS_UPDATE":
          setDesignTokens(payload);
          break;

        case "DESIGN_MODE_REGISTRY_UPDATE":
          setComponentRegistry(payload);
          break;
      }
    };

    messageHandlerRef.current = handleMessage;
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [previewRef, onElementInspect, onElementSelect]);

  // Get visual controls for a prop
  const getVisualControlsForProp = useCallback(
    (propName: string, propType: string): VisualControlConfig | null => {
      const lowerName = propName.toLowerCase();
      const lowerType = propType.toLowerCase();

      if (lowerType.includes("boolean") || lowerType === "bool") {
        return { type: "toggle" };
      }
      if (lowerType.includes("number")) {
        return { type: "input", tokenPath: undefined };
      }
      if (lowerName.includes("color") || lowerName.includes("background")) {
        return {
          type: "color-picker",
          availableTokens: Object.keys(designTokens.colors || {}).flatMap((palette) =>
            Object.keys(designTokens.colors[palette] || {}).map((shade) => `colors.${palette}.${shade}`)
          ),
        };
      }
      if (lowerName.includes("size") || lowerName.includes("spacing") || lowerName.includes("padding") || lowerName.includes("margin")) {
        return {
          type: "spacing-slider",
          availableTokens: Object.keys(designTokens.spacing || {}),
        };
      }
      if (lowerName.includes("font") || lowerName.includes("typography") || lowerName.includes("text")) {
        return {
          type: "typography-select",
          availableTokens: Object.keys(designTokens.typography?.fontSize || {}).map((size) => `typography.fontSize.${size}`),
        };
      }

      return { type: "input" };
    },
    [designTokens]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    connect,
    disconnect,
    applyPropertyChange,
    fetchRegistry,
    fetchTokens,
    registerElement,
    selectedElement,
    setSelectedElement,
    hoveredElement,
    setHoveredElement,
    designTokens,
    componentRegistry,
    getVisualControlsForProp,
  };
}

export default useDesignMode;