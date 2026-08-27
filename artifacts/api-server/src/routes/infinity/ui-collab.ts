/**
 * UI Collaboration Routes
 *
 * Handles preview sharing, comments, reviews for collaborative UI generation workflows.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireScope, AuthenticatedRequest } from '../../middleware/auth-middleware.js';
import { previewSharingService } from '../../lib/preview-sharing.js';
import { uiCommentsEngine } from '../../lib/ui-comments.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateShareSchema = z.object({
  projectId: z.string().uuid(),
  componentId: z.string().uuid().optional(),
  previewUrl: z.string().url(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  accessLevel: z.enum(['public', 'private', 'password']).default('public'),
  password: z.string().min(4).max(100).optional(),
  expiresAt: z.string().datetime().optional(),
  expiresInDays: z.number().min(1).max(365).optional(),
  allowedEmails: z.array(z.string().email()).optional(),
  allowedDomains: z.array(z.string()).optional(),
  enableComments: z.boolean().default(true),
  enableReactions: z.boolean().default(true),
  notifyOnComment: z.boolean().default(true),
});

const UpdateShareSchema = CreateShareSchema.partial().omit({ projectId: true, componentId: true });

const CreateCommentSchema = z.object({
  shareId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  elementSelector: z.string().optional(),
  elementData: z.object({
    tagName: z.string(),
    className: z.string().optional(),
    props: z.record(z.any()).optional(),
    rect: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }).optional(),
  }).optional(),
  authorName: z.string().min(1).max(100),
  authorEmail: z.string().email().optional(),
  authorAvatar: z.string().url().optional(),
  content: z.string().min(1).max(5000),
  mentionedEmails: z.array(z.string().email()).optional(),
});

const UpdateCommentSchema = z.object({
  content: z.string().min(1).max(5000),
});

const ReactionSchema = z.object({
  emoji: z.string().min(1).max(10),
  userEmail: z.string().email(),
});

const ResolveSchema = z.object({
  resolved: z.boolean(),
  resolvedBy: z.string().uuid().optional(),
});

const CheckAccessSchema = z.object({
  token: z.string(),
  email: z.string().email().optional(),
  password: z.string().optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

async function getDesignSystemForProject(projectId: string) {
  try {
    // Import dynamically to avoid circular deps
    const { getProjectDesignSystem } = await import('../../lib/design-canvas.js');
    return await getProjectDesignSystem(projectId);
  } catch {
    return null;
  }
}

// ============================================================================
// Preview Sharing Routes
// ============================================================================

/**
 * POST /api/infinity/ui-collab/shares
 * Create a new preview share link
 */
router.post('/shares', requireScope('build:write'), async (req: Request, res: Response) => {
  try {
    const validated = CreateShareSchema.parse(req.body);
    const authReq = req as AuthenticatedRequest;

    // Calculate expiration
    let expiresAt: Date | undefined;
    if (validated.expiresAt) {
      expiresAt = new Date(validated.expiresAt);
    } else if (validated.expiresInDays) {
      expiresAt = new Date(Date.now() + validated.expiresInDays * 24 * 60 * 60 * 1000);
    }

    const share = await previewSharingService.createShare(
      {
        ...validated,
        expiresAt,
      },
      authReq.accountId
    );

    // Return share with full URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/preview/${share.shareToken}`;

    res.status(201).json({
      ...share,
      shareUrl,
      password: undefined, // Never return password
      passwordHash: undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Create share error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create share' });
  }
});

/**
 * GET /api/infinity/ui-collab/shares
 * Get all shares for a project
 */
router.get('/shares', requireScope('build:read'), async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const shares = await previewSharingService.getSharesByProject(projectId);

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const sharesWithUrls = shares.map(share => ({
      ...share,
      shareUrl: `${baseUrl}/preview/${share.shareToken}`,
      password: undefined,
      passwordHash: undefined,
    }));

    res.json({ shares: sharesWithUrls });
  } catch (error) {
    console.error('Get shares error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get shares' });
  }
});

/**
 * GET /api/infinity/ui-collab/shares/:shareId
 * Get a specific share by ID
 */
