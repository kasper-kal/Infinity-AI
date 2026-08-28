/**
 * CommentOverlay — Element-level comment overlay for LivePreview
 *
 * Renders comment markers and threads anchored to specific elements in the preview iframe.
 * Communicates with parent via postMessage for selection sync.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, MessageSquare, ChevronDown, ChevronUp, ThumbsUp, Flag, AtSign, MoreHorizontal } from 'lucide-react';
import { Button, IconButton } from '@/components/ui';
import { Input, Textarea } from '@/components/ui';
import { Avatar } from '@/components/ui';
import { Tooltip } from '@/components/ui';
import { ScrollArea } from '@/components/ui';
import { formatDistanceToNow } from 'date-fns';

export interface CommentElementData {
  tagName: string;
  className?: string;
  props?: Record<string, any>;
  rect?: { x: number; y: number; width: number; height: number };
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
  replies?: Comment[];
}

export interface CommentOverlayProps {
  shareToken: string;
  comments: Comment[];
  selectedCommentId?: string;
  onSelectComment: (commentId: string) => void;
  onAddComment: (selector: string, elementData: CommentElementData, content: string, mentions?: string[]) => Promise<void>;
  onReply: (parentId: string, content: string, mentions?: string[]) => Promise<void>;
  onResolve: (commentId: string, resolved: boolean) => Promise<void>;
  onReact: (commentId: string, emoji: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  currentUser?: { name: string; email: string; avatar?: string };
  iframeRef: React.RefObject<HTMLIFrameElement>;
  enabled?: boolean;
}

const EMOJI_REACTIONS = ['👍', '👎', '❤️', '🎉', '😄', '🤔', '🚀', '🐛'];

export const CommentOverlay: React.FC<CommentOverlayProps> = ({
  shareToken,
  comments,
  selectedCommentId,
  onSelectComment,
  onAddComment,
  onReply,
  onResolve,
  onReact,
  onDelete,
  currentUser,
  iframeRef,
  enabled = true,
}) => {
  const [hoveredElement, setHoveredElement] = useState<{ selector: string; rect: DOMRect } | null>(null);
  const [showCommentForm, setShowCommentForm] = useState<{ selector: string; elementData: CommentElementData } | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Filter top-level comments (not replies)
  const topLevelComments = useMemo(() =>
    comments.filter(c => !c.parentId),
    [comments]
  );

  // Get replies for a comment
  const getReplies = useCallback((parentId: string) =>
    comments.filter(c => c.parentId === parentId),
    [comments]
  );

  // Listen for element selection from iframe
  useEffect(() => {
    if (!enabled || !iframeRef.current) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data.type === 'element-hover') {
        setHoveredElement({ selector: event.data.selector, rect: event.data.rect });
      } else if (event.data.type === 'element-leave') {
        setHoveredElement(null);
      } else if (event.data.type === 'element-click') {
        // Check if clicking on an element with existing comments
        const existingComment = topLevelComments.find(c => c.elementSelector === event.data.selector);
        if (existingComment) {
          onSelectComment(existingComment.id);
        } else if (currentUser) {
          // Show comment form for new comment
          setShowCommentForm({
            selector: event.data.selector,
            elementData: event.data.elementData,
          });
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [enabled, iframeRef, topLevelComments, onSelectComment, currentUser]);

  const handleAddComment = async (content: string, mentions: string[] = []) => {
    if (!showCommentForm || !content.trim()) return;
    await onAddComment(showCommentForm.selector, showCommentForm.elementData, content, mentions);
    setShowCommentForm(null);
  };

  const handleSubmitReply = async (parentId: string) => {
    if (!replyContent.trim()) return;
    await onReply(parentId, replyContent, []);
    setReplyingTo(null);
    setReplyContent('');
  };

  const handleReact = async (commentId: string, emoji: string) => {
    await onReact(commentId, emoji);
  };

  const handleResolve = async (commentId: string, resolved: boolean) => {
    await onResolve(commentId, resolved);
  };

  const handleDelete = async (commentId: string) => {
    if (!window.confirm('Delete this comment?')) return;
    await onDelete(commentId);
  };

  const handleEdit = async (commentId: string) => {
    if (!editContent.trim()) return;
    // TODO: Implement edit comment API
    setEditingCommentId(null);
    setEditContent('');
  };

  // Render comment markers on elements
  const renderMarkers = () => {
    if (!iframeRef.current || !iframeRef.current.contentDocument) return null;

    return topLevelComments.map(comment => {
      if (!comment.elementSelector) return null;

      try {
        const element = iframeRef.current?.contentDocument?.querySelector(comment.elementSelector);
        if (!element) return null;

        const rect = element.getBoundingClientRect();
        const iframeRect = iframeRef.current?.getBoundingClientRect();
        if (!iframeRect) return null;

        return (
          <div
            key={comment.id}
            className={`fixed z-50 transition-all duration-200 ${
              selectedCommentId === comment.id ? 'ring-2 ring-primary' : ''
            }`}
            style={{
              left: iframeRect.left + rect.left + window.scrollX,
              top: iframeRect.top + rect.top + window.scrollY,
              width: rect.width,
              height: rect.height,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectComment(comment.id);
            }}
          >
            {/* Comment count badge */}
            <div
              className="absolute -top-6 -right-2 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center shadow-lg"
            >
              {comment.replyCount > 0 ? comment.replyCount + 1 : 1}
            </div>
            {/* Element highlight */}
            <div
              className="absolute inset-0 border-2 border-primary/50 bg-primary/10 rounded"
              style={{ pointerEvents: 'none' }}
            />
          </div>
        );
      } catch {
        return null;
      }
    });
  };

  // Render comment sidebar for selected comment
  const renderCommentThread = () => {
    if (!selectedCommentId) return null;

    const comment = comments.find(c => c.id === selectedCommentId);
    if (!comment) return null;

    const replies = getReplies(comment.id);

    return (
      <div className="fixed right-0 top-0 bottom-0 w-96 bg-card border-l border-border shadow-apple-xl z-50 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold">Comments</h3>
          <IconButton onClick={() => onSelectComment('')} variant="ghost" size="icon">
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Comment Thread */}
        <ScrollArea className="flex-1 p-4 space-y-4 overflow-y-auto">
          {/* Main Comment */}
          <CommentCard
            comment={comment}
            depth={0}
            onReply={() => setReplyingTo(comment.id)}
            onReact={handleReact}
            onResolve={(resolved) => handleResolve(comment.id, resolved)}
            onEdit={() => { setEditingCommentId(comment.id); setEditContent(comment.content); }}
            onDelete={() => handleDelete(comment.id)}
            currentUser={currentUser}
            isEditing={editingCommentId === comment.id}
            editContent={editContent}
            onEditChange={setEditContent}
            onSaveEdit={() => handleEdit(comment.id)}
          />

          {/* Replies */}
          {replies.map(reply => (
            <CommentCard
              key={reply.id}
              comment={reply}
              depth={1}
              onReply={() => setReplyingTo(reply.id)}
              onReact={handleReact}
              onResolve={(resolved) => handleResolve(reply.id, resolved)}
              onEdit={() => { setEditingCommentId(reply.id); setEditContent(reply.content); }}
              onDelete={() => handleDelete(reply.id)}
              currentUser={currentUser}
              isEditing={editingCommentId === reply.id}
              editContent={editContent}
              onEditChange={setEditContent}
              onSaveEdit={() => handleEdit(reply.id)}
            />
          ))}

          {/* Reply Form */}
          {replyingTo && (
            <div className="ml-8 mt-2 flex gap-2">
              <Avatar src={currentUser?.avatar} fallback={currentUser?.name?.[0] || 'U'} size="sm" />
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSubmitReply(replyingTo))}
                  placeholder="Write a reply..."
                  className="flex-1 px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button size="sm" onClick={() => handleSubmitReply(replyingTo)} disabled={!replyContent.trim()}>
                  Reply
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>

        {/* New Comment Form (when adding to element) */}
        {showCommentForm && (
          <div className="p-4 border-t border-border">
            <div className="flex gap-2">
              <Avatar src={currentUser?.avatar} fallback={currentUser?.name?.[0] || 'U'} size="sm" />
              <div className="flex-1 flex flex-col gap-2">
                <Textarea
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAddComment(replyContent))}
                  placeholder="Add a comment..."
                  rows={2}
                  className="px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowCommentForm(null)}>Cancel</Button>
                  <Button size="sm" onClick={() => handleAddComment(replyContent)} disabled={!replyContent.trim()}>Comment</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {enabled && renderMarkers()}
      {renderCommentThread()}
    </>
  );
};

