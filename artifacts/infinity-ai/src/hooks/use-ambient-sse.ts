/**
 * useAmbientSSE — Hook for connecting to Ambient Intelligence SSE stream
 *
 * Connects to /api/infinity/design-canvas/:projectId/ambient/stream
 * Handles real-time suggestion events: generated, accepted, rejected, preferences updated
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { AmbientSuggestion, UserPreferences, DesignModelConfig } from '../../../api-server/src/lib/ambient-intelligence';

interface AmbientSSEEvent {
  type: 'connected' | 'suggestions:snapshot' | 'suggestion:generated' | 'suggestion:accepted' | 'suggestion:rejected' | 'preferences:updated';
  projectId?: string;
  suggestions?: AmbientSuggestion[];
  suggestion?: AmbientSuggestion;
  preferences?: UserPreferences;
}

interface UseAmbientSSEReturn {
  suggestions: AmbientSuggestion[];
  preferences: UserPreferences | null;
  isConnected: boolean;
  acceptSuggestion: (suggestionId: string, projectId: string) => Promise<AmbientSuggestion | null>;
  rejectSuggestion: (suggestionId: string, projectId: string) => Promise<AmbientSuggestion | null>;
  generateSuggestions: (projectId: string) => Promise<AmbientSuggestion[]>;
  setPreferences: (preferences: Partial<UserPreferences>, projectId: string) => Promise<UserPreferences>;
  getSuggestions: (projectId: string) => Promise<AmbientSuggestion[]>;
  // Model selection
  availableModels: DesignModelConfig[];
  selectedModel: string | null;
  setDesignModel: (modelId: string | null, projectId: string) => Promise<string | null>;
  getAvailableModels: (projectId: string) => Promise<DesignModelConfig[]>;
  getSelectedModel: (projectId: string) => Promise<string | null>;
}

export function useAmbientSSE(projectId: string | null): UseAmbientSSEReturn {
  const [suggestions, setSuggestions] = useState<AmbientSuggestion[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [availableModels, setAvailableModels] = useState<DesignModelConfig[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Connect to SSE stream
  useEffect(() => {
    if (!projectId) {
      setIsConnected(false);
      return;
    }

    const connect = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource(`/api/infinity/design-canvas/${projectId}/ambient/stream`);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        console.log('[AmbientSSE] Connected to ambient intelligence stream');
      };

      es.onmessage = (event: MessageEvent) => {
        try {
          const data: AmbientSSEEvent = JSON.parse(event.data);
          handleEvent(data);
        } catch (err) {
          console.error('[AmbientSSE] Failed to parse event:', err);
        }
      };

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          setIsConnected(false);
          console.log('[AmbientSSE] Connection closed, reconnecting in 5s...');
          reconnectTimeoutRef.current = setTimeout(connect, 5000);
        }
      };
    };

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [projectId]);

  const handleEvent = useCallback((event: AmbientSSEEvent) => {
    switch (event.type) {
      case 'suggestions:snapshot':
        if (event.suggestions) {
          setSuggestions(event.suggestions);
        }
        break;
      case 'suggestion:generated':
        if (event.suggestion) {
          setSuggestions(prev => {
            // Avoid duplicates by ID
            const exists = prev.some(s => s.id === event.suggestion!.id);
            if (exists) return prev;
            return [...prev, event.suggestion!].sort((a, b) => b.confidence - a.confidence);
          });
        }
        break;
      case 'suggestion:accepted':
      case 'suggestion:rejected':
        if (event.suggestion) {
          setSuggestions(prev => prev.filter(s => s.id !== event.suggestion!.id));
        }
        break;
      case 'preferences:updated':
        if (event.preferences) {
          setPreferences(event.preferences);
        }
        break;
      case 'connected':
        console.log('[AmbientSSE] Connected:', event.projectId);
        break;
    }
  }, []);

  // Accept a suggestion via API
  const acceptSuggestion = useCallback(async (suggestionId: string, projectId: string): Promise<AmbientSuggestion | null> => {
    try {
      const res = await fetch(`/api/infinity/design-canvas/${projectId}/ambient/suggestions/${suggestionId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to accept suggestion');
      }
      const data = await res.json();
      return data.suggestion ?? null;
    } catch (err) {
      console.error('[AmbientSSE] Accept suggestion failed:', err);
      return null;
    }
  }, []);

  // Reject a suggestion via API
  const rejectSuggestion = useCallback(async (suggestionId: string, projectId: string): Promise<AmbientSuggestion | null> => {
    try {
      const res = await fetch(`/api/infinity/design-canvas/${projectId}/ambient/suggestions/${suggestionId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to reject suggestion');
      }
      const data = await res.json();
      return data.suggestion ?? null;
    } catch (err) {
      console.error('[AmbientSSE] Reject suggestion failed:', err);
      return null;
    }
  }, []);

  // Trigger manual generation
  const generateSuggestions = useCallback(async (projectId: string): Promise<AmbientSuggestion[]> => {
    try {
      const res = await fetch(`/api/infinity/design-canvas/${projectId}/ambient/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate suggestions');
      }
      const data = await res.json();
      return data.suggestions ?? [];
    } catch (err) {
      console.error('[AmbientSSE] Generate suggestions failed:', err);
      return [];
    }
  }, []);

  // Update preferences
  const setPreferencesAPI = useCallback(async (prefs: Partial<UserPreferences>, projectId: string): Promise<UserPreferences> => {
    try {
      const res = await fetch(`/api/infinity/design-canvas/${projectId}/ambient/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to set preferences');
      }
      const data = await res.json();
      return data.preferences ?? {
        preferredColors: [],
        preferredTypography: [],
        commonPatterns: [],
        styleKeywords: [],
        recentChoices: [],
      };
    } catch (err) {
      console.error('[AmbientSSE] Set preferences failed:', err);
      return {
        preferredColors: [],
        preferredTypography: [],
        commonPatterns: [],
        styleKeywords: [],
        recentChoices: [],
      };
    }
  }, []);

  // Get current suggestions
  const getSuggestions = useCallback(async (projectId: string): Promise<AmbientSuggestion[]> => {
    try {
      const res = await fetch(`/api/infinity/design-canvas/${projectId}/ambient/suggestions`, {
        credentials: 'include',
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.suggestions ?? [];
    } catch (err) {
      console.error('[AmbientSSE] Get suggestions failed:', err);
      return [];
    }
  }, []);

  // Get available design models
  const getAvailableModels = useCallback(async (projectId: string): Promise<DesignModelConfig[]> => {
    try {
      const res = await fetch(`/api/infinity/design-canvas/${projectId}/ambient/models`, {
        credentials: 'include',
      });
      if (!res.ok) return [];
      const data = await res.json();
      const models = data.models ?? [];
      setAvailableModels(models);
      return models;
    } catch (err) {
      console.error('[AmbientSSE] Get available models failed:', err);
      return [];
    }
  }, []);

  // Get currently selected model
  const getSelectedModel = useCallback(async (projectId: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/infinity/design-canvas/${projectId}/ambient/model`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      const model = data.model ?? null;
      setSelectedModel(model);
      return model;
    } catch (err) {
      console.error('[AmbientSSE] Get selected model failed:', err);
      return null;
    }
  }, []);

  // Set selected model for ambient intelligence
  const setDesignModel = useCallback(async (modelId: string | null, projectId: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/infinity/design-canvas/${projectId}/ambient/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to set model');
      }
      const data = await res.json();
      const model = data.model ?? null;
      setSelectedModel(model);
      return model;
    } catch (err) {
      console.error('[AmbientSSE] Set model failed:', err);
      return null;
    }
  }, []);

  // Load models on project change
  useEffect(() => {
    if (projectId) {
      getAvailableModels(projectId);
      getSelectedModel(projectId);
    }
  }, [projectId, getAvailableModels, getSelectedModel]);

  return {
    suggestions,
    preferences,
    isConnected,
    acceptSuggestion,
    rejectSuggestion,
    generateSuggestions,
    setPreferences: setPreferencesAPI,
    getSuggestions,
    availableModels,
    selectedModel,
    setDesignModel,
    getAvailableModels,
    getSelectedModel,
  };
}