/**
 * UI Collaboration Routes
 *
 * Handles preview sharing, comments, reviews for collaborative UI generation workflows.
 * Phase 18: SSE endpoints for real-time updates (comments, presence cursors)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireScope, AuthenticatedRequest } from '../../middleware/auth-middleware.js';
import { previewSharingService } from '../../lib/preview-sharing.js';
import { uiCommentsEngine } from '../../lib/ui-comments.js';

const router = Router();

// SSE connection storage for real-time updates
interface SSEClient {
  res: Response;
  shareId: string;
  userEmail: string;
  userName: string;
  userAvatar?: string;
  lastPing: number;
}

interface PresenceClient {
  res: Response;
  shareId: string;
  userEmail: string;
  userName: string;
  userAvatar?: string;
  cursor?: { x: number; y: number; selector?: string };
  lastPing: number;
}

const commentSSEClients = new Map<string, Set<SSEClient>>();
const presenceSSEClients = new Map<string, Set<PresenceClient>>();

// Cleanup intervals
setInterval(() => {
  const now = Date.now();
  // Clean up stale comment SSE connections (no ping for 60s)
  commentSSEClients.forEach((clients, shareId) => {
    clients.forEach(client => {
      if (now - client.lastPing > 60000) {
        try { client.res.end(); } catch {}
        clients.delete(client);
      }
    });
    if (clients.size === 0) commentSSEClients.delete(shareId);
  });
  // Clean up stale presence SSE connections
  presenceSSEClients.forEach((clients, shareId) => {
    clients.forEach(client => {
      if (now - client.lastPing > 60000) {
        try { client.res.end(); } catch {}
        clients.delete(client);
      }
    });
    if (clients.size === 0) presenceSSEClients.delete(shareId);
  });
}, 30000);

// Helper to broadcast to all SSE clients for a share
function broadcastCommentUpdate(shareId: string, event: string, data: any) {
  const clients = commentSSEClients.get(shareId);
  if (!clients) return;
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    try { client.res.write(message); } catch { clients.delete(client); }
  });
}

function broadcastPresenceUpdate(shareId: string, event: string, data: any, excludeEmail?: string) {
  const clients = presenceSSEClients.get(shareId);
  if (!clients) return;
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    if (client.userEmail !== excludeEmail) {
      try { client.res.write(message); } catch { clients.delete(client); }
    }
  });
}

function addCommentSSEClient(shareId: string, client: SSEClient) {
  if (!commentSSEClients.has(shareId)) commentSSEClients.set(shareId, new Set());
  commentSSEClients.get(shareId)!.add(client);
}

function removeCommentSSEClient(shareId: string, client: SSEClient) {
  commentSSEClients.get(shareId)?.delete(client);
  if (commentSSEClients.get(shareId)?.size === 0) commentSSEClients.delete(shareId);
}

function addPresenceSSEClient(shareId: string, client: PresenceClient) {
  if (!presenceSSEClients.has(shareId)) presenceSSEClients.set(shareId, new Set());
  presenceSSEClients.get(shareId)!.add(client);
}

function removePresenceSSEClient(shareId: string, client: PresenceClient) {
  presenceSSEClients.get(shareId)?.delete(client);
  if (presenceSSEClients.get(shareId)?.size === 0) presenceSSEClients.delete(shareId);
}

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
    const share = await previewSharingService.getShareById(validated.shareId);
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }
    if (!share.enableComments) {
      return res.status(403).json({ error: 'Comments are disabled for this share' });
    }

    const comment = await uiCommentsEngine.createComment(validated);

    // Broadcast SSE event for real-time updates
    broadcastCommentUpdate(validated.shareId, 'comment:created', {
      comment,
      timestamp: new Date().toISOString(),
    });

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

    // Broadcast SSE event
    broadcastCommentUpdate(comment.shareId, 'comment:updated', {
      comment,
      timestamp: new Date().toISOString(),
    });

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

    // First get the comment to know the shareId
    const comment = await uiCommentsEngine.getCommentById(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const shareId = comment.shareId;
    const deleted = await uiCommentsEngine.deleteComment(commentId);

    if (!deleted) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Broadcast SSE event
    broadcastCommentUpdate(shareId, 'comment:deleted', {
      commentId,
      timestamp: new Date().toISOString(),
    });

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

    // Get comment to find shareId for broadcasting
    const comment = await uiCommentsEngine.getCommentById(commentId);
    if (comment) {
      broadcastCommentUpdate(comment.shareId, 'comment:reaction', {
        commentId,
        emoji: validated.emoji,
        userEmail: validated.userEmail,
        reactions,
        timestamp: new Date().toISOString(),
      });
    }

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

    // Get comment to find shareId for broadcasting
    const comment = await uiCommentsEngine.getCommentById(commentId);
    if (comment) {
      broadcastCommentUpdate(comment.shareId, 'comment:reaction', {
        commentId,
        emoji: validated.emoji,
        userEmail: validated.userEmail,
        reactions,
        removed: true,
        timestamp: new Date().toISOString(),
      });
    }

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

    // Broadcast SSE event
    broadcastCommentUpdate(comment.shareId, 'comment:resolved', {
      comment,
      timestamp: new Date().toISOString(),
    });

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

// ============================================================================
// SSE Endpoints for Real-time Updates (Phase 18)
// ============================================================================

/**
 * GET /api/infinity/ui-collab/shares/:shareToken/comments/stream
 * SSE stream for real-time comment updates
 *
 * Events:
 * - comment:created - new comment added
 * - comment:updated - comment content changed
 * - comment:deleted - comment removed
 * - comment:resolved - comment resolved/unresolved
 * - comment:reaction - reaction added/removed
 * - ping - heartbeat
 */
