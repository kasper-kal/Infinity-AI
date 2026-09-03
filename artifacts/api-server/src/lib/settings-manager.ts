/**
 * Settings Manager - AI Self-Management for UI Settings
 *
 * Handles user-facing settings with AI-proposed change confirmation workflow.
 * Settings include: accent color, theme, profile picture, density, language, notifications.
 *
 * Features:
 * - Setting validation and type safety
 * - AI-proposed changes with user confirmation workflow
 * - Audit logging for all setting changes
 * - Per-user and global settings support
 */

import { db } from '../db/index.js';
import { settings, settingChanges } from '../../db/src/schema/settings.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { secretManager } from './secret-manager.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type SettingKey =
  | 'accentColor'
  | 'theme'
  | 'profilePicture'
  | 'density'
  | 'language'
  | 'notifications'
  | 'autoCompact'
  | 'fontSize'
  | 'sidebarWidth'
  | 'animationEnabled';

export type SettingType = 'string' | 'number' | 'boolean' | 'object' | 'color';

export interface SettingDefinition {
  key: SettingKey;
  type: SettingType;
  defaultValue: unknown;
  allowedValues?: unknown[]; // For enum-like settings
  validation?: (value: unknown) => { valid: boolean; error?: string };
  description: string;
  category: 'appearance' | 'behavior' | 'notifications' | 'ai' | 'advanced';
  requiresRestart?: boolean;
  userEditable: boolean;
  aiProposable: boolean;
}

export interface SettingValue {
  key: SettingKey;
  value: unknown;
  userId?: string; // null for global
  projectId?: string; // null for global
  updatedAt: Date;
  updatedBy: 'user' | 'ai' | 'system';
}

export interface ProposedChange {
  id: string;
  type: 'setting';
  targetId: string; // setting key
  proposedBy: 'ai';
  proposedById: string; // AI agent ID
  currentValue: unknown;
  proposedValue: unknown;
  reason: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'expired';
  expiresAt: Date;
  createdAt: Date;
  confirmedAt?: Date;
  confirmedBy?: string;
}

export interface ConfirmationResult {
  success: boolean;
  changeId?: string;
  error?: string;
  appliedValue?: unknown;
}

// ============================================================================
// Setting Definitions
// ============================================================================

