'use client';
import { useState } from 'react';
import { LogOut, Trash2 } from 'lucide-react';
import { useWorkspaceSettings, useAction } from '@/hooks/useFetch';
import { signOut } from '@/hooks/useAuth';
import { useDemo, useTrustedUser } from './providers';
import { AccountsView } from './accounts-view';
import { AccountProfile } from './account-profile';
import type { PlanId } from '@/lib/plans';
import { Button } from './ui/button';
import { ConfirmDialog } from './confirm-dialog';
import { Skeleton } from './ui/loader';
import { ErrorState } from './states';
import { toast } from 'sonner';
export function SettingsView({ suggestedPlan }: { suggestedPlan?: PlanId }) {
  const query = useWorkspaceSettings(),
    mutation = useAction(),
    demo = useDemo(),
    user = useTrustedUser();
  const [deleting, setDeleting] = useState(false);
  async function save(refreshMinutes: number) {
    try {
      await mutation.mutateAsync({
        path: '/api/settings',
        method: 'PATCH',
        body: { refreshMinutes },
      });
      toast.success('Preferences saved');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>Manage your profile, connections, and inbox preferences.</p>
        </div>
      </div>
      <AccountProfile suggestedPlan={suggestedPlan} />
      <section className="settings-section">
        <AccountsView embedded />
      </section>
      <section className="settings-section">
        <h2>General</h2>
        <div className="settings-card">
          <div className="setting-row">
            <div>
              <strong>Signed in as</strong>
              <p>{user?.email}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                demo
                  ? toast.info('No account is signed in to this demo.')
                  : void signOut().catch((error) => toast.error(error.message))
              }
            >
              <LogOut size={15} />
              Sign out
            </Button>
          </div>
          {query.isLoading ? (
            <Skeleton />
          ) : query.isError ? (
            <ErrorState retry={() => void query.refetch()} />
          ) : (
            <div className="setting-row">
              <div>
                <label htmlFor="refresh">Inbox refresh</label>
                <p>
                  Refresh saved results while your inbox is open. Mail sync continues in the
                  background.
                </p>
              </div>
              <select
                className="input time-input"
                id="refresh"
                value={query.data?.refreshMinutes ?? 5}
                disabled={mutation.isPending}
                onChange={(event) => void save(Number(event.target.value))}
              >
                {[1, 5, 10, 15, 30, 60].map((value) => (
                  <option value={value} key={value}>
                    {value} min
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="setting-row">
            <div>
              <strong>Delete account</strong>
              <p>Remove both workspaces, connections, drafts, and saved emails.</p>
            </div>
            <Button
              variant="ghost"
              className="danger-text"
              size="sm"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={15} />
              Delete account
            </Button>
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={demo ? 'Reset demo data?' : 'Permanently delete your account?'}
        description={
          demo
            ? 'Reset both workspaces and restore the sample inbox.'
            : 'Your evailbox account and all stored data will be permanently removed. Your provider emails are unaffected.'
        }
        label={demo ? 'Reset demo' : 'Delete permanently'}
        onConfirm={async () => {
          await mutation.mutateAsync({
            path: '/api/user',
            method: 'DELETE',
            body: { confirm: 'DELETE' },
          });
          window.location.assign(demo ? '/inbox' : '/signin');
        }}
      />
    </>
  );
}
