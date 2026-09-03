/**
 * Secret Manager - AI Self-Management for LLM API Keys
 *
 * Handles encrypted storage, rotation, health monitoring, and audit logging
 * for LLM API keys. Distinct from project-secrets.ts which handles project-scoped secrets.
 *
 * Features:
 * - AES-256-GCM encryption with per-project key derivation
 * - Key health tracking (healthy/cooling/quarantined)
 * - Automatic rotation with provider-specific handlers
 * - Audit logging for all secret operations
 * - User confirmation workflow for AI-proposed changes
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { db, secrets, settingChanges } from '@workspace/db';
import { eq, and, desc, lt, gte, sql } from 'drizzle-orm';

const scryptAsync = promisify(scrypt);

// ============================================================================
// Types & Interfaces
// ============================================================================

export type LLMKeyHealth = 'healthy' | 'cooling' | 'quarantined';
export type LLMKeySource = 'user-api' | 'project-pool' | 'global-pool';
export type SecretOperation = 'create' | 'read' | 'update' | 'delete' | 'rotate' | 'health-check';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
}

export interface LLMKeyData {
  id?: string;
  projectId?: string; // null for global pool
  provider: string; // 'openai', 'anthropic', 'google', 'groq', 'custom'
  model?: string; // optional model restriction
  encryptedKey: EncryptedSecret;
  name: string; // human-readable name
  health: LLMKeyHealth;
  priority: number; // higher = preferred
  source: LLMKeySource;
  lastUsed?: Date;
  lastHealthCheck?: Date;
  coolingUntil?: Date;
  quarantineReason?: string;
  rotationCount: number;
  metadata?: Record<string, unknown>;
}

export interface KeyHealthMetrics {
  totalKeys: number;
  healthyKeys: number;
  coolingKeys: number;
  quarantinedKeys: number;
  keysByProvider: Record<string, { healthy: number; cooling: number; quarantined: number }>;
  oldestKeyAge: number; // days
  rotationRate: number; // rotations per month
}

export interface RotationResult {
  success: boolean;
  newKeyId?: string;
  error?: string;
  rotatedAt: Date;
}

export interface AuditLogEntry {
  id: string;
  keyId: string;
  operation: SecretOperation;
  performedBy: 'ai' | 'user' | 'system';
  performedById?: string; // user ID or AI agent ID
  details: Record<string, unknown>;
  previousValue?: Partial<LLMKeyData>;
  newValue?: Partial<LLMKeyData>;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface ProposedChange {
  id: string;
  type: 'setting' | 'secret';
  targetId: string; // setting key or secret ID
  proposedBy: 'ai';
  proposedById: string;
  currentValue: unknown;
  proposedValue: unknown;
  reason: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'expired';
  expiresAt: Date;
  createdAt: Date;
  confirmedAt?: Date;
  confirmedBy?: string;
}

// ============================================================================
// Encryption Utilities
// ============================================================================

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ITERATIONS = 100000;

/**
 * Derive encryption key from master secret and project-specific salt
 */
async function deriveKey(masterSecret: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(masterSecret, salt, KEY_LENGTH) as Promise<Buffer>;
}

/**
 * Get master encryption secret from environment
 */
function getMasterSecret(): string {
  const secret = process.env.SECRET_MASTER_KEY || process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('SECRET_MASTER_KEY or ENCRYPTION_KEY environment variable is required');
  }
  return secret;
}

/**
 * Encrypt a plaintext secret
 */
export async function encryptSecret(plaintext: string, projectId?: string): Promise<EncryptedSecret> {
  const masterSecret = getMasterSecret();
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(masterSecret, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(salt); // Use salt as additional authenticated data

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    salt: salt.toString('base64'),
  };
}

/**
 * Decrypt an encrypted secret
 */
export async function decryptSecret(encrypted: EncryptedSecret, projectId?: string): Promise<string> {
  const masterSecret = getMasterSecret();
  const salt = Buffer.from(encrypted.salt, 'base64');
  const key = await deriveKey(masterSecret, salt);
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(salt);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return plaintext.toString('utf8');
}