export const SETTING_DEFINITIONS: Record<SettingKey, SettingDefinition> = {
  accentColor: {
    key: 'accentColor',
    type: 'color',
    defaultValue: '#6366f1', // Indigo
    allowedValues: [
      '#6366f1', // Indigo (default)
      '#ec4899', // Pink
      '#f97316', // Orange
      '#22c55e', // Green
      '#3b82f6', // Blue
      '#a855f7', // Purple
      '#eab308', // Yellow
      '#ef4444', // Red
      '#06b6d4', // Cyan
      '#84cc16', // Lime
    ],
    validation: (value) => {
      if (typeof value !== 'string') return { valid: false, error: 'Must be a string' };
      const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;
      if (!hexColorRegex.test(value)) return { valid: false, error: 'Must be a valid hex color (e.g., #6366f1)' };
      return { valid: true };
    },
    description: 'Primary accent color for the UI',
    category: 'appearance',
    userEditable: true,
    aiProposable: true,
  },
  theme: {
    key: 'theme',
    type: 'string',
    defaultValue: 'system',
    allowedValues: ['light', 'dark', 'system'],
    validation: (value) => {
      if (typeof value !== 'string') return { valid: false, error: 'Must be a string' };
      if (!['light', 'dark', 'system'].includes(value)) {
        return { valid: false, error: 'Must be one of: light, dark, system' };
      }
      return { valid: true };
    },
    description: 'UI theme mode',
    category: 'appearance',
    userEditable: true,
    aiProposable: true,
  },
  profilePicture: {
    key: 'profilePicture',
    type: 'string',
    defaultValue: '',
    validation: (value) => {
      if (typeof value !== 'string') return { valid: false, error: 'Must be a string' };
      // Allow empty (default avatar), data URLs, or HTTPS URLs
      if (value === '') return { valid: true };
      if (value.startsWith('data:image/')) return { valid: true };
      if (value.startsWith('https://')) return { valid: true };
      return { valid: false, error: 'Must be a valid image URL (HTTPS) or data URL' };
    },
    description: 'User profile picture URL or data URI',
    category: 'appearance',
    userEditable: true,
    aiProposable: true,
  },
  density: {
    key: 'density',
    type: 'string',
    defaultValue: 'comfortable',
    allowedValues: ['compact', 'comfortable', 'spacious'],
    validation: (value) => {
      if (typeof value !== 'string') return { valid: false, error: 'Must be a string' };
      if (!['compact', 'comfortable', 'spacious'].includes(value)) {
        return { valid: false, error: 'Must be one of: compact, comfortable, spacious' };
      }
      return { valid: true };
    },
    description: 'UI density/spacing',
    category: 'appearance',
    userEditable: true,
    aiProposable: true,
  },
  language: {
    key: 'language',
    type: 'string',
    defaultValue: 'en',
    allowedValues: ['en', 'nl', 'es', 'fr', 'de', 'zh', 'ja', 'ko'],
    validation: (value) => {
      if (typeof value !== 'string') return { valid: false, error: 'Must be a string' };
      if (!['en', 'nl', 'es', 'fr', 'de', 'zh', 'ja', 'ko'].includes(value)) {
        return { valid: false, error: 'Unsupported language' };
      }
      return { valid: true };
    },
    description: 'Interface language',
    category: 'behavior',
    userEditable: true,
    aiProposable: true,
  },
  notifications: {
    key: 'notifications',
    type: 'object',
    defaultValue: {
      enabled: true,
      email: false,
      push: true,
      inApp: true,
      automationComplete: true,
      automationFailed: true,
      keyRotation: true,
      securityAlerts: true,
    },
    validation: (value) => {
      if (typeof value !== 'object' || value === null) {
        return { valid: false, error: 'Must be an object' };
      }
      const obj = value as Record<string, unknown>;
      const requiredKeys = ['enabled', 'email', 'push', 'inApp', 'automationComplete', 'automationFailed', 'keyRotation', 'securityAlerts'];
      for (const key of requiredKeys) {
        if (typeof obj[key] !== 'boolean') {
          return { valid: false, error: `Missing or invalid boolean field: ${key}` };
        }
      }
      return { valid: true };
    },
    description: 'Notification preferences',
    category: 'notifications',
    userEditable: true,
    aiProposable: true,
  },
  autoCompact: {
    key: 'autoCompact',
    type: 'boolean',
    defaultValue: true,
    validation: (value) => {
      if (typeof value !== 'boolean') return { valid: false, error: 'Must be a boolean' };
      return { valid: true };
    },
    description: 'Automatically compact conversation history when approaching token limits',
    category: 'behavior',
    userEditable: true,
    aiProposable: true,
  },
  fontSize: {
    key: 'fontSize',
    type: 'number',
    defaultValue: 14,
    allowedValues: [12, 13, 14, 15, 16, 18, 20],
    validation: (value) => {
      if (typeof value !== 'number') return { valid: false, error: 'Must be a number' };
      if (![12, 13, 14, 15, 16, 18, 20].includes(value)) {
        return { valid: false, error: 'Must be one of: 12, 13, 14, 15, 16, 18, 20' };
      }
      return { valid: true };
    },
    description: 'Base font size in pixels',
    category: 'appearance',
    userEditable: true,
    aiProposable: true,
  },
  sidebarWidth: {
    key: 'sidebarWidth',
    type: 'number',
    defaultValue: 280,
    allowedValues: [240, 280, 320, 360, 400],
    validation: (value) => {
      if (typeof value !== 'number') return { valid: false, error: 'Must be a number' };
      if (![240, 280, 320, 360, 400].includes(value)) {
        return { valid: false, error: 'Must be one of: 240, 280, 320, 360, 400' };
      }
      return { valid: true };
    },
    description: 'Sidebar width in pixels',
    category: 'appearance',
    userEditable: true,
    aiProposable: true,
  },
  animationEnabled: {
    key: 'animationEnabled',
    type: 'boolean',
    defaultValue: true,
    validation: (value) => {
      if (typeof value !== 'boolean') return { valid: false, error: 'Must be a boolean' };
      return { valid: true };
    },
    description: 'Enable UI animations and transitions',
    category: 'appearance',
    userEditable: true,
    aiProposable: true,
  },
};

// ============================================================================
// Settings Manager Class
// ============================================================================

export class SettingsManager {
  private static instance: SettingsManager;
  private pendingChanges: Map<string, ProposedChange> = new Map();

  static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  private constructor() {
    // Clean up expired proposals periodically
    setInterval(() => this.cleanupExpiredProposals(), 5 * 60 * 1000); // Every 5 minutes
  }

  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

