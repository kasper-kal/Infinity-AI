/**
 * CommentSidebar — Comment thread sidebar for ChatView UI Builder mode
 *
 * Displays all comments for a share with filtering, search, and thread views.
 * Integrates with LivePreview for element highlighting.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Search, Filter, X, MessageSquare, ChevronRight, ChevronDown, ThumbsUp, Flag, AtSign, MoreHorizontal, Bell, BellOff, Loader2 } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { Tooltip } from '@/components/ui/Tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
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

export interface CommentSidebarProps {
  shareToken: string;
  comments: Comment[];
  isLoading?: boolean;
  totalCount?: number;
  unresolvedCount?: number;
  onLoadMore: () => Promise<void>;
  onAddComment: (selector: string, elementData: CommentElementData, content: string, mentions?: string[]) => Promise<void>;
  onReply: (parentId: string, content: string, mentions?: string[]) => Promise<void>;
  onResolve: (commentId: string, resolved: boolean) => Promise<void>;
  onReact: (commentId: string, emoji: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onHighlightElement: (selector: string) => void;
  onSearch: (query: string) => Promise<void>;
  onFilterChange: (filter: CommentFilter) => void;
  currentUser?: { name: string; email: string; avatar?: string };
  iframeRef?: React.RefObject<HTMLIFrameElement>;
}

export interface CommentFilter {
  showResolved: boolean;
  elementSelector?: string;
  authorEmail?: string;
  sortBy: 'newest' | 'oldest' | 'mostReplies';
}

const DEFAULT_FILTER: CommentFilter = {
  showResolved: true,
  sortBy: 'newest',
};

const EMOJI_REACTIONS = ['👍', '👎', '❤️', '🎉', '😄', '🤔', '🚀', '🐛'];

export const CommentSidebar: React.FC<CommentSidebarProps> = ({
  shareToken,
  comments,
  isLoading = false,
  totalCount = 0,
  unresolvedCount = 0,
  onLoadMore,
  onAddComment,
  onReply,
  onResolve,
  onReact,
  onDelete,
  onHighlightElement,
  onSearch,
  onFilterChange,
  currentUser,
  iframeRef,
}) => {
  const [filter, setFilter] = useState<CommentFilter>(DEFAULT_FILTER);
  const [searchQuery, setSearchQuery] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [showMenuFor, setShowMenuFor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Update filter when props change
  useEffect(() => {
    onFilterChange(filter);
  }, [filter, onFilterChange]);

  // Filter and sort comments
  const filteredComments = useMemo(() => {
    let result = [...comments];

    // Filter resolved
    if (!filter.showResolved) {
      result = result.filter(c => !c.isResolved);
    }

    // Filter by element
    if (filter.elementSelector) {
      result = result.filter(c => c.elementSelector === filter.elementSelector);
    }

    // Filter by author
    if (filter.authorEmail) {
      result = result.filter(c => c.authorEmail === filter.authorEmail);
    }

    // Sort
    result.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      switch (filter.sortBy) {
        case 'oldest': return dateA - dateB;
        case 'mostReplies': return b.replyCount - a.replyCount;
        default: return dateB - dateA; // newest
      }
    });

    return result;
  }, [comments, filter]);

  // Get top-level comments
  const topLevelComments = useMemo(() =>
    filteredComments.filter(c => !c.parentId),
    [filteredComments]
  );

  // Get replies for a comment
  const getReplies = useCallback((parentId: string) =>
    filteredComments.filter(c => c.parentId === parentId),
    [filteredComments]
  );

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    await onSearch(query);
  }, [onSearch]);

  const handleFilterChange = (newFilter: Partial<CommentFilter>) => {
    setFilter(prev => ({ ...prev, ...newFilter }));
  };

  const handleAddComment = async (content: string) => {
    // This would be called from a comment form - for sidebar we don't have element selector
    // The actual element commenting is done via CommentOverlay in the preview
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

  const handleHighlight = (selector?: string) => {
    if (selector && iframeRef?.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'highlight-element',
        selector,
      }, '*');
      onHighlightElement(selector);
    }
  };

  const userReacted = (comment: Comment, emoji: string) =>
    comment.reactions[emoji]?.includes(currentUser?.email || '') || false;
  const reactionCount = (comment: Comment, emoji: string) =>
    comment.reactions[emoji]?.length || 0;

  const renderCommentThread = (comment: Comment, depth = 0) => {
    const replies = getReplies(comment.id);
    const isAuthor = currentUser && comment.authorEmail === currentUser.email;

    if (editingCommentId === comment.id) {
      return (
        <div key={comment.id} className={`ml-${depth * 8} flex gap-2`}>
          <Avatar src={comment.authorAvatar} fallback={comment.authorName?.[0] || 'U'} size="sm" />
          <div className="flex-1 flex flex-col gap-2">
            <input
              type="text"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleEdit(comment.id))}
              className="px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditingCommentId(null)}>Cancel</Button>
              <Button size="sm" onClick={() => handleEdit(comment.id)} disabled={!editContent.trim()}>Save</Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={comment.id} className={`ml-${depth * 8} flex gap-2 ${comment.isResolved ? 'opacity-60' : ''}`}>
        <Avatar src={comment.authorAvatar} fallback={comment.authorName?.[0] || 'U'} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm truncate">{comment.authorName}</span>
                {comment.authorEmail && (
                  <span className="text-xs text-muted-foreground truncate">{comment.authorEmail}</span>
                )}
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                </span>
                {comment.isResolved && (
                  <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded-full whitespace-nowrap">
                    Resolved
                  </span>
                )}
                {comment.elementSelector && (
                  <Tooltip content="Highlight element in preview">
                    <button
                      onClick={() => handleHighlight(comment.elementSelector)}
                      className="p-1 rounded hover:bg-secondary transition text-muted-foreground hover:text-foreground"
                      aria-label="Highlight element"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  </Tooltip>
                )}
              </div>
              <p className="text-sm mt-1 break-words">{comment.content}</p>
            </div>
            <div className="flex items-center gap-1">
              {/* Reactions */}
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMenuFor(comment.id); }}
                  className="p-1 rounded hover:bg-secondary transition"
                >
                  <ThumbsUp className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {/* Menu for author */}
              {isAuthor && showMenuFor === comment.id && (
                <div className="absolute right-0 top-full mt-1 w-36 bg-popover border border-border rounded-lg shadow-lg py-1 z-10">
                  <button
                    onClick={() => { setEditingCommentId(comment.id); setEditContent(comment.content); setShowMenuFor(null); }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-secondary"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => { handleResolve(comment.id, !comment.isResolved); setShowMenuFor(null); }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-secondary"
                  >
                    {comment.isResolved ? 'Unresolve' : 'Resolve'}
                  </button>
                  <button
                    onClick={() => { handleDelete(comment.id); setShowMenuFor(null); }}
                    className="w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                  >
                    Delete
                  </button>
                </div>
              )}

              {/* Reply Button */}
              <button
                onClick={() => { setReplyingTo(comment.id); setShowMenuFor(null); }}
                className="p-1 rounded hover:bg-secondary transition text-muted-foreground hover:text-foreground"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Reactions Display */}
          {Object.keys(comment.reactions).length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {Object.entries(comment.reactions).map(([emoji, users]) => (
                <button
                  key={emoji}
                  onClick={() => handleReact(comment.id, emoji)}
                  className={`px-2 py-0.5 text-xs rounded-full flex items-center gap-1 transition ${
                    userReacted(comment, emoji) ? 'bg-primary/20 ring-1 ring-primary' : 'bg-secondary hover:bg-secondary/80'
                  }`}
                  title={`${users.length} ${userReacted(comment, emoji) ? '(you)' : ''}`}
                >
                  <span style={{ fontSize: '12px' }}>{emoji}</span>
                  <span>{users.length}</span>
                </button>
              ))}
              {/* Quick add reaction */}
              {!Object.keys(comment.reactions).includes('👍') && (
                <button
                  onClick={() => handleReact(comment.id, '👍')}
                  className="px-2 py-0.5 text-xs bg-secondary/50 rounded-full text-muted-foreground hover:bg-secondary"
                >
                  <span style={{ fontSize: '12px' }}>👍</span>
                </button>
              )}
            </div>
          )}

          {/* Reply Form */}
          {replyingTo === comment.id && (
            <div className="mt-2 flex gap-2">
              <Avatar src={currentUser?.avatar} fallback={currentUser?.name?.[0] || 'U'} size="sm" />
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSubmitReply(comment.id))}
                  placeholder="Write a reply..."
                  className="flex-1 px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button size="sm" onClick={() => handleSubmitReply(comment.id)} disabled={!replyContent.trim()}>
                  Reply
                </Button>
              </div>
            </div>
          )}

          {/* Replies */}
          {replies.map(reply => renderCommentThread(reply, depth + 1))}
        </div>
      </div>
    );
  };

  const handleLoadMore = async () => {
    if (isLoading || !hasMore) return;
    await onLoadMore();
    if (comments.length >= (totalCount || 0)) {
      setHasMore(false);
    }
  };

  return (
    <div className="w-96 flex-shrink-0 border-l border-border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Comments</h3>
          {unresolvedCount > 0 && (
            <span className="px-2 py-0.5 text-xs bg-destructive/10 text-destructive rounded-full">
              {unresolvedCount} unresolved
            </span>
          )}
        </div>
      </div>

      {/* Search & Filter */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search comments..."
            className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <div className="flex-1 flex gap-2">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filter.showResolved}
                onChange={(e) => handleFilterChange({ showResolved: e.target.checked })}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              Show resolved
            </label>
            <select
              value={filter.sortBy}
              onChange={(e) => handleFilterChange({ sortBy: e.target.value as CommentFilter['sortBy'] })}
              className="flex-1 px-2 py-1 bg-input border border-border rounded text-sm text-foreground"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="mostReplies">Most replies</option>
            </select>
          </div>
        </div>
      </div>

      {/* Comments List */}
      <ScrollArea className="flex-1 overflow-y-auto">
        {isLoading && comments.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
            <MessageSquare className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm font-medium">No comments yet</p>
            <p className="text-xs mt-1 text-center">Click elements in the preview to add comments</p>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-4">
              {topLevelComments.map(comment => renderCommentThread(comment))}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="p-4 border-t border-border">
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={handleLoadMore}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading...
                    </span>
                  ) : (
                    'Load more comments'
                  )}
                </Button>
              </div>
            )}

            {!hasMore && comments.length > 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">
                All {totalCount} comments loaded
              </div>
            )}
          </>
        )}
      </ScrollArea>
    </div>
  );
};

export default CommentSidebar;