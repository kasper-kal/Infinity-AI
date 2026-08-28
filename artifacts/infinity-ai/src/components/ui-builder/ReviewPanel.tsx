/**
 * ReviewPanel — Review workflow for UI generation
 *
 * Implements "Request Review" → visual/code diff → approve/request changes.
 * Supports side-by-side preview comparison and code diff highlighting.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { GitCompare, Check, X, Eye, Code2, ArrowLeft, ArrowRight, MessageSquare, Loader2, ShieldCheck, AlertTriangle, Clock } from 'lucide-react';
import { Button, IconButton } from '@/components/ui';
import { Input, Textarea } from '@/components/ui';
import { Avatar } from '@/components/ui';
import { Tooltip } from '@/components/ui';
import { ScrollArea } from '@/components/ui';
import { Badge } from '@/components/ui';
import { formatDistanceToNow } from 'date-fns';

export interface ReviewRequest {
  id: string;
  projectId: string;
  componentId: string;
  versionBefore: string;
  versionAfter: string;
  requestedBy: string;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'changes_requested' | 'in_review';
  reviewer?: string;
  reviewComment?: string;
  reviewedAt?: Date;
  diffStats?: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
}

export interface ReviewPanelProps {
  projectId: string;
  reviewRequests: ReviewRequest[];
  isLoading?: boolean;
  currentVersion: string;
  previousVersion?: string;
  onRequestReview: (componentId: string, note?: string) => Promise<void>;
  onApprove: (reviewId: string, comment?: string) => Promise<void>;
  onRequestChanges: (reviewId: string, comment: string) => Promise<void>;
  onLoadHistory: () => Promise<void>;
  onSelectVersion: (version: string) => void;
  currentUser?: { name: string; email: string; avatar?: string };
  beforePreview?: string;
  afterPreview?: string;
  beforeCode?: string;
  afterCode?: string;
}

type ViewMode = 'list' | 'diff' | 'create';

export const ReviewPanel: React.FC<ReviewPanelProps> = ({
  projectId,
  reviewRequests,
  isLoading = false,
  currentVersion,
  previousVersion,
  onRequestReview,
  onApprove,
  onRequestChanges,
  onLoadHistory,
  onSelectVersion,
  currentUser,
  beforePreview,
  afterPreview,
  beforeCode,
  afterCode,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedReview, setSelectedReview] = useState<ReviewRequest | null>(null);
  const [diffView, setDiffView] = useState<'visual' | 'code'>('visual');
  const [reviewNote, setReviewNote] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (reviewRequests.length > 0 && viewMode === 'list') {
      onLoadHistory();
    }
  }, [reviewRequests.length, viewMode, onLoadHistory]);

  const handleRequestReview = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onRequestReview(currentVersion, requestNote || undefined);
      setRequestNote('');
      setViewMode('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request review');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (reviewId: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onApprove(reviewId, reviewNote || undefined);
      setReviewNote('');
      setSelectedReview(null);
      setViewMode('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestChanges = async (reviewId: string) => {
    if (!reviewNote.trim()) {
      setError('Please provide a comment explaining the requested changes');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onRequestChanges(reviewId, reviewNote);
      setReviewNote('');
      setSelectedReview(null);
      setViewMode('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request changes');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusIcon = (status: ReviewRequest['status']) => {
    switch (status) {
      case 'approved': return <ShieldCheck className="w-4 h-4 text-green-500" />;
      case 'changes_requested': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'in_review': return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: ReviewRequest['status']) => {
    switch (status) {
      case 'approved': return 'Approved';
      case 'changes_requested': return 'Changes requested';
      case 'in_review': return 'In review';
      default: return 'Pending';
    }
  };

  const renderDiffPreview = () => {
    if (diffView === 'visual') {
      return (
        <div className="grid grid-cols-2 gap-4 h-full">
          <div className="flex flex-col">
            <div className="p-2 bg-muted rounded-t-lg border border-border text-xs font-medium flex items-center gap-2">
              <ArrowLeft className="w-3 h-3" /> Before
              {selectedReview?.versionBefore && (
                <span className="ml-auto font-mono text-muted-foreground">{selectedReview.versionBefore.slice(0, 8)}</span>
              )}
            </div>
            <div className="flex-1 border border-t-0 border-border rounded-b-lg overflow-hidden">
              {beforePreview ? (
                <iframe srcDoc={beforePreview} className="w-full h-full" title="Before Preview" />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No preview available</div>
              )}
            </div>
          </div>
          <div className="flex flex-col">
            <div className="p-2 bg-muted rounded-t-lg border border-border text-xs font-medium flex items-center gap-2">
              After <ArrowRight className="w-3 h-3" />
              {selectedReview?.versionAfter && (
                <span className="ml-auto font-mono text-muted-foreground">{selectedReview.versionAfter.slice(0, 8)}</span>
              )}
            </div>
            <div className="flex-1 border border-t-0 border-border rounded-b-lg overflow-hidden">
              {afterPreview ? (
                <iframe srcDoc={afterPreview} className="w-full h-full" title="After Preview" />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No preview available</div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Code diff view
    return (
      <div className="h-full overflow-auto bg-muted/30 rounded-lg">
        <CodeDiff before={beforeCode || ''} after={afterCode || ''} />
      </div>
    );
  };

  const renderReviewCard = (review: ReviewRequest) => (
    <div
      key={review.id}
      className="p-4 border border-border rounded-lg hover:border-primary/50 transition cursor-pointer"
      onClick={() => {
        setSelectedReview(review);
        setViewMode('diff');
        onSelectVersion(review.versionAfter);
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-1">{getStatusIcon(review.status)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">
              {review.status === 'pending' ? 'Review requested' : getStatusText(review.status)}
            </span>
            {review.diffStats && (
              <span className="text-xs text-muted-foreground">
                {review.diffStats.filesChanged} files · +{review.diffStats.additions} -{review.diffStats.deletions}
              </span>
            )}
            {review.reviewComment && (
              <Tooltip content={review.reviewComment}>
                <span className="text-xs text-muted-foreground cursor-help">💬</span>
              </Tooltip>
            )}
          </div>
          {review.reviewComment && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{review.reviewComment}</p>
          )}
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Avatar src={undefined} fallback={review.requestedBy?.[0]?.toUpperCase() || 'U'} size="xs" />
            <span>{review.requestedBy}</span>
            <span>·</span>
            <span>{formatDistanceToNow(new Date(review.requestedAt), { addSuffix: true })}</span>
            {review.reviewer && (
              <>
                <span>·</span>
                <span>reviewed by {review.reviewer}</span>
              </>
            )}
          </div>
        </div>
        {review.status === 'pending' && (
          <Badge variant="outline" className="text-xs">Action needed</Badge>
        )}
      </div>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col bg-card">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompare className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Review Workflow</h3>
        </div>
        {viewMode === 'list' ? (
          <Button size="sm" onClick={() => setViewMode('create')}>
            <GitCompare className="w-4 h-4 mr-1.5" />
            Request Review
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => {
            setViewMode('list');
            setSelectedReview(null);
          }}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back
          </Button>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Content */}
      {viewMode === 'list' && (
        <ScrollArea className="flex-1 p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : reviewRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
              <GitCompare className="w-12 h-12 mb-3 opacity-50" />
              <p className="text-sm font-medium">No reviews yet</p>
              <p className="text-xs mt-1 text-center">Request a review to get feedback on your changes</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviewRequests.map(renderReviewCard)}
            </div>
          )}
        </ScrollArea>
      )}

      {viewMode === 'create' && (
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          <div className="p-4 bg-muted/40 rounded-lg border border-border space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Eye className="w-4 h-4" />
              Current version: <code className="font-mono text-xs bg-background px-1.5 py-0.5 rounded">{currentVersion.slice(0, 8)}</code>
            </div>
            {previousVersion && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ArrowLeft className="w-3 h-3" />
                Previous: <code className="font-mono">{previousVersion.slice(0, 8)}</code>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Review note (optional)</label>
            <Textarea
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              placeholder="Describe what changed and what reviewers should focus on..."
              rows={4}
              className="w-full px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleRequestReview}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <GitCompare className="w-4 h-4 mr-2" />
            )}
            Request Review
          </Button>
        </div>
      )}

      {viewMode === 'diff' && selectedReview && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Diff Header */}
          <div className="p-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Review by {selectedReview.requestedBy}</span>
              {getStatusIcon(selectedReview.status)}
            </div>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <button
                onClick={() => setDiffView('visual')}
                className={`px-3 py-1 rounded text-xs font-medium transition ${
                  diffView === 'visual' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <Eye className="w-3 h-3 inline mr-1" />
                Visual
              </button>
              <button
                onClick={() => setDiffView('code')}
                className={`px-3 py-1 rounded text-xs font-medium transition ${
                  diffView === 'code' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <Code2 className="w-3 h-3 inline mr-1" />
                Code
              </button>
            </div>
          </div>

          {/* Diff Content */}
          <div className="flex-1 p-4 min-h-0">
            {renderDiffPreview()}
          </div>

          {/* Review Actions */}
          {selectedReview.status === 'pending' && (
            <div className="p-4 border-t border-border space-y-3">
              <Textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Add a review comment..."
                rows={2}
                className="w-full px-3 py-2 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  variant="default"
                  onClick={() => handleApprove(selectedReview.id)}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  Approve
                </Button>
                <Button
                  className="flex-1"
                  variant="destructive"
                  onClick={() => handleRequestChanges(selectedReview.id)}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <X className="w-4 h-4 mr-2" />}
                  Request Changes
                </Button>
              </div>
            </div>
          )}

          {selectedReview.status !== 'pending' && selectedReview.reviewComment && (
            <div className="p-4 border-t border-border text-sm bg-muted/30">
              <span className="text-muted-foreground">Review: </span>
              {selectedReview.reviewComment}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Simple line-based diff component
const CodeDiff: React.FC<{ before: string; after: string }> = ({ before, after }) => {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  // Simple LCS-based diff (good enough for display)
  const diff: Array<{ type: 'same' | 'add' | 'del'; line: string }> = [];
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen; i++) {
    const beforeLine = beforeLines[i];
    const afterLine = afterLines[i];

    if (beforeLine === undefined) {
      diff.push({ type: 'add', line: afterLine || '' });
    } else if (afterLine === undefined) {
      diff.push({ type: 'del', line: beforeLine });
    } else if (beforeLine === afterLine) {
      diff.push({ type: 'same', line: beforeLine });
    } else {
      diff.push({ type: 'del', line: beforeLine });
      diff.push({ type: 'add', line: afterLine });
    }
  }

  return (
    <div className="font-mono text-xs">
      {diff.map((change, i) => (
        <div
          key={i}
          className={`px-3 py-0.5 flex ${
            change.type === 'add' ? 'bg-green-500/10 text-green-700 dark:text-green-400' :
            change.type === 'del' ? 'bg-red-500/10 text-red-700 dark:text-red-400' :
            'text-muted-foreground'
          }`}
        >
          <span className="select-none w-6 flex-shrink-0 opacity-50">
            {change.type === 'add' ? '+' : change.type === 'del' ? '-' : ' '}
          </span>
          <span className="whitespace-pre-wrap break-all">{change.line}</span>
        </div>
      ))}
    </div>
  );
};

export default ReviewPanel;