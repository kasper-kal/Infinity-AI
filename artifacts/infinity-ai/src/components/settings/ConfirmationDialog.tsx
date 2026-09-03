/**
 * Confirmation Dialog — For AI-proposed changes requiring user confirmation
 *
 * Displays proposed changes with current vs proposed values,
 * reasoning, and confirm/reject actions with loading states.
 */

import React from "react";
import { Button, Badge } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { useI18n } from "@/lib/i18n";

export interface ConfirmationDialogProps {
  /** Dialog title */
  title: string;
  /** Description/reasoning for the proposed change */
  description: string;
  /** Current and proposed values for comparison */
  details?: {
    current?: string;
    proposed?: string;
    operation?: string;
    provider?: string;
    model?: string;
    name?: string;
  };
  /** Current status of the proposal */
  status: 'pending' | 'confirmed' | 'rejected';
  /** Callback when user confirms */
  onConfirm: () => void;
  /** Callback when user rejects */
  onReject: () => void;
  /** Confirm button text */
  confirmText?: string;
  /** Reject button text */
  rejectText?: string;
  /** Whether actions are loading */
  loading?: boolean;
  /** Visual variant */
  variant?: 'default' | 'warning' | 'danger';
  /** Whether dialog is open (controlled) */
  open?: boolean;
  /** Callback when dialog closes */
  onClose?: () => void;
}

const STATUS_LABELS = {
  pending: { label: 'Pending Review', variant: 'default' as const },
  confirmed: { label: 'Confirmed', variant: 'default' as const },
  rejected: { label: 'Rejected', variant: 'destructive' as const },
};

const STATUS_COLORS = {
  pending: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20',
  confirmed: 'text-green-500 bg-green-500/10 border-green-500/20',
  rejected: 'text-red-500 bg-red-500/10 border-red-500/20',
};

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  title,
  description,
  details,
  status,
  onConfirm,
  onReject,
  confirmText = 'Confirm',
  rejectText = 'Reject',
  loading = false,
  variant = 'default',
  open = true,
  onClose,
}) => {
  const { t } = useI18n();
  const statusInfo = STATUS_LABELS[status];
  const statusColor = STATUS_COLORS[status];

  // If not open and not controlled, don't render
  if (!open && onClose) return null;

  // For confirmed/rejected, show a simpler view
  if (status !== 'pending') {
    return (
      <div className={`p-4 rounded-lg border ${statusColor}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-medium">{title}</h4>
              <Badge variant={statusInfo.variant} className="text-xs">
                {statusInfo.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{description}</p>
            {details && (
              <div className="mt-3 space-y-2 text-sm">
                {details.operation && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-muted-foreground w-24">Operation:</span>
                    <code className="bg-bg-elevated/50 px-1.5 rounded">{details.operation}</code>
                  </div>
                )}
                {details.provider && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-muted-foreground w-24">Provider:</span>
                    <code className="bg-bg-elevated/50 px-1.5 rounded">{details.provider}</code>
                  </div>
                )}
                {details.model && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-muted-foreground w-24">Model:</span>
                    <code className="bg-bg-elevated/50 px-1.5 rounded">{details.model}</code>
                  </div>
                )}
                {details.name && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-muted-foreground w-24">Name:</span>
                    <code className="bg-bg-elevated/50 px-1.5 rounded">{details.name}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Pending - show full dialog with actions
  return (
    <Dialog
      open={open}
      onClose={onClose || (() => {})}
      title={title}
      description={description}
      size="lg"
      showCloseButton={false}
    >
      <div className="space-y-4">
        {/* Status badge */}
        <div className="flex items-center justify-between">
          <Badge variant={statusInfo.variant} className={`text-xs ${statusColor}`}>
            {statusInfo.label}
          </Badge>
          {details?.operation && (
            <Badge variant="outline" className="text-xs">
              {details.operation.toUpperCase()}
            </Badge>
          )}
        </div>

        {/* Details comparison */}
        {details && (details.current || details.proposed) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {details.current !== undefined && (
              <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-red-500">Current Value</span>
                </div>
                <pre className="text-xs text-red-500 whitespace-pre-wrap font-mono max-h-32 overflow-auto">
                  {details.current}
                </pre>
              </div>
            )}
            {details.proposed !== undefined && (
              <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-green-500">Proposed Value</span>
                </div>
                <pre className="text-xs text-green-500 whitespace-pre-wrap font-mono max-h-32 overflow-auto">
                  {details.proposed}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Additional metadata */}
        {details && (details.operation || details.provider || details.model || details.name) && (
          <div className="p-3 rounded-lg bg-bg-elevated/50 border border-border-primary/50">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {details.operation && (
                <div>
                  <span className="text-muted-foreground">Operation: </span>
                  <code className="bg-bg-elevated/50 px-1 rounded">{details.operation}</code>
                </div>
              )}
              {details.provider && (
                <div>
                  <span className="text-muted-foreground">Provider: </span>
                  <code className="bg-bg-elevated/50 px-1 rounded">{details.provider}</code>
                </div>
              )}
              {details.model && (
                <div>
                  <span className="text-muted-foreground">Model: </span>
                  <code className="bg-bg-elevated/50 px-1 rounded">{details.model}</code>
                </div>
              )}
              {details.name && (
                <div>
                  <span className="text-muted-foreground">Name: </span>
                  <code className="bg-bg-elevated/50 px-1 rounded">{details.name}</code>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="ghost"
            onClick={onReject}
            disabled={loading}
            className="text-red-500 hover:bg-red-500/10"
          >
            {rejectText}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : variant === 'warning' ? 'primary' : 'primary'}
            onClick={onConfirm}
            disabled={loading}
            loading={loading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default ConfirmationDialog;