router.get('/shares/:shareId', requireScope('build:read'), async (req: Request, res: Response) => {
  try {
    const { shareId } = req.params;

    // We need to get by ID - add method to service
    // For now, get all project shares and find by ID
    const projectId = req.query.projectId as string;
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const shares = await previewSharingService.getSharesByProject(projectId);
    const share = shares.find(s => s.id === shareId);

    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.json({
      ...share,
      shareUrl: `${baseUrl}/preview/${share.shareToken}`,
      password: undefined,
      passwordHash: undefined,
    });
  } catch (error) {
    console.error('Get share error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get share' });
  }
});

/**
 * PATCH /api/infinity/ui-collab/shares/:shareId
 * Update a share
 */
router.patch('/shares/:shareId', requireScope('build:write'), async (req: Request, res: Response) => {
  try {
    const { shareId } = req.params;
    const authReq = req as AuthenticatedRequest;
    const validated = UpdateShareSchema.parse(req.body);

    let expiresAt: Date | undefined;
    if (validated.expiresAt) {
      expiresAt = new Date(validated.expiresAt);
    } else if (validated.expiresInDays) {
      expiresAt = new Date(Date.now() + validated.expiresInDays * 24 * 60 * 60 * 1000);
    }

    const updates = {
      ...validated,
      expiresAt,
    };

    const share = await previewSharingService.updateShare(shareId, updates, authReq.accountId);

    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.json({
      ...share,
      shareUrl: `${baseUrl}/preview/${share.shareToken}`,
      password: undefined,
      passwordHash: undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Update share error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update share' });
  }
});

/**
 * DELETE /api/infinity/ui-collab/shares/:shareId
 * Delete a share
 */
router.delete('/shares/:shareId', requireScope('build:write'), async (req: Request, res: Response) => {
  try {
    const { shareId } = req.params;
    const deleted = await previewSharingService.deleteShare(shareId);

    if (!deleted) {
      return res.status(404).json({ error: 'Share not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete share error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete share' });
  }
});

/**
 * GET /api/infinity/ui-collab/shares/:shareId/analytics
 * Get share analytics
 */
router.get('/shares/:shareId/analytics', requireScope('build:read'), async (req: Request, res: Response) => {
  try {
    const { shareId } = req.params;
    const analytics = await previewSharingService.getShareAnalytics(shareId);
    res.json(analytics);
  } catch (error) {
    console.error('Get share analytics error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get analytics' });
  }
});

// ============================================================================
// Public Preview Access (no auth required)
// ============================================================================

/**
 * GET /api/infinity/ui-collab/preview/:token
 * Access a shared preview (public endpoint)
 */
router.get('/preview/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const email = req.query.email as string | undefined;
    const password = req.query.password as string | undefined;

    const result = await previewSharingService.checkAccess(token, { email, password });

    if (!result.allowed) {
      return res.status(403).json({
        error: result.reason || 'Access denied',
        requiresPassword: result.requiresPassword,
      });
    }

    const share = await previewSharingService.getShareByToken(token);
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }

    // Return preview info (frontend will load the actual preview iframe)
    res.json({
      previewUrl: share.previewUrl,
      title: share.title,
      description: share.description,
      enableComments: share.enableComments,
      enableReactions: share.enableReactions,
      shareToken: share.shareToken,
    });
  } catch (error) {
    console.error('Preview access error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to access preview' });
  }
});

/**
 * POST /api/infinity/ui-collab/preview/:token/check-access
 * Check access to a preview (for password-protected shares)
 */
router.post('/preview/:token/check-access', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const validated = CheckAccessSchema.omit({ token: true }).parse(req.body);

    const result = await previewSharingService.checkAccess(token, validated);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Check access error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to check access' });
  }
});

// ============================================================================
// Comment Routes
// ============================================================================

/**
 * POST /api/infinity/ui-collab/comments
 * Create a new comment
 */