router.get('/shares/:shareToken/comments/stream', async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userEmail = authReq.account?.email || req.query.email as string || 'anonymous';
    const userName = authReq.account?.name || req.query.name as string || 'Anonymous';
    const userAvatar = authReq.account?.avatar || req.query.avatar as string | undefined;

    // Verify share exists and user has access
    const share = await previewSharingService.getShareByToken(shareToken);
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }

    // Check access
    const accessResult = await previewSharingService.checkAccess(shareToken, { email: userEmail });
    if (!accessResult.allowed) {
      return res.status(403).json({ error: 'Access denied to this share' });
    }

    const shareId = share.id;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ shareId, shareToken, timestamp: new Date().toISOString() })}\n\n`);

    // Create client
    const client: SSEClient = {
      res,
      shareId,
      userEmail,
      userName,
      userAvatar,
      lastPing: Date.now(),
    };

    addCommentSSEClient(shareId, client);

    // Heartbeat interval
    const pingInterval = setInterval(() => {
      client.lastPing = Date.now();
      try {
        res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      } catch {
        clearInterval(pingInterval);
      }
    }, 30000);

    // Handle client disconnect
    req.on('close', () => {
      clearInterval(pingInterval);
      removeCommentSSEClient(shareId, client);
    });

  } catch (error) {
    console.error('SSE comments stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to establish SSE connection' });
    }
  }
});

/**
 * GET /api/infinity/ui-collab/shares/:shareToken/presence/stream
 * SSE stream for real-time presence cursors
 *
 * Events:
 * - presence:join - user joined
 * - presence:leave - user left
 * - presence:cursor - cursor position update
 * - presence:selection - element selection update
 * - ping - heartbeat
 */
router.get('/shares/:shareToken/presence/stream', async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userEmail = authReq.account?.email || req.query.email as string || 'anonymous';
    const userName = authReq.account?.name || req.query.name as string || 'Anonymous';
    const userAvatar = authReq.account?.avatar || req.query.avatar as string | undefined;

    // Verify share exists and user has access
    const share = await previewSharingService.getShareByToken(shareToken);
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }

    // Check access
    const accessResult = await previewSharingService.checkAccess(shareToken, { email: userEmail });
    if (!accessResult.allowed) {
      return res.status(403).json({ error: 'Access denied to this share' });
    }

    const shareId = share.id;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ shareId, shareToken, timestamp: new Date().toISOString() })}\n\n`);

    // Create client
    const client: PresenceClient = {
      res,
      shareId,
      userEmail,
      userName,
      userAvatar,
      lastPing: Date.now(),
    };

    addPresenceSSEClient(shareId, client);

    // Notify others of join
    broadcastPresenceUpdate(shareId, 'presence:join', {
      userEmail: client.userEmail,
      userName: client.userName,
      userAvatar: client.userAvatar,
      timestamp: new Date().toISOString(),
    }, userEmail);

    // Heartbeat interval
    const pingInterval = setInterval(() => {
      client.lastPing = Date.now();
      try {
        res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      } catch {
        clearInterval(pingInterval);
      }
    }, 30000);

    // Handle incoming cursor updates from client
    // Note: In a real implementation, you'd use a separate POST endpoint for cursor updates
    // For SSE, we can accept cursor updates via query params or a separate route

    // Handle client disconnect
    req.on('close', () => {
      clearInterval(pingInterval);
      removePresenceSSEClient(shareId, client);

      // Notify others of leave
      broadcastPresenceUpdate(shareId, 'presence:leave', {
        userEmail: client.userEmail,
        userName: client.userName,
        timestamp: new Date().toISOString(),
      });
    });

  } catch (error) {
    console.error('SSE presence stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to establish SSE connection' });
    }
  }
});

