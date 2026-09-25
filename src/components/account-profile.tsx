'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDemo, usePrivateCache } from './providers';
import { useWorkspaceSelection } from './workspace-selection';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/loader';
import { ErrorState } from './states';
import { api } from '@/lib/api';
import { plans, usagePeriod, type AccountOverview, type PlanId } from '@/lib/plans';
export function AccountProfile({ suggestedPlan }: { suggestedPlan?: PlanId }) {
  const { user, ready } = usePrivateCache();
  const { workspace } = useWorkspaceSelection();
  const demo = useDemo();
  const query = useQuery({
    queryKey: ['private', user?.id, workspace, 'account'],
    enabled: !!user && ready,
    queryFn: (): Promise<AccountOverview> => {
      if (!demo) return api.get('/api/account');
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
        billingEnabled: false,
        limitsEnforced: false,
      });
    },
  });
  return (
    <section className="settings-section">
      <h2>Profile and plan</h2>
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <ProfileForm
          key={`${query.data.user.displayName}:${query.data.plan.requested}`}
          account={query.data}
          demo={demo}
          suggestedPlan={suggestedPlan}
        />
      )}
    </section>
  );
}
function ProfileForm({
  account,
  demo,
  suggestedPlan,
}: {
  account: AccountOverview;
  demo: boolean;
  suggestedPlan?: PlanId;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(account.user.displayName);
  const [choice, setChoice] = useState<PlanId>(
    suggestedPlan ?? account.plan.requested ?? account.plan.id,
  );
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      if (demo) {
        toast.info('Profile preview. No live account was changed.');
        return;
      }
      await api.patch('/api/account', { displayName: name, requestedPlan: choice });
      await client.invalidateQueries({ queryKey: ['private', account.user.id] });
      toast.success('Profile and plan preference saved. No payment collected.');
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
      </div>
      <div className="setting-row">
        <div>
          <strong>{account.plan.name} access</strong>
          <p>
            {account.plan.source === 'manual' ? 'Granted to your account.' : 'Preview access.'}{' '}
            Billing is off and allowances are not enforced.
          </p>
        </div>
        <Link href="/pricing">View pricing</Link>
      </div>
      <div className="setting-row">
        <div>
          <strong>
            {account.usage.emails.toLocaleString()} / {account.plan.monthlyEmails.toLocaleString()}{' '}
            emails
          </strong>
          <p>
            First-time classifications this calendar month (UTC). Refreshing and replying do not
            count.
          </p>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <label htmlFor="plan-choice">Plan preference</label>
          <p>
            Save your choice for launch. This does not start a subscription or change granted
            access.
          </p>
        </div>
        <select
          id="plan-choice"
          className="input"
          style={{ maxWidth: 230 }}
          value={choice}
          onChange={(event) => setChoice(event.target.value as PlanId)}
        >
          {Object.values(plans).map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name} — ${plan.price}/month
            </option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <p>
          We will ask you to opt in before charging. There is no subscription to cancel during the
          preview.
        </p>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
