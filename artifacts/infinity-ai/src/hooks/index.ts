/**
 * Hooks barrel export
 */

export { useAstHistory } from './useAstHistory';
export { useConflictResolution } from './useConflictResolution';

// Phase 23: v0-Level Polish
export { useOffline, useOfflineMutation, useOfflineCapability, OfflineIndicator, type OfflineState, type OfflineActions, type OfflineMutation } from './useOffline';

// Re-export other hooks
export { useBuildShortcuts } from './use-build-shortcuts';
export { useBuildStudio } from './use-build-studio';
export { useChatStream } from './use-chat-stream';
export { useIsMobile } from './use-mobile';
export { useToast } from './use-toast';
export { useTerminalBridge } from './useTerminalBridge';
export { useDesignMode } from './useDesignMode';
export { useLiveTaskDisplay } from './useLiveTaskDisplay';
export { useBuildMap, type BuildMapGraph, type BuildMapNode, type BuildMapEdge, type BuildMapSuggestion, type BuildMapAnalysis, type BuildMapNodeType, type BuildMapNodeStatus, type BuildMapEdgeType, type BuildMapAssignee, type BuildMapLayoutAlgorithm } from './useBuildMap';

// Phase 40: Recipe Widget
export { useRecipes, type Recipe, type RecipeParameter, type RecipeStep, type RecipeVersion, type DeepResearchConfig, type ExecutionProgress, type RecipeExecution, type RecipeRating } from './useRecipes';

// Phase 41: File Converter
export { useFileConverter, type FormatInfo, type FormatGroup, type DetectionResult, type ConversionResult, type FileInfo, type BatchResult } from './useFileConverter';