/**
 * POST /api/infinity/ui-collab/shares/:shareToken/presence/cursor
 * Update cursor position for presence
 */
const CursorUpdateSchema = z.object({
  userEmail: z.string().email(),
  userName: z.string().min(1).max(100),
  userAvatar: z.string().url().optional(),
  x: z.number(),
  y: z.number(),
  selector: z.string().optional(),
  elementData: z.object({
    tagName: z.string(),
    className: z.string().optional(),
  }).optional(),
});

router.post('/shares/:shareToken/presence/cursor', async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const validated = CursorUpdateSchema.parse(req.body);

    // Verify share exists
    const share = await previewSharingService.getShareByToken(shareToken);
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const shareId = share.id;

    // Broadcast cursor update to all other clients
    broadcastPresenceUpdate(shareId, 'presence:cursor', {
      userEmail: validated.userEmail,
      userName: validated.userName,
      userAvatar: validated.userAvatar,
      x: validated.x,
      y: validated.y,
      selector: validated.selector,
      elementData: validated.elementData,
      timestamp: new Date().toISOString(),
    }, validated.userEmail);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Cursor update error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update cursor' });
  }
});

/**
 * POST /api/infinity/ui-collab/shares/:shareToken/presence/selection
 * Update element selection for presence
 */
const SelectionUpdateSchema = z.object({
  userEmail: z.string().email(),
  userName: z.string().min(1).max(100),
  userAvatar: z.string().url().optional(),
  selector: z.string(),
  elementData: z.object({
    tagName: z.string(),
    className: z.string().optional(),
    bounds: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }).optional(),
  }).optional(),
});

router.post('/shares/:shareToken/presence/selection', async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const validated = SelectionUpdateSchema.parse(req.body);

    // Verify share exists
    const share = await previewSharingService.getShareByToken(shareToken);
    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const shareId = share.id;

    // Broadcast selection update to all other clients
    broadcastPresenceUpdate(shareId, 'presence:selection', {
      userEmail: validated.userEmail,
      userName: validated.userName,
      userAvatar: validated.userAvatar,
      selector: validated.selector,
      elementData: validated.elementData,
      timestamp: new Date().toISOString(),
    }, validated.userEmail);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Selection update error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update selection' });
  }
});

// Update comment creation to broadcast SSE
// We'll wrap the createComment call in the route to broadcast
// But first we need to modify the existing comment routes to broadcast

export default router;