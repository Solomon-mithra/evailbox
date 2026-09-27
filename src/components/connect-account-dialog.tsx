'use client';
import type { RefObject } from 'react';
import { ArrowRight, Inbox, Tags } from 'lucide-react';
import { INITIAL_IMPORT_LIMIT } from '@/lib/providers/sync-policy';
import { workspacePath, type WorkspaceId } from '@/lib/workspace-selection';
import type { Provider } from '@/types';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { ProviderLogo } from './provider-logo';

export function ConnectAccountDialog({
  provider,
  workspace,
  workspaceName,
  onClose,
  returnFocusRef,
}: {
  provider: Provider | null;
  workspace: WorkspaceId;
  workspaceName: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  if (!provider) return null;
  const name = provider === 'GMAIL' ? 'Gmail' : 'Outlook';
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Connect ${name}`}
      description={`Here’s what happens when you add an inbox to your ${workspaceName} workspace.`}
      className="connect-dialog"
      returnFocusRef={returnFocusRef}
    >
      <ol className="connect-dialog-steps">
        <li>
          <span className="connect-dialog-step-icon" aria-hidden="true">
            <Inbox size={20} />
          </span>
          <div>
            <h3>Your latest {INITIAL_IMPORT_LIMIT} emails</h3>
            <p>{`We’ll sync up to ${INITIAL_IMPORT_LIMIT} of your most recent inbox emails to get you started.`}</p>
          </div>
        </li>
        <li>
          <span className="connect-dialog-step-icon" aria-hidden="true">
            <Tags size={20} />
          </span>
          <div>
            <h3>New mail, automatically</h3>
            <p>
              From then on, new incoming emails will be automatically processed and classified
              according to your tag rules.
            </p>
          </div>
        </li>
      </ol>
      <p className="connect-dialog-hint">
        You can create or update your rules in Tags at any time.
      </p>
      <div className="dialog-actions">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button asChild>
          <a href={workspacePath(`/api/accounts/${provider.toLowerCase()}/auth`, workspace)}>
            <ProviderLogo provider={provider} size={18} />
            Continue with {name}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        </Button>
      </div>
    </Dialog>
  );
}
