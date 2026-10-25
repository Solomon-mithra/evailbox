'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDemo, usePrivateCache } from './providers';
import { useWorkspaceSelection } from './workspace-selection';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/loader';
import { ErrorState } from './states';
import { api } from '@/lib/api';
import type { AccountOverview } from '@/types';

export function AccountProfile() {
  const { user, ready } = usePrivateCache();
  const { workspace } = useWorkspaceSelection();
  const demo = useDemo();
  const query = useQuery({
    queryKey: ['private', user?.id, workspace, 'account'],
    enabled: !!user && ready,
    refetchOnMount: 'always',
    queryFn: (): Promise<AccountOverview> =>
      demo
        ? Promise.resolve({
            user: {
              id: 'demo-user',
              email: 'alex@example.com',
              displayName: 'Alex',
              createdAt: new Date().toISOString(),
            },
          })
        : api.get('/api/account'),
  });
  if (query.isPending) return <Skeleton />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  return (
    <section className="settings-section" aria-labelledby="profile-heading">
      <h2 id="profile-heading">Profile</h2>
      <ProfileForm key={query.data.user.displayName} account={query.data} demo={demo} />
    </section>
  );
}
function ProfileForm({ account, demo }: { account: AccountOverview; demo: boolean }) {
  const client = useQueryClient();
  const [name, setName] = useState(account.user.displayName);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      if (demo) {
        toast.info('Profile preview. No live account was changed.');
        return;
      }
      await api.patch('/api/account', { displayName: name });
      await client.invalidateQueries({ queryKey: ['private', account.user.id] });
      toast.success('Profile saved.');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="settings-card"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="setting-row">
        <div>
          <label htmlFor="profile-name">Display name</label>
          <p>Your sign-in email is managed through Google.</p>
        </div>
        <Input
          id="profile-name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          style={{ maxWidth: 260 }}
        />
        <Button type="submit" disabled={saving || name === account.user.displayName}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}
