/**
 * UI Comments Engine
 *
 * Element-level comments for preview shares with threading, reactions,
 * mentions, and resolution workflow.
 */

import { db } from '../db/index.js';
import {
  previewComments,
  previewCommentMentions,
  previewShares,
} from '../db/schema/preview-shares.js';
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export interface CommentElementData {
  tagName: string;
  className?: string;
  props?: Record<string, any>;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface CreateCommentInput {
  shareId: string;
  parentId?: string;
  elementSelector?: string;
  elementData?: CommentElementData;
  authorName: string;
  authorEmail?: string;
  authorAvatar?: string;
  content: string;
  mentionedEmails?: string[];
}

export interface Comment {
  id: string;
  shareId: string;
  parentId?: string;
  elementSelector?: string;
  elementData?: CommentElementData;
  authorName: string;
  authorEmail?: string;
  authorAvatar?: string;
  content: string;
  isResolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  reactions: Record<string, string[]>;
  mentions: string[];
  replyCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommentThread {
  comment: Comment;
  replies: Comment[];
}

export class UICommentsEngine {
  private static instance: UICommentsEngine;

  static getInstance(): UICommentsEngine {
    if (!UICommentsEngine.instance) {
      UICommentsEngine.instance = new UICommentsEngine();
    }
    return UICommentsEngine.instance;
  }

  /**
   * Create a new comment
   */
  async createComment(input: CreateCommentInput): Promise<Comment> {
    const commentId = randomUUID();

    // Insert comment
    const [comment] = await db
      .insert(previewComments)
      .values({
        id: commentId,
        shareId: input.shareId,
        parentId: input.parentId,
        elementSelector: input.elementSelector,
        elementData: input.elementData,
        authorName: input.authorName,
        authorEmail: input.authorEmail,
        authorAvatar: input.authorAvatar,
        content: input.content,
        reactions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Handle mentions
    if (input.mentionedEmails && input.mentionedEmails.length > 0) {
      await db.insert(previewCommentMentions).values(
        input.mentionedEmails.map(email => ({
          commentId,
          mentionedEmail: email,
          notified: false,
        }))
      );
    }

    // Update parent reply count if this is a reply
    if (input.parentId) {
      await db
        .update(previewComments)
        .set({
          // We'll calculate reply count on read
          updatedAt: new Date(),
        })
        .where(eq(previewComments.id, input.parentId));
    }

    // Increment share comment count
    await db
      .update(previewShares)
      .set({
        commentCount: sql`${previewShares.commentCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(previewShares.id, input.shareId));

    return this.mapRowToComment(comment, input.mentionedEmails || []);
  }

  /**
   * Get comments for a share (top-level only)
   */
  async getCommentsByShare(shareId: string, options?: {
    elementSelector?: string;
    includeResolved?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Comment[]> {
    let query = db
      .select()
      .from(previewComments)
      .where(
        and(
          eq(previewComments.shareId, shareId),
          input.parentId === undefined ? sql`${previewComments.parentId} IS NULL` : eq(previewComments.parentId, input.parentId)
        )
      );

    if (options?.elementSelector) {
      query = query.where(eq(previewComments.elementSelector, options.elementSelector));
    }

    if (options?.includeResolved === false) {
      query = query.where(eq(previewComments.isResolved, false));
    }

    query = query.orderBy(desc(previewComments.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.offset(options.offset);
    }

    const rows = await query;

    // Get mentions for all comments
    const commentIds = rows.map(r => r.id);
    const mentions = commentIds.length > 0
      ? await db
          .select()
          .from(previewCommentMentions)
          .where(inArray(previewCommentMentions.commentId, commentIds))
      : [];

    const mentionsByComment = new Map<string, string[]>();
    for (const mention of mentions) {
      const existing = mentionsByComment.get(mention.commentId) || [];
      existing.push(mention.mentionedEmail);
      mentionsByComment.set(mention.commentId, existing);
    }

    // Get reply counts
    const replyCounts = await this.getReplyCounts(commentIds);

    return rows.map(row => this.mapRowToComment(row, mentionsByComment.get(row.id) || [], replyCounts.get(row.id) || 0));
  }

  /**
   * Get full thread for a comment (comment + all replies)
   */
  async getCommentThread(commentId: string): Promise<CommentThread | null> {
    const [comment] = await db
      .select()
      .from(previewComments)
      .where(eq(previewComments.id, commentId))
      .limit(1);

    if (!comment) return null;

    const replies = await this.getReplies(commentId);

    const mentions = await db
      .select()
      .from(previewCommentMentions)
      .where(
        inArray(
          previewCommentMentions.commentId,
          [commentId, ...replies.map(r => r.id)]
        )
      );

    const mentionsByComment = new Map<string, string[]>();
    for (const mention of mentions) {
      const existing = mentionsByComment.get(mention.commentId) || [];
      existing.push(mention.mentionedEmail);
      mentionsByComment.set(mention.commentId, existing);
    }

    const replyCounts = await this.getReplyCounts([commentId, ...replies.map(r => r.id)]);

    return {
      comment: this.mapRowToComment(comment, mentionsByComment.get(commentId) || [], replyCounts.get(commentId) || 0),
      replies: replies.map(r =>
        this.mapRowToComment(r, mentionsByComment.get(r.id) || [], replyCounts.get(r.id) || 0)
      ),
    };
  }

  /**
   * Get replies for a comment (recursive)
   */
  async getReplies(parentId: string, depth = 0, maxDepth = 3): Promise<Comment[]> {
    if (depth >= maxDepth) return [];

    const rows = await db
      .select()
      .from(previewComments)
      .where(eq(previewComments.parentId, parentId))
      .orderBy(asc(previewComments.createdAt));

    const results: Comment[] = [];
    for (const row of rows) {
      const mentions = await db
        .select()
        .from(previewCommentMentions)
        .where(eq(previewCommentMentions.commentId, row.id));

      const replyCounts = await this.getReplyCounts([row.id]);
      const replyMentions = mentions.map(m => m.mentionedEmail);

      results.push(this.mapRowToComment(row, replyMentions, replyCounts.get(row.id) || 0));

      // Recursively get nested replies
      const nestedReplies = await this.getReplies(row.id, depth + 1, maxDepth);
      results.push(...nestedReplies);
    }

    return results;
  }

  /**
   * Add reaction to comment
   */
  async addReaction(commentId: string, emoji: string, userEmail: string): Promise<Record<string, string[]>> {
    const [comment] = await db
      .select()
      .from(previewComments)
      .where(eq(previewComments.id, commentId))
      .limit(1);

    if (!comment) {
      throw new Error('Comment not found');
    }

    const reactions = comment.reactions as Record<string, string[]> || {};
    const users = reactions[emoji] || [];

    if (!users.includes(userEmail)) {
      users.push(userEmail);
      reactions[emoji] = users;

      await db
        .update(previewComments)
        .set({
          reactions,
          updatedAt: new Date(),
        })
        .where(eq(previewComments.id, commentId));
    }

    return reactions;
  }

  /**
   * Remove reaction from comment
   */
  async removeReaction(commentId: string, emoji: string, userEmail: string): Promise<Record<string, string[]>> {
    const [comment] = await db
      .select()
      .from(previewComments)
      .where(eq(previewComments.id, commentId))
      .limit(1);

    if (!comment) {
      throw new Error('Comment not found');
    }

    const reactions = comment.reactions as Record<string, string[]> || {};
    const users = reactions[emoji] || [];
    const filtered = users.filter(u => u !== userEmail);

    if (filtered.length === 0) {
      delete reactions[emoji];
    } else {
      reactions[emoji] = filtered;
    }

    await db
      .update(previewComments)
      .set({
        reactions,
        updatedAt: new Date(),
      })
      .where(eq(previewComments.id, commentId));

    return reactions;
  }

  /**
   * Resolve/unresolve comment
   */
  async setResolved(commentId: string, resolved: boolean, resolvedBy?: string): Promise<Comment | null> {
    const [updated] = await db
      .update(previewComments)
      .set({
        isResolved: resolved,
        resolvedBy: resolved ? resolvedBy : null,
        resolvedAt: resolved ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(previewComments.id, commentId))
      .returning();

    if (!updated) return null;
    return this.mapRowToComment(updated, [], 0);
  }

  /**
   * Update comment content
   */
  async updateComment(commentId: string, content: string): Promise<Comment | null> {
    const [updated] = await db
      .update(previewComments)
      .set({
        content,
        updatedAt: new Date(),
      })
      .where(eq(previewComments.id, commentId))
      .returning();

    if (!updated) return null;
    return this.mapRowToComment(updated, [], 0);
  }

  /**
   * Delete comment (soft delete - mark as deleted)
   */
  async deleteComment(commentId: string): Promise<boolean> {
    // Delete mentions first
    await db.delete(previewCommentMentions).where(eq(previewCommentMentions.commentId, commentId));

    // Delete comment
    const result = await db.delete(previewComments).where(eq(previewComments.id, commentId));
    return result.rowsAffected > 0;
  }

  /**
   * Get comments for specific element
   */
  async getCommentsByElement(shareId: string, elementSelector: string): Promise<Comment[]> {
    return this.getCommentsByShare(shareId, { elementSelector });
  }

  /**
   * Get comment count for share
   */
  async getCommentCount(shareId: string, includeResolved = true): Promise<number> {
    const conditions = [eq(previewComments.shareId, shareId)];
    if (!includeResolved) {
      conditions.push(eq(previewComments.isResolved, false));
    }

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(previewComments)
      .where(and(...conditions));

    return result?.count || 0;
  }

  /**
   * Get unresolved comment count
   */
  async getUnresolvedCount(shareId: string): Promise<number> {
    return this.getCommentCount(shareId, false);
  }

  /**
   * Search comments
   */
  async searchComments(shareId: string, query: string): Promise<Comment[]> {
    const rows = await db
      .select()
      .from(previewComments)
      .where(
        and(
          eq(previewComments.shareId, shareId),
          sql`${previewComments.content} ILIKE ${'%' + query + '%'}`
        )
      )
      .orderBy(desc(previewComments.createdAt))
      .limit(50);

    const commentIds = rows.map(r => r.id);
    const mentions = commentIds.length > 0
      ? await db
          .select()
          .from(previewCommentMentions)
          .where(inArray(previewCommentMentions.commentId, commentIds))
      : [];

    const mentionsByComment = new Map<string, string[]>();
    for (const mention of mentions) {
      const existing = mentionsByComment.get(mention.commentId) || [];
      existing.push(mention.mentionedEmail);
      mentionsByComment.set(mention.commentId, existing);
    }

    const replyCounts = await this.getReplyCounts(commentIds);

    return rows.map(row => this.mapRowToComment(row, mentionsByComment.get(row.id) || [], replyCounts.get(row.id) || 0));
  }

  /**
   * Mark mentions as notified
   */
  async markMentionsNotified(commentId: string): Promise<void> {
    await db
      .update(previewCommentMentions)
      .set({ notified: true })
      .where(eq(previewCommentMentions.commentId, commentId));
  }

  /**
   * Get pending notifications for user
   */
  async getPendingNotifications(email: string): Promise<Array<{ commentId: string; shareId: string; content: string }>> {
    const mentions = await db
      .select({
        commentId: previewCommentMentions.commentId,
        shareId: previewComments.shareId,
        content: previewComments.content,
      })
      .from(previewCommentMentions)
      .innerJoin(previewComments, eq(previewCommentMentions.commentId, previewComments.id))
      .where(
        and(
          eq(previewCommentMentions.mentionedEmail, email),
          eq(previewCommentMentions.notified, false)
        )
      );

    return mentions;
  }

  /**
   * Get a single comment by ID
   */
  async getCommentById(commentId: string): Promise<Comment | null> {
    const [row] = await db
      .select()
      .from(previewComments)
      .where(eq(previewComments.id, commentId))
      .limit(1);

    if (!row) return null;

    const mentions = await db
      .select()
      .from(previewCommentMentions)
      .where(eq(previewCommentMentions.commentId, commentId));

    const replyCounts = await this.getReplyCounts([commentId]);

    return this.mapRowToComment(row, mentions.map(m => m.mentionedEmail), replyCounts.get(commentId) || 0);
  }

  private async getReplyCounts(commentIds: string[]): Promise<Map<string, number>> {
    if (commentIds.length === 0) return new Map();

    const results = await db
      .select({
        parentId: previewComments.parentId,
        count: sql<number>`count(*)`,
      })
      .from(previewComments)
      .where(inArray(previewComments.parentId, commentIds))
      .groupBy(previewComments.parentId);

    const map = new Map<string, number>();
    for (const r of results) {
      if (r.parentId) {
        map.set(r.parentId, Number(r.count));
      }
    }
    return map;
  }

  private mapRowToComment(
    row: typeof previewComments.$inferSelect,
    mentions: string[] = [],
    replyCount = 0
  ): Comment {
    return {
      id: row.id,
      shareId: row.shareId,
      parentId: row.parentId || undefined,
      elementSelector: row.elementSelector || undefined,
      elementData: row.elementData as CommentElementData | undefined,
      authorName: row.authorName,
      authorEmail: row.authorEmail || undefined,
      authorAvatar: row.authorAvatar || undefined,
      content: row.content,
      isResolved: row.isResolved,
      resolvedBy: row.resolvedBy || undefined,
      resolvedAt: row.resolvedAt || undefined,
      reactions: row.reactions as Record<string, string[]> || {},
      mentions,
      replyCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const uiCommentsEngine = UICommentsEngine.getInstance();