interface CommentCardProps {
  comment: Comment;
  depth: number;
  onReply: () => void;
  onReact: (commentId: string, emoji: string) => Promise<void>;
  onResolve: (resolved: boolean) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  currentUser?: { name: string; email: string; avatar?: string };
  isEditing: boolean;
  editContent: string;
  onEditChange: (content: string) => void;
  onSaveEdit: () => void;
}

const CommentCard: React.FC<CommentCardProps> = ({
  comment,
  depth,
  onReply,
  onReact,
  onResolve,
  onEdit,
  onDelete,
  currentUser,
  isEditing,
  editContent,
  onEditChange,
  onSaveEdit,
}) => {
  const isAuthor = currentUser && comment.authorEmail === currentUser.email;
  const [showReactions, setShowReactions] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const userReacted = (emoji: string) => comment.reactions[emoji]?.includes(currentUser?.email || '') || false;
  const reactionCount = (emoji: string) => comment.reactions[emoji]?.length || 0;

  if (isEditing) {
    return (
      <div className={`ml-${depth * 8} flex gap-2`}>
        <Avatar src={comment.authorAvatar} fallback={comment.authorName?.[0] || 'U'} size="sm" />
        <div className="flex-1 flex flex-col gap-2">
          <Textarea
            value={editContent}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), onSaveEdit())}
            rows={3}
            className="px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onEdit}>Cancel</Button>
            <Button size="sm" onClick={onSaveEdit} disabled={!editContent.trim()}>Save</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`ml-${depth * 8} flex gap-2 ${comment.isResolved ? 'opacity-60' : ''}`}>
      <Avatar src={comment.authorAvatar} fallback={comment.authorName?.[0] || 'U'} size="sm" />
      <div className="flex-1">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{comment.authorName}</span>
              {comment.authorEmail && (
                <span className="text-xs text-muted-foreground">{comment.authorEmail}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
              </span>
              {comment.isResolved && (
                <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                  Resolved
                </span>
              )}
            </div>
            <p className="text-sm mt-1">{comment.content}</p>
          </div>
          <div className="flex items-center gap-1">
            {/* Reactions */}
            <div className="relative">
              <button
                onClick={() => setShowReactions(!showReactions)}
                className="p-1 rounded hover:bg-secondary transition"
              >
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
              </button>
              {showReactions && (
                <div className="absolute bottom-full right-0 mb-1 flex gap-1 p-1 bg-popover border border-border rounded-lg shadow-lg">
                  {EMOJI_REACTIONS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => onReact(comment.id, emoji)}
                      className={`p-1.5 rounded transition ${
                        userReacted(emoji) ? 'bg-primary/20 ring-2 ring-primary' : 'hover:bg-secondary'
                      }`}
                      title={`${reactionCount(emoji)} ${userReacted(emoji) ? '(you)' : ''}`}
                    >
                      <span style={{ fontSize: '14px' }}>{emoji}</span>
                      {reactionCount(emoji) > 0 && (
                        <span className="text-xs ml-0.5">{reactionCount(emoji)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Menu */}
            {isAuthor && (
              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1 rounded hover:bg-secondary transition"
                >
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 w-36 bg-popover border border-border rounded-lg shadow-lg py-1 z-10">
                    <button onClick={onEdit} className="w-full px-3 py-1.5 text-left text-sm hover:bg-secondary">
                      Edit
                    </button>
                    <button onClick={() => onResolve(!comment.isResolved)} className="w-full px-3 py-1.5 text-left text-sm hover:bg-secondary">
                      {comment.isResolved ? 'Unresolve' : 'Resolve'}
                    </button>
                    <button onClick={onDelete} className="w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10">
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Reply Button */}
            <button onClick={onReply} className="p-1 rounded hover:bg-secondary transition text-muted-foreground hover:text-foreground">
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Reactions Display */}
        {Object.keys(comment.reactions).length > 0 && (
          <div className="flex gap-1 mt-2">
            {Object.entries(comment.reactions).map(([emoji, users]) => (
              <span key={emoji} className="px-2 py-0.5 text-xs bg-secondary rounded-full flex items-center gap-1">
                <span style={{ fontSize: '12px' }}>{emoji}</span>
                <span>{users.length}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommentOverlay;