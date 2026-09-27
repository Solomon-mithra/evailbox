'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDemo, usePrivateCache } from './providers';
import { useWorkspaceSelection } from './workspace-selection';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/loader';
import { ErrorState } from './states';
import { BillingPanel } from './billing-panel';
import { api } from '@/lib/api';
import { plans, usagePeriod, type AccountOverview, type PlanId } from '@/lib/plans';

export function AccountProfile({ suggestedPlan }: { suggestedPlan?: PlanId }) {
  const { user, ready } = usePrivateCache();
  const { workspace } = useWorkspaceSelection();
  const demo = useDemo();
  const billingReturn = useSearchParams().get('billing');
  const [pollStarted] = useState(() => Date.now());
  const reconcile = billingReturn === 'success' || billingReturn === 'portal';
  const query = useQuery({
    queryKey: ['private', user?.id, workspace, 'account', billingReturn],
    enabled: !!user && ready,
    refetchOnMount: 'always',
    refetchInterval: (current) =>
      billingReturn === 'success' &&
      !demo &&
      current.state.data?.billing.access !== 'active' &&
      Date.now() - pollStarted < 60_000
        ? 2000
        : false,
    queryFn: (): Promise<AccountOverview> => {
      if (!demo) return reconcile ? api.post('/api/billing/refresh') : api.get('/api/account');
      const period = usagePeriod();
      return Promise.resolve({
        user: {
          id: 'demo-user',
          email: 'alex@example.com',
          displayName: 'Alex',
          createdAt: period.start.toISOString(),
        },
        plan: { ...plans.STARTER, source: 'preview', requested: null },
        usage: {
          emails: 12,
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString(),
        },
        billingEnabled: true,
        limitsEnforced: false,
        billing: {
          configured: false,
          access: 'trial_available',
          status: null,
          trialEndsAt: null,
          canStartTrial: true,
          canManage: false,
          cancelAtPeriodEnd: false,
          processingAllowed: true,
        },
      });
    },
  });
  if (query.isPending) return <Skeleton />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  return (
    <>
      <BillingPanel
        account={query.data}
        demo={demo}
        suggestedPlan={suggestedPlan}
        billingReturn={billingReturn}
        verified={query.isFetchedAfterMount && !query.isFetching}
        refreshing={query.isFetching}
        refresh={() => void query.refetch()}
      />
      <section className="settings-section" aria-labelledby="profile-heading">
        <h2 id="profile-heading">Profile</h2>
        <ProfileForm key={query.data.user.displayName} account={query.data} demo={demo} />
      </section>
    </>
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