  /**
   * Get a setting value (with fallback to default)
   */
  async getSetting(key: SettingKey, userId?: string, projectId?: string): Promise<unknown> {
    const conditions = [eq(settings.key, key)];

    if (userId) {
      conditions.push(eq(settings.userId, userId));
    } else {
      conditions.push(sql`${settings.userId} IS NULL`);
    }

    if (projectId) {
      conditions.push(eq(settings.projectId, projectId));
    } else {
      conditions.push(sql`${settings.projectId} IS NULL`);
    }

    const [row] = await db.select().from(settings).where(and(...conditions)).limit(1);

    if (!row) {
      return SETTING_DEFINITIONS[key].defaultValue;
    }

    return row.value;
  }

  /**
   * Get all settings for a user/project
   */
  async getAllSettings(userId?: string, projectId?: string): Promise<Record<SettingKey, unknown>> {
    const conditions = [];

    if (userId) {
      conditions.push(eq(settings.userId, userId));
    } else {
      conditions.push(sql`${settings.userId} IS NULL`);
    }

    if (projectId) {
      conditions.push(eq(settings.projectId, projectId));
    } else {
      conditions.push(sql`${settings.projectId} IS NULL`);
    }

    const rows = await db.select().from(settings).where(and(...conditions));

    const result: Record<string, unknown> = {};

    // Start with defaults
    for (const [key, def] of Object.entries(SETTING_DEFINITIONS)) {
      result[key] = def.defaultValue;
    }

    // Override with stored values
    for (const row of rows) {
      result[row.key] = row.value;
    }

    return result as Record<SettingKey, unknown>;
  }

  /**
   * Set a setting value directly (user or system)
   */
  async setSetting(
    key: SettingKey,
    value: unknown,
    updatedBy: 'user' | 'system' = 'user',
    userId?: string,
    projectId?: string
  ): Promise<{ success: boolean; error?: string }> {
    const definition = SETTING_DEFINITIONS[key];
    if (!definition) {
      return { success: false, error: `Unknown setting: ${key}` };
    }

    // Validate
    const validation = definition.validation?.(value);
    if (validation && !validation.valid) {
      return { success: false, error: validation.error };
    }

    // Get current value for audit log
    const currentValue = await this.getSetting(key, userId, projectId);

    // Upsert
    await db.insert(settings).values({
      key,
      value: value as any,
      userId: userId ?? null,
      projectId: projectId ?? null,
      updatedBy,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [settings.key, settings.userId, settings.projectId],
      set: {
        value: value as any,
        updatedBy,
        updatedAt: new Date(),
      },
    });

    // Audit log
    await this.logSettingChange({
      key,
      operation: 'update',
      performedBy: updatedBy,
      details: { userId, projectId },
      previousValue: currentValue,
      newValue: value,
    });

    return { success: true };
  }

