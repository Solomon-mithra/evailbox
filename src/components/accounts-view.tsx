'use client';
import { useState } from 'react';
import { Mail, RefreshCw, Plus, ShieldCheck, Unplug, Check } from 'lucide-react';
import { useWorkspace, useAction } from '@/hooks/useFetch';
import { useDemo } from './providers';
import { useWorkspaceSelection } from './workspace-selection';
import { workspacePath } from '@/lib/workspace-selection';
import { Button } from './ui/button';
import { Skeleton } from './ui/loader';
import { ConfirmDialog } from './confirm-dialog';
import { EmptyState, ErrorState } from './states';
import type { EmailAccount } from '@/types';
import { relativeTime } from '@/lib/utils';
import { toast } from 'sonner';
export function AccountsView({ embedded = false }: { embedded?: boolean }) {
  const { workspace, name } = useWorkspaceSelection();
  const query = useWorkspace(),
    mutation = useAction(),
    demo = useDemo();
  const [disconnect, setDisconnect] = useState<EmailAccount | null>(null);
  function connect(provider: string) {
    if (demo) {
      toast.info('Connecting real inboxes is unavailable in demo mode.');
      return;
    }
    window.location.assign(
      new URL(workspacePath(`/api/accounts/${provider}/auth`, workspace), window.location.origin)
        .href,
    );
  }
  return (
    <>
      {!embedded && (
        <div className="page-heading">
          <div>
            <h1>Accounts</h1>
            <p>Manage the inboxes connected to {name}.</p>
          </div>
        </div>
      )}
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="section-heading">
            <h2>
              Connected accounts<span className="count">{query.data?.accounts.length ?? 0}</span>
            </h2>
          </div>
          <div className="account-list">
            {query.data?.accounts.map((a) => (
              <article className="account-card" key={a.id}>
                <span className={`provider-mark provider-${a.provider.toLowerCase()}`}>
                  {a.provider === 'GMAIL' ? (
                    <Mail size={26} />
                  ) : (
                    <span className="outlook-letter">O</span>
                  )}
                </span>
                <div className="account-main">
                  <h3>{a.email}</h3>
                  <p>
                    {a.provider === 'GMAIL' ? 'Gmail' : 'Microsoft Outlook'}
                    <span>·</span>
                    {a.lastSync ? `Synced ${relativeTime(a.lastSync)} ago` : 'Ready for first sync'}
                  </p>
                  {a.syncError && <p className="field-error">{a.syncError}</p>}
                </div>
                <span className="account-status">
                  <Check size={13} />
                  {demo ? 'Sample account' : 'Connected'}
                </span>
                <div className="account-actions">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={async () => {
                      try {
                        const r = await mutation.mutateAsync({
                          path: '/api/sync',
                          body: { accountId: a.id },
                        });
                        toast[r.errors ? 'warning' : 'success'](
                          demo
                            ? 'Sample account refreshed'
                            : r.errors
                              ? 'Some operations failed. Retry sync.'
                              : `Synced ${r.synced} emails`,
                        );
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    <RefreshCw size={14} className={mutation.isPending ? 'spin' : ''} />
                    <span>Sync</span>
                  </Button>
                  <button
                    className="icon-button"
                    aria-label={`Disconnect ${a.email}`}
                    onClick={() => setDisconnect(a)}
                  >
                    <Unplug size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!query.data?.accounts.length && (
            <EmptyState
              title="No accounts connected"
              message="Add Gmail or Outlook to start organizing your emails."
            />
          )}
          <div className="connect-options">
            <button onClick={() => connect('gmail')} className="connect-card">
              <span className="provider-mark provider-gmail">
                <Mail size={23} />
              </span>
              <div>
                <strong>Connect Gmail</strong>
                <p>Personal or Google Workspace</p>
              </div>
              <Plus size={19} />
            </button>
            <button onClick={() => connect('outlook')} className="connect-card">
              <span className="provider-mark provider-outlook">
                <span className="outlook-letter">O</span>
              </span>
              <div>
                <strong>Connect Outlook</strong>
                <p>Microsoft 365 or Outlook.com</p>
              </div>
              <Plus size={19} />
            </button>
          </div>
        </>
      )}
      {!embedded && (
        <div className="info-note">
          <ShieldCheck size={22} />
          <div>
            <strong>Your email stays yours.</strong>
            <p>
              Connections use read-only access. evailbox never sends, archives, or deletes email in
              your provider inbox. You can disconnect at any time.
            </p>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!disconnect}
        onOpenChange={(v) => !v && setDisconnect(null)}
        title="Disconnect this account?"
        label="Disconnect"
        description="The account and its synced emails will be removed from evailbox. The emails in Gmail or Outlook are unaffected."
        onConfirm={async () => {
          await mutation.mutateAsync({ path: `/api/accounts/${disconnect!.id}`, method: 'DELETE' });
          toast.success('Account disconnected');
        }}
      />
    </>
  );
}