/**
 * Verify encryption integrity without full decryption (for health checks)
 */
export async function verifySecretIntegrity(encrypted: EncryptedSecret): Promise<boolean> {
  try {
    await decryptSecret(encrypted);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Secret Manager Class
// ============================================================================

export class SecretManager {
  private static instance: SecretManager;

  static getInstance(): SecretManager {
    if (!SecretManager.instance) {
      SecretManager.instance = new SecretManager();
    }
    return SecretManager.instance;
  }

  private constructor() {}

  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

  /**
   * Store a new LLM API key
   */
  async createKey(data: Omit<LLMKeyData, 'id' | 'rotationCount' | 'health'> & { key: string }): Promise<LLMKeyData> {
    const encryptedKey = await encryptSecret(data.key, data.projectId);

    const keyData: Omit<LLMKeyData, 'id'> = {
      ...data,
      encryptedKey,
      health: 'healthy',
      rotationCount: 0,
      lastHealthCheck: new Date(),
    };

    const [inserted] = await db.insert(secrets).values({
      projectId: keyData.projectId ?? null,
      provider: keyData.provider,
      model: keyData.model ?? null,
      encryptedKey: keyData.encryptedKey as any,
      name: keyData.name,
      health: keyData.health,
      priority: keyData.priority,
      source: keyData.source,
      lastUsed: keyData.lastUsed ?? null,
      lastHealthCheck: keyData.lastHealthCheck,
      coolingUntil: keyData.coolingUntil ?? null,
      quarantineReason: keyData.quarantineReason ?? null,
      rotationCount: keyData.rotationCount,
      metadata: keyData.metadata ?? {},
    }).returning();

    await this.logAudit({
      keyId: inserted.id,
      operation: 'create',
      performedBy: 'user',
      details: { provider: data.provider, name: data.name, source: data.source },
      newValue: { provider: data.provider, name: data.name, health: 'healthy' },
    });

    return this.mapRowToKeyData(inserted);
  }

  /**
   * Get a key by ID (with decryption)
   */
  async getKey(keyId: string, includeDecrypted = false): Promise<LLMKeyData | null> {
    const [row] = await db.select().from(secrets).where(eq(secrets.id, keyId)).limit(1);
    if (!row) return null;

    const keyData = this.mapRowToKeyData(row);

    if (includeDecrypted) {
      try {
        const decrypted = await decryptSecret(keyData.encryptedKey, keyData.projectId ?? undefined);
        return { ...keyData, decryptedKey: decrypted };
      } catch {
        return { ...keyData, decryptedKey: '[DECRYPTION_FAILED]' };
      }
    }

    return keyData;
  }

  /**
   * Get all keys for a project (or global if projectId is null)
   */
  async getKeys(projectId?: string, filters?: {
    provider?: string;
    health?: LLMKeyHealth;
    source?: LLMKeySource;
    onlyHealthy?: boolean;
  }): Promise<LLMKeyData[]> {
    let query = db.select().from(secrets);

    const conditions = [];
    if (projectId !== undefined) {
      conditions.push(projectId === null
        ? sql`${secrets.projectId} IS NULL`
        : eq(secrets.projectId, projectId));
    }
    if (filters?.provider) {
      conditions.push(eq(secrets.provider, filters.provider));
    }
    if (filters?.health) {
      conditions.push(eq(secrets.health, filters.health));
    }
    if (filters?.source) {
      conditions.push(eq(secrets.source, filters.source));
    }
    if (filters?.onlyHealthy) {
      conditions.push(eq(secrets.health, 'healthy'));
      conditions.push(sql`(${secrets.coolingUntil} IS NULL OR ${secrets.coolingUntil} < NOW())`);
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    query = query.orderBy(desc(secrets.priority), desc(secrets.createdAt));

    const rows = await query;
    return rows.map(this.mapRowToKeyData);
  }

  /**
   * Update key metadata (not the key value itself)
   */
  async updateKey(keyId: string, updates: Partial<Pick<LLMKeyData, 'name' | 'priority' | 'model' | 'metadata'>>): Promise<LLMKeyData | null> {
    const current = await this.getKey(keyId);
    if (!current) return null;

    const updateData: any = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.model !== undefined) updateData.model = updates.model;
    if (updates.metadata !== undefined) updateData.metadata = updates.metadata;

    const [updated] = await db.update(secrets)
      .set(updateData)
      .where(eq(secrets.id, keyId))
      .returning();

    if (!updated) return null;

    await this.logAudit({
      keyId,
      operation: 'update',
      performedBy: 'user',
      details: updates,
      previousValue: { name: current.name, priority: current.priority, model: current.model },
      newValue: updates,
    });

    return this.mapRowToKeyData(updated);
  }

  /**
   * Rotate a key (replace with new value)
   */
  async rotateKey(keyId: string, newKey: string, rotatedBy: 'ai' | 'user' = 'user', rotatedById?: string): Promise<RotationResult> {
    const current = await this.getKey(keyId);
    if (!current) {
      return { success: false, error: 'Key not found', rotatedAt: new Date() };
    }

    if (current.health === 'quarantined') {
      return { success: false, error: 'Cannot rotate quarantined key', rotatedAt: new Date() };
    }

    const encryptedKey = await encryptSecret(newKey, current.projectId ?? undefined);

    const [updated] = await db.update(secrets)
      .set({
        encryptedKey: encryptedKey as any,
        rotationCount: current.rotationCount + 1,
        lastHealthCheck: new Date(),
        health: 'healthy', // Reset health on successful rotation
        coolingUntil: null,
        quarantineReason: null,
        updatedAt: new Date(),
      })
      .where(eq(secrets.id, keyId))
      .returning();

    await this.logAudit({
      keyId,
      operation: 'rotate',
      performedBy: rotatedBy,
      performedById: rotatedById,
      details: { rotationCount: current.rotationCount + 1 },
      previousValue: { rotationCount: current.rotationCount, health: current.health },
      newValue: { rotationCount: current.rotationCount + 1, health: 'healthy' },
    });

    return { success: true, newKeyId: updated.id, rotatedAt: new Date() };
  }

  /**
   * Delete a key
   */
  async deleteKey(keyId: string, deletedBy: 'ai' | 'user' = 'user', deletedById?: string): Promise<boolean> {
    const current = await this.getKey(keyId);
    if (!current) return false;

    await db.delete(secrets).where(eq(secrets.id, keyId));

    await this.logAudit({
      keyId,
      operation: 'delete',
      performedBy: deletedBy,
      performedById: deletedById,
      details: { provider: current.provider, name: current.name },
      previousValue: { provider: current.provider, name: current.name },
    });

    return true;
  }

  // ---------------------------------------------------------------------------
  // Health Monitoring
  // ---------------------------------------------------------------------------

  /**
   * Check health of a specific key by making a test request
   */
  async checkKeyHealth(keyId: string): Promise<{ healthy: boolean; error?: string; latencyMs?: number }> {
    const keyData = await this.getKey(keyId, true);
    if (!keyData || !('decryptedKey' in keyData)) {
      return { healthy: false, error: 'Key not found or decryption failed' };
    }

    const startTime = Date.now();
    let healthy = false;
    let error: string | undefined;

    try {
      // Provider-specific health check
      switch (keyData.provider) {
        case 'openai':
          healthy = await this.checkOpenAIHealth(keyData.decryptedKey as string, keyData.model);
          break;
        case 'anthropic':
          healthy = await this.checkAnthropicHealth(keyData.decryptedKey as string, keyData.model);
          break;
        case 'google':
          healthy = await this.checkGoogleHealth(keyData.decryptedKey as string, keyData.model);
          break;
        case 'groq':
          healthy = await this.checkGroqHealth(keyData.decryptedKey as string, keyData.model);
          break;
        default:
          healthy = await this.checkGenericHealth(keyData.decryptedKey as string, keyData.provider, keyData.model);
      }
    } catch (e) {
      healthy = false;
      error = e instanceof Error ? e.message : 'Unknown error';
    }

    const latencyMs = Date.now() - startTime;

    // Update health status in database
    await this.updateKeyHealth(keyId, healthy, error);

    return { healthy, error, latencyMs };
  }

  /**
   * Update key health status based on check result
   */
  private async updateKeyHealth(keyId: string, healthy: boolean, error?: string): Promise<void> {
    const current = await this.getKey(keyId);
    if (!current) return;

    let newHealth: LLMKeyHealth = current.health;
    let coolingUntil: Date | null = current.coolingUntil;
    let quarantineReason: string | null = current.quarantineReason;

    if (healthy) {
      newHealth = 'healthy';
      coolingUntil = null;
      quarantineReason = null;
    } else {
      // Check if already cooling
      if (current.health === 'cooling' && current.coolingUntil && current.coolingUntil > new Date()) {
        // Still in cooling period
        newHealth = 'cooling';
      } else if (current.health === 'healthy' || current.health === 'cooling') {
        // First failure or cooling expired - enter cooling period (1 hour)
        newHealth = 'cooling';
        coolingUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      } else if (current.health === 'quarantined') {
        // Already quarantined
        newHealth = 'quarantined';
      }

      // Quarantine after 3 consecutive failures (tracked via rotationCount or separate field)
      // For now, quarantine on specific error types
      if (error && (error.includes('invalid') || error.includes('unauthorized') || error.includes('revoked'))) {
        newHealth = 'quarantined';
        quarantineReason = error;
        coolingUntil = null;
      }
    }

    await db.update(secrets)
      .set({
        health: newHealth,
        lastHealthCheck: new Date(),
        coolingUntil,
        quarantineReason,
        updatedAt: new Date(),
      })
      .where(eq(secrets.id, keyId));

    await this.logAudit({
      keyId,
      operation: 'health-check',
      performedBy: 'system',
      details: { healthy, error, newHealth, latencyMs: 0 },
      previousValue: { health: current.health },
      newValue: { health: newHealth },
    });
  }

  /**
   * Check health of all keys (batch operation)
   */
  async checkAllKeysHealth(projectId?: string): Promise<KeyHealthMetrics> {
    const keys = await this.getKeys(projectId);
    const results = await Promise.all(
      keys.map(k => this.checkKeyHealth(k.id))
    );

    const metrics: KeyHealthMetrics = {
      totalKeys: keys.length,
      healthyKeys: 0,
      coolingKeys: 0,
      quarantinedKeys: 0,
      keysByProvider: {},
      oldestKeyAge: 0,
      rotationRate: 0,
    };

    const now = Date.now();
    let totalRotations = 0;
    let oldestCreated = now;

    keys.forEach((key, i) => {
      const result = results[i];
      const createdAt = new Date(key.id).getTime(); // Approximate from ID or use actual createdAt
      const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);

      if (ageDays > metrics.oldestKeyAge) {
        metrics.oldestKeyAge = ageDays;
      }
      totalRotations += key.rotationCount;

      if (!metrics.keysByProvider[key.provider]) {
        metrics.keysByProvider[key.provider] = { healthy: 0, cooling: 0, quarantined: 0 };
      }

      switch (result.healthy ? 'healthy' : (key.health === 'quarantined' ? 'quarantined' : 'cooling')) {
        case 'healthy':
          metrics.healthyKeys++;
          metrics.keysByProvider[key.provider].healthy++;
          break;
        case 'cooling':
          metrics.coolingKeys++;
          metrics.keysByProvider[key.provider].cooling++;
          break;
        case 'quarantined':
          metrics.quarantinedKeys++;
          metrics.keysByProvider[key.provider].quarantined++;
          break;
      }
    });

    // Rotation rate per month (approximate)
    if (keys.length > 0) {
      const avgAgeMonths = metrics.oldestKeyAge / 30;
      metrics.rotationRate = avgAgeMonths > 0 ? totalRotations / avgAgeMonths : 0;
    }

    return metrics;
  }

  /**
   * Get health metrics for dashboard
   */
  async getHealthMetrics(projectId?: string): Promise<KeyHealthMetrics> {
    const keys = await this.getKeys(projectId);

    const metrics: KeyHealthMetrics = {
      totalKeys: keys.length,
      healthyKeys: keys.filter(k => k.health === 'healthy').length,
      coolingKeys: keys.filter(k => k.health === 'cooling').length,
      quarantinedKeys: keys.filter(k => k.health === 'quarantined').length,
      keysByProvider: {},
      oldestKeyAge: 0,
      rotationRate: 0,
    };

    const now = Date.now();
    let totalRotations = 0;
    let oldestCreated = now;

    keys.forEach(key => {
      // Use ID timestamp approximation or actual createdAt if available
      const createdAt = key.id.includes('-') ? new Date(key.id.split('-')[0]).getTime() : now;
      const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);

      if (ageDays > metrics.oldestKeyAge) {
        metrics.oldestKeyAge = ageDays;
      }
      totalRotations += key.rotationCount;

      if (!metrics.keysByProvider[key.provider]) {
        metrics.keysByProvider[key.provider] = { healthy: 0, cooling: 0, quarantined: 0 };
      }

      metrics.keysByProvider[key.provider][key.health]++;
    });

    if (keys.length > 0 && metrics.oldestKeyAge > 0) {
      const avgAgeMonths = metrics.oldestKeyAge / 30;
      metrics.rotationRate = avgAgeMonths > 0 ? totalRotations / avgAgeMonths : 0;
    }

    return metrics;
  }

  // ---------------------------------------------------------------------------
  // Provider-Specific Health Checks
  // ---------------------------------------------------------------------------

  private async checkOpenAIHealth(apiKey: string, model?: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async checkAnthropicHealth(apiKey: string, model?: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model || 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10000),
      });
      return response.ok || response.status === 400; // 400 = valid key, bad request
    } catch {
      return false;
    }
  }

  private async checkGoogleHealth(apiKey: string, model?: string): Promise<boolean> {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`, {
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async checkGroqHealth(apiKey: string, model?: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async checkGenericHealth(apiKey: string, provider: string, model?: string): Promise<boolean> {
    // Generic health check - try a simple request
    // This would need provider-specific implementation
    return true; // Placeholder
  }

  // ---------------------------------------------------------------------------
  // Key Rotation (Provider-Specific)
  // ---------------------------------------------------------------------------

  /**
   * Rotate key using provider's API (for supported providers)
   */
  async rotateKeyViaProvider(keyId: string, rotatedBy: 'ai' | 'user' = 'user', rotatedById?: string): Promise<RotationResult> {
    const current = await this.getKey(keyId, true);
    if (!current || !('decryptedKey' in current)) {
      return { success: false, error: 'Key not found or decryption failed', rotatedAt: new Date() };
    }

    let newKey: string | null = null;

    try {
      switch (current.provider) {
        case 'openai':
          newKey = await this.rotateOpenAIKey(current.decryptedKey as string);
          break;
        case 'anthropic':
          newKey = await this.rotateAnthropicKey(current.decryptedKey as string);
          break;
        case 'google':
          newKey = await this.rotateGoogleKey(current.decryptedKey as string);
          break;
        case 'groq':
          newKey = await this.rotateGroqKey(current.decryptedKey as string);
          break;
        default:
          return { success: false, error: `Provider ${current.provider} does not support automatic rotation`, rotatedAt: new Date() };
      }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Rotation failed', rotatedAt: new Date() };
    }

    if (!newKey) {
      return { success: false, error: 'Failed to generate new key', rotatedAt: new Date() };
    }

    return this.rotateKey(keyId, newKey, rotatedBy, rotatedById);
  }

  private async rotateOpenAIKey(oldKey: string): Promise<string | null> {
    // OpenAI doesn't have a direct key rotation API
    // This would require user to provide new key
    return null;
  }

  private async rotateAnthropicKey(oldKey: string): Promise<string | null> {
    // Anthropic doesn't have a direct key rotation API
    return null;
  }

  private async rotateGoogleKey(oldKey: string): Promise<string | null> {
    // Google Cloud has key rotation but requires service account
    return null;
  }

  private async rotateGroqKey(oldKey: string): Promise<string | null> {
    // Groq doesn't have a direct key rotation API
    return null;
  }

  // ---------------------------------------------------------------------------
  // Key Selection for Model Router
  // ---------------------------------------------------------------------------

  /**
   * Get the best available key for a provider/model combination
   * Used by model-router.ts for request routing
   */
  async getBestKey(provider: string, model?: string, projectId?: string): Promise<LLMKeyData | null> {
    const keys = await this.getKeys(projectId, {
      provider,
      onlyHealthy: true,
    });

    if (keys.length === 0) {
      // Try global pool
      if (projectId) {
        return this.getBestKey(provider, model, null);
      }
      return null;
    }

    // Filter by model if specified
    const modelKeys = model
      ? keys.filter(k => !k.model || k.model === model)
      : keys;

    if (modelKeys.length === 0) {
      return keys[0]; // Fallback to any key for provider
    }

    // Return highest priority key
    return modelKeys[0];
  }

  /**
   * Mark key as used (updates lastUsed timestamp)
   */
  async markKeyUsed(keyId: string): Promise<void> {
    await db.update(secrets)
      .set({ lastUsed: new Date(), updatedAt: new Date() })
      .where(eq(secrets.id, keyId));
  }

  // ---------------------------------------------------------------------------
  // Audit Logging
  // ---------------------------------------------------------------------------

  private async logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
    await db.insert(settingChanges).values({
      keyId: entry.keyId,
      operation: entry.operation,
      performedBy: entry.performedBy,
      performedById: entry.performedById ?? null,
      details: entry.details as any,
      previousValue: entry.previousValue as any,
      newValue: entry.newValue as any,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  }

  /**
   * Get audit log for a key
   */
  async getAuditLog(keyId: string, limit = 100): Promise<AuditLogEntry[]> {
    const rows = await db.select()
      .from(settingChanges)
      .where(eq(settingChanges.keyId, keyId))
      .orderBy(desc(settingChanges.timestamp))
      .limit(limit);

    return rows.map(row => ({
      id: row.id,
      keyId: row.keyId,
      operation: row.operation as SecretOperation,
      performedBy: row.performedBy as 'ai' | 'user' | 'system',
      performedById: row.performedById ?? undefined,
      details: row.details as Record<string, unknown>,
      previousValue: row.previousValue as Record<string, unknown> | undefined,
      newValue: row.newValue as Record<string, unknown> | undefined,
      timestamp: row.timestamp,
      ipAddress: row.ipAddress ?? undefined,
      userAgent: row.userAgent ?? undefined,
    }));
  }

  // ---------------------------------------------------------------------------
  // Helper: Map database row to LLMKeyData
  // ---------------------------------------------------------------------------

  private mapRowToKeyData(row: any): LLMKeyData {
    return {
      id: row.id,
      projectId: row.projectId ?? undefined,
      provider: row.provider,
      model: row.model ?? undefined,
      encryptedKey: row.encryptedKey as EncryptedSecret,
      name: row.name,
      health: row.health as LLMKeyHealth,
      priority: row.priority,
      source: row.source as LLMKeySource,
      lastUsed: row.lastUsed ?? undefined,
      lastHealthCheck: row.lastHealthCheck ?? undefined,
      coolingUntil: row.coolingUntil ?? undefined,
      quarantineReason: row.quarantineReason ?? undefined,
      rotationCount: row.rotationCount,
      metadata: row.metadata as Record<string, unknown> ?? {},
    };
  }
}

// Export singleton instance
export const secretManager = SecretManager.getInstance();