  /**
   * Reset a setting to default
   */
  async resetSetting(key: SettingKey, userId?: string, projectId?: string): Promise<{ success: boolean; error?: string }> {
    const definition = SETTING_DEFINITIONS[key];
    if (!definition) {
      return { success: false, error: `Unknown setting: ${key}` };
    }

    const currentValue = await this.getSetting(key, userId, projectId);

    await db.delete(settings).where(and(
      eq(settings.key, key),
      userId ? eq(settings.userId, userId) : sql`${settings.userId} IS NULL`,
      projectId ? eq(settings.projectId, projectId) : sql`${settings.projectId} IS NULL`
    ));

    await this.logSettingChange({
      key,
      operation: 'delete',
      performedBy: 'user',
      details: { userId, projectId, reset: true },
      previousValue: currentValue,
      newValue: definition.defaultValue,
    });

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // AI Proposal Workflow
  // ---------------------------------------------------------------------------

  /**
   * AI proposes a setting change (requires user confirmation)
   */
  async proposeSettingChange(
    key: SettingKey,
    proposedValue: unknown,
    reason: string,
    proposedById: string,
    userId?: string,
    projectId?: string,
    expiresInMs = 24 * 60 * 60 * 1000 // 24 hours default
  ): Promise<{ success: boolean; changeId?: string; error?: string }> {
    const definition = SETTING_DEFINITIONS[key];
    if (!definition) {
      return { success: false, error: `Unknown setting: ${key}` };
    }

    if (!definition.aiProposable) {
      return { success: false, error: `Setting ${key} cannot be proposed by AI` };
    }

    // Validate proposed value
    const validation = definition.validation?.(proposedValue);
    if (validation && !validation.valid) {
      return { success: false, error: validation.error };
    }

    const currentValue = await this.getSetting(key, userId, projectId);

    // Check if there's already a pending proposal for this setting
    const existingProposal = Array.from(this.pendingChanges.values()).find(
      p => p.targetId === key && p.status === 'pending' &&
           ((userId && p.targetId === key) || (!userId && p.targetId === key))
    );

    if (existingProposal) {
      return { success: false, error: 'A proposal for this setting is already pending' };
    }

    const changeId = `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = new Date(Date.now() + expiresInMs);

    const proposal: ProposedChange = {
      id: changeId,
      type: 'setting',
      targetId: key,
      proposedBy: 'ai',
      proposedById,
      currentValue,
      proposedValue,
      reason,
      status: 'pending',
      expiresAt,
      createdAt: new Date(),
    };

    this.pendingChanges.set(changeId, proposal);

    // Also persist to database for durability
    await db.insert(settingChanges).values({
      keyId: key,
      operation: 'propose',
      performedBy: 'ai',
      performedById: proposedById,
      details: {
        reason,
        currentValue,
        proposedValue,
        userId,
        projectId,
        expiresAt: expiresAt.toISOString(),
      } as any,
      previousValue: currentValue as any,
      newValue: proposedValue as any,
    });

    return { success: true, changeId };
  }

  /**
   * User confirms a proposed change
   */
  async confirmChange(changeId: string, confirmedBy: string): Promise<ConfirmationResult> {
    const proposal = this.pendingChanges.get(changeId);

    if (!proposal) {
      // Check database for persisted proposals
      const [dbProposal] = await db.select().from(settingChanges)
        .where(and(
          eq(settingChanges.keyId, changeId),
          eq(settingChanges.operation, 'propose'),
          eq(settingChanges.performedBy, 'ai')
        ))
        .orderBy(desc(settingChanges.timestamp))
        .limit(1);

      if (!dbProposal) {
        return { success: false, error: 'Proposal not found' };
      }

      // Reconstruct from database
      const details = dbProposal.details as any;
      if (details.status !== 'pending') {
        return { success: false, error: `Proposal already ${details.status}` };
      }
      if (new Date(details.expiresAt) < new Date()) {
        return { success: false, error: 'Proposal has expired' };
      }

      // Apply the change
      const result = await this.setSetting(
        dbProposal.keyId as SettingKey,
        details.proposedValue,
        'user',
        details.userId,
        details.projectId
      );

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // Update proposal status in database
      await db.update(settingChanges)
        .set({
          details: {
            ...details,
            status: 'confirmed',
            confirmedAt: new Date().toISOString(),
            confirmedBy,
          } as any,
        })
        .where(eq(settingChanges.id, dbProposal.id));

      return { success: true, changeId, appliedValue: details.proposedValue };
    }

    // In-memory proposal
    if (proposal.status !== 'pending') {
      return { success: false, error: `Proposal already ${proposal.status}` };
    }

    if (proposal.expiresAt < new Date()) {
      proposal.status = 'expired';
      return { success: false, error: 'Proposal has expired' };
    }

    // Apply the change
    const result = await this.setSetting(proposal.targetId, proposal.proposedValue, 'user');

    if (!result.success) {
      return { success: false, error: result.error };
    }

    proposal.status = 'confirmed';
    proposal.confirmedAt = new Date();
    proposal.confirmedBy = confirmedBy;

    return { success: true, changeId, appliedValue: proposal.proposedValue };
  }

  /**
   * User rejects a proposed change
   */
  async rejectChange(changeId: string, rejectedBy: string): Promise<{ success: boolean; error?: string }> {
    const proposal = this.pendingChanges.get(changeId);

    if (!proposal) {
      // Check database
      const [dbProposal] = await db.select().from(settingChanges)
        .where(and(
          eq(settingChanges.keyId, changeId),
          eq(settingChanges.operation, 'propose'),
          eq(settingChanges.performedBy, 'ai')
        ))
        .orderBy(desc(settingChanges.timestamp))
        .limit(1);

      if (!dbProposal) {
        return { success: false, error: 'Proposal not found' };
      }

      const details = dbProposal.details as any;
      if (details.status !== 'pending') {
        return { success: false, error: `Proposal already ${details.status}` };
      }

      await db.update(settingChanges)
        .set({
          details: {
            ...details,
            status: 'rejected',
            rejectedAt: new Date().toISOString(),
            rejectedBy,
          } as any,
        })
        .where(eq(settingChanges.id, dbProposal.id));

      return { success: true };
    }

    if (proposal.status !== 'pending') {
      return { success: false, error: `Proposal already ${proposal.status}` };
    }

    proposal.status = 'rejected';
    return { success: true };
  }

  /**
   * Get pending proposals for a user/project
   */
  async getPendingProposals(userId?: string, projectId?: string): Promise<ProposedChange[]> {
    const proposals: ProposedChange[] = [];

    // In-memory proposals
    for (const proposal of this.pendingChanges.values()) {
      if (proposal.status === 'pending' && proposal.expiresAt > new Date()) {
        proposals.push(proposal);
      }
    }

    // Database proposals (for durability across restarts)
    const conditions = [
      eq(settingChanges.operation, 'propose'),
      eq(settingChanges.performedBy, 'ai'),
    ];

    const dbProposals = await db.select().from(settingChanges).where(and(...conditions));

    for (const row of dbProposals) {
      const details = row.details as any;
      if (details.status === 'pending' && new Date(details.expiresAt) > new Date()) {
        // Check if matches user/project scope
        const matchesUser = (userId && details.userId === userId) || (!userId && !details.userId);
        const matchesProject = (projectId && details.projectId === projectId) || (!projectId && !details.projectId);

        if (matchesUser && matchesProject) {
          proposals.push({
            id: row.id,
            type: 'setting',
            targetId: row.keyId,
            proposedBy: 'ai',
            proposedById: row.performedById,
            currentValue: details.currentValue,
            proposedValue: details.proposedValue,
            reason: details.reason,
            status: 'pending',
            expiresAt: new Date(details.expiresAt),
            createdAt: row.timestamp,
          });
        }
      }
    }

    return proposals;
  }

  /**
   * Get proposal by ID
   */
  async getProposal(changeId: string): Promise<ProposedChange | null> {
    // Check in-memory first
    const inMemory = this.pendingChanges.get(changeId);
    if (inMemory) return inMemory;

    // Check database
    const [row] = await db.select().from(settingChanges)
      .where(eq(settingChanges.id, changeId))
      .limit(1);

    if (!row) return null;

    const details = row.details as any;
    return {
      id: row.id,
      type: 'setting',
      targetId: row.keyId,
      proposedBy: 'ai',
      proposedById: row.performedById,
      currentValue: details.currentValue,
      proposedValue: details.proposedValue,
      reason: details.reason,
      status: details.status,
      expiresAt: new Date(details.expiresAt),
      createdAt: row.timestamp,
      confirmedAt: details.confirmedAt ? new Date(details.confirmedAt) : undefined,
      confirmedBy: details.confirmedBy,
    };
  }

  // ---------------------------------------------------------------------------
  // Validation & Utilities
  // ---------------------------------------------------------------------------

  /**
   * Validate a setting value against its definition
   */
  validateSetting(key: SettingKey, value: unknown): { valid: boolean; error?: string } {
    const definition = SETTING_DEFINITIONS[key];
    if (!definition) {
      return { valid: false, error: `Unknown setting: ${key}` };
    }
    return definition.validation?.(value) ?? { valid: true };
  }

  /**
   * Get setting definition
   */
  getSettingDefinition(key: SettingKey): SettingDefinition | undefined {
    return SETTING_DEFINITIONS[key];
  }

  /**
   * Get all setting definitions
   */
  getAllSettingDefinitions(): SettingDefinition[] {
    return Object.values(SETTING_DEFINITIONS);
  }

  /**
   * Get settings by category
   */
  getSettingsByCategory(category: SettingDefinition['category']): SettingDefinition[] {
    return Object.values(SETTING_DEFINITIONS).filter(d => d.category === category);
  }

  // ---------------------------------------------------------------------------
  // Audit Logging
  // ---------------------------------------------------------------------------

  private async logSettingChange(entry: {
    key: string;
    operation: 'create' | 'read' | 'update' | 'delete' | 'propose';
    performedBy: 'user' | 'ai' | 'system';
    performedById?: string;
    details: Record<string, unknown>;
    previousValue?: unknown;
    newValue?: unknown;
  }): Promise<void> {
    await db.insert(settingChanges).values({
      keyId: entry.key,
      operation: entry.operation,
      performedBy: entry.performedBy,
      performedById: entry.performedById ?? null,
      details: entry.details as any,
      previousValue: entry.previousValue as any,
      newValue: entry.newValue as any,
    });
  }

  /**
   * Get audit log for a setting
   */
  async getSettingAuditLog(key: SettingKey, limit = 100): Promise<any[]> {
    const rows = await db.select()
      .from(settingChanges)
      .where(eq(settingChanges.keyId, key))
      .orderBy(desc(settingChanges.timestamp))
      .limit(limit);

    return rows;
  }

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------

  private cleanupExpiredProposals(): void {
    const now = new Date();
    for (const [id, proposal] of this.pendingChanges.entries()) {
      if (proposal.expiresAt < now && proposal.status === 'pending') {
        proposal.status = 'expired';
      }
    }
  }
}

// Export singleton instance
export const settingsManager = SettingsManager.getInstance();

// Export types and definitions
export { SETTING_DEFINITIONS };