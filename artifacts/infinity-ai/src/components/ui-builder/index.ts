/**
 * UI Builder — Visual Component Editor
 *
 * Phase 17: Direct manipulation + code sync for generated UI.
 * Phase 18: Collaborative workflows (comments, reviews, sharing).
 * Phase 19: External API & Database Integration (v0 Extensibility).
 * Phase 20: Multi-Framework Support (framework selection).
 * Barrel export for all UI Builder components.
 */

export { LivePreview } from './LivePreview';
export { PropEditor } from './PropEditor';
export { VisualInspector, useVisualInspector } from './VisualInspector';
export { ComponentExtractor } from './ComponentExtractor';
export { ComponentRegistry } from './ComponentRegistry';
export { DeployPanel } from './DeployPanel';
export { CommentOverlay, type Comment, type CommentElementData } from './CommentOverlay';
export { CommentSidebar, type CommentFilter } from './CommentSidebar';
export { ReviewPanel, type ReviewRequest } from './ReviewPanel';
export { AuthPanel, type AuthProviderConfig, type GeneratedAuthCode } from './AuthPanel';
export { APIWizard } from './APIWizard';
export { DatabasePanel } from './DatabasePanel';
export { FrameworkSelector, type FrameworkInfo, FRAMEWORKS } from './FrameworkSelector';

// Phase 23: v0-Level Polish
export { ErrorOverlay, useErrorOverlay, createErrorFromEvent, createErrorFromBuild, type ErrorDetail, type AutoFixAction } from './ErrorOverlay';
export { CommandPalette, useCommandPalette, type CommandAction, type CommandCategory } from './CommandPalette';
export { A11yLinter, useA11yLinter, type A11yViolation, type A11yResult } from './A11yLinter';
export { useOffline, useOfflineMutation, useOfflineCapability, OfflineIndicator, type OfflineState, type OfflineActions, type OfflineMutation } from '../hooks/useOffline';