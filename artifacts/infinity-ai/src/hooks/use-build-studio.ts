import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ToolCall } from '@/components/build-transcript';
import type { BuildPlan } from '@/components/build-plan-view';
import type { FileDiff } from '@/components/build-diff-preview';

export type BuildStatus = 'idle' | 'planning' | 'waiting' | 'working' | 'reviewing' | 'done' | 'error' | 'cancelled';

export interface BuildProgressItem {
  id: string;
  role: 'user' | 'Infinity';
  message: string;
  status: 'working' | 'waiting' | 'done' | 'error' | 'cancelled';
  createdAt: number;
}

export interface BuildStudioState {
  // Core build lifecycle
  status: BuildStatus;
  startedAt: number | null;
  elapsedMs: number;

  // Plan
  plan: BuildPlan | null;
  planOpen: boolean;

  // Transcript / tool calls
  toolCalls: ToolCall[];
  progressItems: BuildProgressItem[];

  // Diff preview
  diffPreview: {
    open: boolean;
    diffs: FileDiff[];
    title: string;
  };

  // Live preview
  livePreview: {
    open: boolean;
    url: string | null;
    title: string;
  };

  // Wizard
  wizardOpen: boolean;
  wizardPrompt: string;

  // Completion
  completion: { summary: string; deferred: string[]; files: string[] } | null;
  iteration: number;
}

const INITIAL_STATE: BuildStudioState = {
  status: 'idle',
  startedAt: null,
  elapsedMs: 0,
  plan: null,
  planOpen: false,
  toolCalls: [],
  progressItems: [],
  diffPreview: { open: false, diffs: [], title: 'Diff Preview' },
  livePreview: { open: false, url: null, title: 'Live Preview' },
  wizardOpen: false,
  wizardPrompt: '',
  completion: null,
  iteration: 0,
};

export interface UseBuildStudioOptions {
  onCancel?: () => void;
  onApplyDiff?: (filePath: string) => void;
  onRejectDiff?: (filePath: string) => void;
  onRefreshPreview?: () => void;
}

