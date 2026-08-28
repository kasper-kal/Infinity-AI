/**
 * Preview Sharing Service
 *
 * Generates shareable links for live previews with commenting enabled.
 * Supports public/private links, password protection, expiration, and access control.
 */

import { randomBytes, createHash } from 'crypto';
import { db, previewShares, previewShareAccess } from '@workspace/db';
import { eq, and, gt, lt, desc, sql } from 'drizzle-orm';

export interface PreviewShareConfig {
  projectId: string;
  componentId?: string;
  previewUrl: string;
  title: string;
  description?: string;
  accessLevel: 'public' | 'private' | 'password';
  password?: string;
  expiresAt?: Date;
  allowedEmails?: string[];
  allowedDomains?: string[];
  enableComments: boolean;
  enableReactions: boolean;
  notifyOnComment: boolean;
}

export interface PreviewShare {
  id: string;
  projectId: string;
  componentId?: string;
  previewUrl: string;
  title: string;
  description?: string;
  shareToken: string;
  accessLevel: 'public' | 'private' | 'password';
  passwordHash?: string;
  expiresAt?: Date;
  allowedEmails?: string[];
  allowedDomains?: string[];
  enableComments: boolean;
  enableReactions: boolean;
  notifyOnComment: boolean;
  viewCount: number;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
  requiresPassword?: boolean;
}

export class PreviewSharingService {
  private static instance: PreviewSharingService;

  static getInstance(): PreviewSharingService {
    if (!PreviewSharingService.instance) {
      PreviewSharingService.instance = new PreviewSharingService();
    }
    return PreviewSharingService.instance;
  }

  /**
   * Generate a secure share token
   */
  private generateShareToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Hash password for storage
   */
  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  /**
   * Verify password against hash
   */
  private verifyPassword(password: string, hash: string): boolean {
    return this.hashPassword(password) === hash;
  }

  /**
   * Create a new preview share
   */
  async createShare(config: PreviewShareConfig, createdBy: string): Promise<PreviewShare> {
    const shareToken = this.generateShareToken();
    const passwordHash = config.password ? this.hashPassword(config.password) : undefined;

    const share: typeof previewShares.$inferInsert = {
      projectId: config.projectId,
      componentId: config.componentId,
      previewUrl: config.previewUrl,
      title: config.title,
      description: config.description,
      shareToken,
      accessLevel: config.accessLevel,
      passwordHash,
      expiresAt: config.expiresAt,
      allowedEmails: config.allowedEmails || [],
      allowedDomains: config.allowedDomains || [],
      enableComments: config.enableComments,
      enableReactions: config.enableReactions,
      notifyOnComment: config.notifyOnComment,
      viewCount: 0,
      commentCount: 0,
      createdBy,
    };

    const [created] = await db.insert(previewShares).values(share).returning();
    return this.mapRowToShare(created);
  }

  /**
   * Get share by token
   */
  async getShareByToken(token: string): Promise<PreviewShare | null> {
    const [share] = await db
      .select()
      .from(previewShares)
      .where(eq(previewShares.shareToken, token))
      .limit(1);

    if (!share) return null;
    return this.mapRowToShare(share);
  }

  /**
   * Get share by ID
   */
  async getShareById(id: string): Promise<PreviewShare | null> {
    const [share] = await db
      .select()
      .from(previewShares)
      .where(eq(previewShares.id, id))
      .limit(1);

    if (!share) return null;
    return this.mapRowToShare(share);
  }

  /**
   * Get shares for a project
   */
  async getSharesByProject(projectId: string): Promise<PreviewShare[]> {
    const rows = await db
      .select()
      .from(previewShares)
      .where(eq(previewShares.projectId, projectId))
      .orderBy(desc(previewShares.createdAt));

    return rows.map(this.mapRowToShare);
  }

