/**
 * UI Builder — Visual Component Editor
 *
 * Phase 17: Direct manipulation + code sync for generated UI.
 * Phase 18: Collaborative workflows (comments, reviews, sharing).
 * Phase 19: External API & Database Integration (v0 Extensibility).
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