export function useBuildStudio(options: UseBuildStudioOptions = {}) {
  const [state, setState] = useState<BuildStudioState>(INITIAL_STATE);
  const clockRef = useRef<number>(Date.now());
  const toolCallsRef = useRef<ToolCall[]>([]);
  const progressRef = useRef<BuildProgressItem[]>([]);

  // Keep refs in sync
  useEffect(() => { toolCallsRef.current = state.toolCalls; }, [state.toolCalls]);
  useEffect(() => { progressRef.current = state.progressItems; }, [state.progressItems]);

  // Elapsed timer
  useEffect(() => {
    if (state.status !== 'working' && state.status !== 'waiting' && state.status !== 'reviewing') return;
    const timer = window.setInterval(() => {
      if (state.startedAt) {
        setState((s) => ({ ...s, elapsedMs: Date.now() - (s.startedAt ?? Date.now()) }));
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [state.status, state.startedAt]);

  const startBuild = useCallback((prompt: string) => {
    const now = Date.now();
    clockRef.current = now;
    const userItem: BuildProgressItem = {
      id: `user-${now}`,
      role: 'user',
      message: prompt,
      status: 'done',
      createdAt: now,
    };
    progressRef.current = [userItem];
    setState((s) => ({
      ...s,
      status: 'working',
      startedAt: now,
      elapsedMs: 0,
      progressItems: [userItem],
      completion: null,
      toolCalls: [],
      plan: null,
      planOpen: false,
    }));
  }, []);

  const addProgress = useCallback((message: string, status: BuildProgressItem['status'] = 'working') => {
    const item: BuildProgressItem = {
      id: `Infinity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: 'Infinity',
      message,
      status,
      createdAt: Date.now(),
    };
    progressRef.current = [...progressRef.current, item].slice(-40);
    setState((s) => ({ ...s, progressItems: progressRef.current }));
  }, []);

  const setStatus = useCallback((status: BuildStatus) => {
    setState((s) => ({ ...s, status }));
  }, []);

  const setPlan = useCallback((plan: BuildPlan | null, open = true) => {
    setState((s) => ({ ...s, plan, planOpen: open }));
  }, []);

  const closePlan = useCallback(() => {
    setState((s) => ({ ...s, planOpen: false }));
  }, []);

  const setWizardOpen = useCallback((open: boolean, prompt = '') => {
    setState((s) => ({ ...s, wizardOpen: open, wizardPrompt: prompt || s.wizardPrompt }));
  }, []);

  // Tool call management
  const addToolCall = useCallback((call: Omit<ToolCall, 'id'>, parentId?: string) => {
    const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const full: ToolCall = { ...call, id };
    setState((s) => {
      if (parentId) {
        const update = (calls: ToolCall[]): ToolCall[] =>
          calls.map((c) => {
            if (c.id === parentId) {
              return { ...c, nested: [...(c.nested ?? []), full] };
            }
            if (c.nested?.length) {
              return { ...c, nested: update(c.nested) };
            }
            return c;
          });
        return { ...s, toolCalls: update(s.toolCalls) };
      }
      return { ...s, toolCalls: [...s.toolCalls, full] };
    });
    return id;
  }, []);

  const updateToolCall = useCallback((id: string, patch: Partial<ToolCall>) => {
    setState((s) => {
      const update = (calls: ToolCall[]): ToolCall[] =>
        calls.map((c) => {
          if (c.id === id) return { ...c, ...patch };
          if (c.nested?.length) return { ...c, nested: update(c.nested) };
          return c;
        });
      return { ...s, toolCalls: update(s.toolCalls) };
    });
  }, []);

  const openDiff = useCallback((diffs: FileDiff[], title = 'Diff Preview') => {
    setState((s) => ({ ...s, diffPreview: { open: true, diffs, title } }));
  }, []);

  const closeDiff = useCallback(() => {
    setState((s) => ({ ...s, diffPreview: { ...s.diffPreview, open: false } }));
  }, []);

  const applyDiff = useCallback((filePath: string) => {
    options.onApplyDiff?.(filePath);
    setState((s) => ({ ...s, diffPreview: { ...s.diffPreview, open: false } }));
  }, [options]);

  const rejectDiff = useCallback((filePath: string) => {
    options.onRejectDiff?.(filePath);
    setState((s) => ({ ...s, diffPreview: { ...s.diffPreview, open: false } }));
  }, [options]);

  const openLivePreview = useCallback((url: string, title = 'Live Preview') => {
    setState((s) => ({ ...s, livePreview: { open: true, url, title } }));
  }, []);

  const closeLivePreview = useCallback(() => {
    setState((s) => ({ ...s, livePreview: { ...s.livePreview, open: false } }));
  }, []);

  const setCompletion = useCallback((completion: BuildStudioState['completion']) => {
    setState((s) => ({ ...s, completion, status: 'done' }));
  }, []);

  const setIteration = useCallback((iteration: number) => {
    setState((s) => ({ ...s, iteration }));
  }, []);

  const cancel = useCallback(() => {
    options.onCancel?.();
    setState((s) => ({ ...s, status: 'cancelled' }));
    addProgress('Build cancelled', 'cancelled');
  }, [options, addProgress]);

  const reset = useCallback(() => {
    progressRef.current = [];
    toolCallsRef.current = [];
    setState(INITIAL_STATE);
  }, []);

  const isActive = useMemo(
    () => ['planning', 'waiting', 'working', 'reviewing'].includes(state.status),
    [state.status],
  );

  const stats = useMemo(() => ({
    total: state.toolCalls.length,
    completed: state.toolCalls.filter((c) => c.status === 'completed').length,
    running: state.toolCalls.filter((c) => c.status === 'running').length,
    error: state.toolCalls.filter((c) => c.status === 'error').length,
  }), [state.toolCalls]);

  return {
    state,
    isActive,
    stats,
    startBuild,
    addProgress,
    setStatus,
    setPlan,
    closePlan,
    setWizardOpen,
    addToolCall,
    updateToolCall,
    openDiff,
    closeDiff,
    applyDiff,
    rejectDiff,
    openLivePreview,
    closeLivePreview,
    setCompletion,
    setIteration,
    cancel,
    reset,
  };
}

export type BuildStudioController = ReturnType<typeof useBuildStudio>;