router.post('/comments', async (req: Request, res: Response) => {
  try {
    const validated = CreateCommentSchema.parse(req.body);

    // Check if share allows comments
    const share = await previewSharingService.getShareByToken(
      // We need shareId, not token - for now assume body has shareId
      ''
    );
    // TODO: Get share from validated.shareId and check enableComments

    const comment = await uiCommentsEngine.createComment(validated);

    res.status(201).json(comment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Create comment error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create comment' });
  }
});

/**
 * GET /api/infinity/ui-collab/comments
 * Get comments for a share
 */
router.get('/comments', async (req: Request, res: Response) => {
  try {
    const shareId = req.query.shareId as string;
    if (!shareId) {
      return res.status(400).json({ error: 'shareId is required' });
    }

    const elementSelector = req.query.elementSelector as string | undefined;
    const includeResolved = req.query.includeResolved !== 'false';
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const comments = await uiCommentsEngine.getCommentsByShare(shareId, {
      elementSelector,
      includeResolved,
      limit,
      offset,
    });

    res.json({ comments });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get comments' });
  }
});

/**
 * GET /api/infinity/ui-collab/comments/:commentId/thread
 * Get full comment thread
 */
router.get('/comments/:commentId/thread', async (req: Request, res: Response) => {
  try {
    const { commentId } = req.params;
    const thread = await uiCommentsEngine.getCommentThread(commentId);

    if (!thread) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    res.json(thread);
  } catch (error) {
    console.error('Get comment thread error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get thread' });
  }
});

/**
 * PATCH /api/infinity/ui-collab/comments/:commentId
 * Update comment content
 */
router.patch('/comments/:commentId', async (req: Request, res: Response) => {
  try {
    const { commentId } = req.params;
    const validated = UpdateCommentSchema.parse(req.body);

    const comment = await uiCommentsEngine.updateComment(commentId, validated.content);

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    res.json(comment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Update comment error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update comment' });
  }
});

/**
 * DELETE /api/infinity/ui-collab/comments/:commentId
 * Delete comment
 */
router.delete('/comments/:commentId', async (req: Request, res: Response) => {
  try {
    const { commentId } = req.params;
    const deleted = await uiCommentsEngine.deleteComment(commentId);

    if (!deleted) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete comment' });
  }
});

/**
 * POST /api/infinity/ui-collab/comments/:commentId/reactions
 * Add reaction to comment
 */
router.post('/comments/:commentId/reactions', async (req: Request, res: Response) => {
  try {
    const { commentId } = req.params;
    const validated = ReactionSchema.parse(req.body);

    const reactions = await uiCommentsEngine.addReaction(commentId, validated.emoji, validated.userEmail);
    res.json({ reactions });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Add reaction error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to add reaction' });
  }
});

/**
 * DELETE /api/infinity/ui-collab/comments/:commentId/reactions
 * Remove reaction from comment
 */
router.delete('/comments/:commentId/reactions', async (req: Request, res: Response) => {
  try {
    const { commentId } = req.params;
    const validated = ReactionSchema.parse(req.body);

    const reactions = await uiCommentsEngine.removeReaction(commentId, validated.emoji, validated.userEmail);
    res.json({ reactions });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Remove reaction error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to remove reaction' });
  }
});

/**
 * PATCH /api/infinity/ui-collab/comments/:commentId/resolve
 * Resolve/unresolve comment
 */
router.patch('/comments/:commentId/resolve', async (req: Request, res: Response) => {
  try {
    const { commentId } = req.params;
    const validated = ResolveSchema.parse(req.body);

    const comment = await uiCommentsEngine.setResolved(commentId, validated.resolved, validated.resolvedBy);

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    res.json(comment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Resolve comment error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to resolve comment' });
  }
});

/**
 * GET /api/infinity/ui-collab/comments/count
 * Get comment counts for a share
 */
router.get('/comments/count', async (req: Request, res: Response) => {
  try {
    const shareId = req.query.shareId as string;
    if (!shareId) {
      return res.status(400).json({ error: 'shareId is required' });
    }

    const total = await uiCommentsEngine.getCommentCount(shareId, true);
    const unresolved = await uiCommentsEngine.getUnresolvedCount(shareId);

    res.json({ total, unresolved });
  } catch (error) {
    console.error('Get comment count error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get comment count' });
  }
});

/**
 * GET /api/infinity/ui-collab/comments/search
 * Search comments
 */
router.get('/comments/search', async (req: Request, res: Response) => {
  try {
    const shareId = req.query.shareId as string;
    const query = req.query.q as string;

    if (!shareId || !query) {
      return res.status(400).json({ error: 'shareId and q are required' });
    }

    const comments = await uiCommentsEngine.searchComments(shareId, query);
    res.json({ comments });
  } catch (error) {
    console.error('Search comments error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to search comments' });
  }
});

export default router;