  /**
   * Check access to a preview share
   */
  async checkAccess(
    token: string,
    options?: {
      email?: string;
      password?: string;
      ip?: string;
    }
  ): Promise<AccessCheckResult> {
    const share = await this.getShareByToken(token);
    if (!share) {
      return { allowed: false, reason: 'Share not found' };
    }

    // Check expiration
    if (share.expiresAt && new Date() > share.expiresAt) {
      return { allowed: false, reason: 'Share has expired' };
    }

    // Check access level
    switch (share.accessLevel) {
      case 'public':
        break; // Always allowed

      case 'password':
        if (!options?.password || !share.passwordHash || !this.verifyPassword(options.password, share.passwordHash)) {
          return { allowed: false, reason: 'Invalid password', requiresPassword: true };
        }
        break;

      case 'private':
        if (options?.email) {
          const allowedEmails = share.allowedEmails || [];
          const allowedDomains = share.allowedDomains || [];
          const emailDomain = options.email.split('@')[1];

          const emailAllowed = allowedEmails.includes(options.email);
          const domainAllowed = allowedDomains.includes(emailDomain);

          if (!emailAllowed && !domainAllowed) {
            return { allowed: false, reason: 'Email not authorized for this private share' };
          }
        } else {
          return { allowed: false, reason: 'Private share requires authentication' };
        }
        break;
    }

    // Record access
    await this.recordAccess(share.id, options?.email, options?.ip);

    return { allowed: true };
  }

  /**
   * Record access for analytics
   */
  private async recordAccess(shareId: string, email?: string, ip?: string): Promise<void> {
    await db.insert(previewShareAccess).values({
      shareId,
      email,
      ip,
      accessedAt: new Date(),
    });

    // Increment view count
    await db
      .update(previewShares)
      .set({
        viewCount: sql`${previewShares.viewCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(previewShares.id, shareId));
  }

  /**
   * Update share configuration
   */
  async updateShare(
    shareId: string,
    updates: Partial<PreviewShareConfig>,
    updatedBy: string
  ): Promise<PreviewShare | null> {
    const updateData: Partial<typeof previewShares.$inferInsert> = {
      ...updates,
      updatedAt: new Date(),
    };

    if (updates.password) {
      updateData.passwordHash = this.hashPassword(updates.password);
    }

    const [updated] = await db
      .update(previewShares)
      .set(updateData)
      .where(eq(previewShares.id, shareId))
      .returning();

    if (!updated) return null;
    return this.mapRowToShare(updated);
  }

  /**
   * Delete a share
   */
  async deleteShare(shareId: string): Promise<boolean> {
    const result = await db.delete(previewShares).where(eq(previewShares.id, shareId));
    return result.rowsAffected > 0;
  }

  /**
   * Increment comment count
   */
  async incrementCommentCount(shareId: string): Promise<void> {
    await db
      .update(previewShares)
      .set({
        commentCount: sql`${previewShares.commentCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(previewShares.id, shareId));
  }

  /**
   * Get share analytics
   */
  async getShareAnalytics(shareId: string): Promise<{
    views: number;
    comments: number;
    uniqueViewers: number;
    accessLog: Array<{ email?: string; ip?: string; accessedAt: Date }>;
  }> {
    const share = await db
      .select()
      .from(previewShares)
      .where(eq(previewShares.id, shareId))
      .limit(1);

    if (!share[0]) {
      throw new Error('Share not found');
    }

    const accessLog = await db
      .select()
      .from(previewShareAccess)
      .where(eq(previewShareAccess.shareId, shareId))
      .orderBy(desc(previewShareAccess.accessedAt))
      .limit(100);

    const uniqueEmails = new Set(accessLog.map(a => a.email).filter(Boolean));
    const uniqueIps = new Set(accessLog.map(a => a.ip).filter(Boolean));

    return {
      views: share[0].viewCount,
      comments: share[0].commentCount,
      uniqueViewers: uniqueEmails.size + uniqueIps.size,
      accessLog: accessLog.map(a => ({
        email: a.email || undefined,
        ip: a.ip || undefined,
        accessedAt: a.accessedAt,
      })),
    };
  }

  private mapRowToShare(row: typeof previewShares.$inferSelect): PreviewShare {
    return {
      id: row.id,
      projectId: row.projectId,
      componentId: row.componentId,
      previewUrl: row.previewUrl,
      title: row.title,
      description: row.description,
      shareToken: row.shareToken,
      accessLevel: row.accessLevel,
      passwordHash: row.passwordHash,
      expiresAt: row.expiresAt,
      allowedEmails: row.allowedEmails,
      allowedDomains: row.allowedDomains,
      enableComments: row.enableComments,
      enableReactions: row.enableReactions,
      notifyOnComment: row.notifyOnComment,
      viewCount: row.viewCount,
      commentCount: row.commentCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
    };
  }
}

export const previewSharingService = PreviewSharingService.getInstance();