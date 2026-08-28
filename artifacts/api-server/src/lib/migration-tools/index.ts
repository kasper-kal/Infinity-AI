/**
 * Migration Tools - Barrel Export
 *
 * Automated framework-to-framework migration using AST transforms
 */

export * from './types';
export * from './engine';

// Re-export commonly used types
export type {
  MigrationOptions,
  MigrationResult,
  MigrationWarning,
  MigrationError,
  MigrationStats,
  TransformRule,
  TransformContext,
  MigrationPlan,
  MigrationStep,
  MigrationPatternKey,
} from './types';

export {
  MIGRATION_PATTERNS,
  createMigrationEngine,
  migrateProject,
} from './engine';