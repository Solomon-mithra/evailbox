'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, CreditCard, ExternalLink, Info, LockKeyhole, Sparkles, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { api } from '@/lib/api';
import { plans, TRIAL_EMAILS, type AccountOverview, type PlanId } from '@/lib/plans';

export function BillingPanel({
  account,
  demo,
  suggestedPlan,
  billingReturn,
  verified,
  refreshing,
  refresh,
}: {
  account: AccountOverview;
  demo: boolean;
  suggestedPlan?: PlanId;
  billingReturn: string | null;
  verified: boolean;
  refreshing: boolean;
  refresh: () => void;
}) {
  const client = useQueryClient();
  const [choice, setChoice] = useState<PlanId>(
    suggestedPlan ?? account.plan.requested ?? account.plan.id,
  );
  const [pending, setPending] = useState<'trial' | 'checkout' | 'portal' | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [usageDetails, setUsageDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedReturn, setDismissedReturn] = useState<string | null>(null);
  const [demoTrial, setDemoTrial] = useState<string | null>(null);
  const checkoutTrigger = useRef<HTMLButtonElement | null>(null);
  const usageTrigger = useRef<HTMLButtonElement | null>(null);
  const notifiedReturn = useRef<string | null>(null);
  const billing = demoTrial
    ? { ...account.billing, access: 'trial' as const, canStartTrial: false, trialEndsAt: demoTrial }
    : account.billing;
  const paidActionsEnabled = !demo && account.billingEnabled && billing.configured;
  const canSubscribe =
    !billing.status || ['canceled', 'incomplete_expired'].includes(billing.status);
  const trialUsage = !!billing.trialEndsAt && !billing.status;
  const selectedPlan = plans[choice];
  const status = billingStatus({ ...account, billing });
  const isSandbox = billing.mode === 'test';
  // Successful returns need a short acknowledgement, not a permanent duplicate summary.
  useEffect(() => {
    if (demo || !verified || notifiedReturn.current === billingReturn) return;
    if (billingReturn === 'success' && billing.access === 'active') {
      toast.success(`Your ${account.plan.name} subscription is active.`);
    } else if (billingReturn === 'portal') {
      toast.success(
        billing.cancelAtPeriodEnd ? 'Cancellation scheduled.' : 'Billing details updated.',
      );
    } else return;
    notifiedReturn.current = billingReturn;
  }, [demo, verified, billingReturn, billing.access, billing.cancelAtPeriodEnd, account.plan.name]);

  async function billingAction(action: 'trial' | 'checkout' | 'portal') {
    if (pending) return;
    if (demo) {
      if (action === 'trial')
        setDemoTrial(new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString());
      toast.info('Demo only. No live trial or subscription was started.');
      return;
    }
    if (
      action === 'trial' ? !account.billingEnabled || !billing.canStartTrial : !paidActionsEnabled
    )
      return;
    setPending(action);
    setError(null);
    try {
      if (action === 'trial') {
        const updated = await api.post<AccountOverview>('/api/billing/trial');
        client.setQueriesData<AccountOverview>(
          {
            queryKey: ['private', account.user.id],
            predicate: (query) => query.queryKey[3] === 'account',
          },
          updated,
        );
        await client.invalidateQueries({ queryKey: ['private', account.user.id] });
        toast.success('Your 3-day free trial has started. No payment collected.');
        setPending(null);
      } else {
        const result = await api.post<{ url: string }>(
          `/api/billing/${action}`,
          action === 'checkout' ? { planId: choice } : {},
        );
        window.location.assign(result.url);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not open billing. Please try again.',
      );
      setPending(null);
    }
  }

  const showReturnNotice =
    billingReturn === 'canceled' ||
    (billingReturn === 'success' && (!verified || billing.access !== 'active'));
  const returnMessage =
    billingReturn === 'canceled'
      ? 'Checkout was closed. Your existing access has not changed.'
      : 'Waiting for payment confirmation…';
  return (
    <section className="settings-section" aria-labelledby="subscription-heading">
      <div className="billing-section-heading">
        <h2 id="subscription-heading">Subscription</h2>
        <Link href="/pricing" className="billing-text-link">
          Compare plans <ExternalLink size={13} />
        </Link>
      </div>
      {!demo && showReturnNotice && dismissedReturn !== billingReturn && (
        <div className="billing-notice" role="status">
          <CreditCard size={17} />
          <div>
            <p>{returnMessage}</p>
            {billingReturn === 'success' && billing.access !== 'active' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={refreshing}
                onClick={refresh}
              >
                {refreshing ? 'Checking…' : 'Check again'}
              </Button>
            )}
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss billing message"
            onClick={() => setDismissedReturn(billingReturn)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="settings-card billing-card">
        <div className="billing-overview">
          <div className="billing-summary">
            <div className="billing-plan-heading">
              <h3>{billing.access === 'active' ? account.plan.name : status.title}</h3>
              {billing.access === 'active' && (
                <span className={`billing-state ${billing.cancelAtPeriodEnd ? 'is-ending' : ''}`}>
                  {billing.cancelAtPeriodEnd ? 'Ending' : 'Active'}
                </span>
              )}
              {isSandbox && (
                <span className="billing-badge" title="Sandbox payments. No real money is charged.">
                  Sandbox
                </span>
              )}
              {demo && (
                <span className="billing-badge" title="Demo only. No payment will be collected.">
                  Demo
                </span>
              )}
            </div>
            <p>{status.description}</p>
          </div>
          {billing.canManage && (
            <Button
              type="button"
              variant="outline"
              disabled={!paidActionsEnabled || !!pending}
              onClick={() => void billingAction('portal')}
            >
              {pending === 'portal' ? 'Opening billing…' : 'Manage billing'}{' '}
              <ExternalLink size={15} />
            </Button>
          )}
        </div>
        <div className="billing-usage">
          <div className="billing-usage-heading">
            <strong>Email usage</strong>
            <span>
              {account.usage.emails.toLocaleString('en-US')} /{' '}
              {account.plan.monthlyEmails.toLocaleString('en-US')} emails
            </span>
          </div>
          <progress
            aria-label="Email allowance used"
            max={account.plan.monthlyEmails}
            value={Math.min(account.usage.emails, account.plan.monthlyEmails)}
          />
          <button
            type="button"
            className="billing-details-link"
            onClick={(event) => {
              usageTrigger.current = event.currentTarget;
              setUsageDetails(true);
            }}
          >
            <Info size={13} /> Usage details
          </button>
        </div>
        {account.billingEnabled && billing.canStartTrial && (
          <div className="billing-trial">
            <div className="billing-trial-title">
              <Sparkles size={19} />
              <div>
                <strong>3 days free · {TRIAL_EMAILS.toLocaleString('en-US')} emails</strong>
                <p>No credit card required. No automatic charge.</p>
              </div>
            </div>
            <Button type="button" disabled={!!pending} onClick={() => void billingAction('trial')}>
              {pending === 'trial' ? 'Starting trial…' : 'Start 3-day free trial'}
            </Button>
          </div>
        )}
        {canSubscribe && (
          <div className="billing-plans">
            <fieldset disabled={!!pending}>
              <legend>Choose your monthly plan</legend>
              <div className="billing-plan-grid">
                {Object.values(plans).map((plan) => (
                  <label
                    key={plan.id}
                    className={`billing-plan-option ${choice === plan.id ? 'is-selected' : ''}`}
                  >
                    <span className="billing-plan-name">
                      <span>{plan.name}</span>
                      <input
                        type="radio"
                        name="billing-plan"
                        value={plan.id}
                        checked={choice === plan.id}
                        onChange={() => setChoice(plan.id)}
                      />
                    </span>
                    <span className="billing-plan-price">
                      ${plan.price.toFixed(2)}
                      <small> USD / month</small>
                    </span>
                    <span className="billing-plan-allowance">
                      <Check size={15} /> {plan.monthlyEmails.toLocaleString('en-US')} emails per
                      month
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="billing-checkout-row">
              <p>Billed monthly. Cancel anytime.</p>
              <Button
                type="button"
                disabled={!paidActionsEnabled || !!pending}
                onClick={(event) => {
                  checkoutTrigger.current = event.currentTarget;
                  setError(null);
                  setReviewing(true);
                }}
              >
                Subscribe to {selectedPlan.name}
              </Button>
            </div>
            {!paidActionsEnabled && !demo && (
              <p className="billing-help">Paid checkout is not available yet.</p>
            )}
          </div>
        )}
        {billing.canManage && !billing.configured && !demo && (
          <p className="billing-unavailable">Billing management is temporarily unavailable.</p>
        )}
        {error && !reviewing && (
          <p className="billing-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <Dialog
        open={usageDetails}
        onOpenChange={setUsageDetails}
        title="Email usage"
        description={
          trialUsage
            ? 'Your trial allowance.'
            : 'Your allowance is shared across all connected accounts.'
        }
        returnFocusRef={usageTrigger}
      >
        <div className="billing-usage-details">
          <p>
            {account.usage.emails.toLocaleString('en-US')} of{' '}
            {account.plan.monthlyEmails.toLocaleString('en-US')} emails used
          </p>
          <p>
            {formatDate(account.usage.periodStart)} –{' '}
            {formatDate(demoTrial ?? account.usage.periodEnd)}
          </p>
          <p>
            Each email counts once when AI first processes it, including the initial import.
            Reading, replying, refreshing and rechecking tags do not count again.
          </p>
          {!account.limitsEnforced && (
            <p>Allowances are not enforced in this {demo ? 'demo' : 'setup preview'}.</p>
          )}
        </div>
      </Dialog>
      <Dialog
        open={reviewing}
        onOpenChange={(open) => {
          if (!pending) setReviewing(open);
        }}
        title={`Subscribe to ${selectedPlan.name}`}
        description="Review your subscription before continuing to secure checkout."
        returnFocusRef={checkoutTrigger}
      >
        <CheckoutSummary planId={choice} sandbox={isSandbox} />
        {error && (
          <p className="billing-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="outline"
            disabled={!!pending}
            onClick={() => setReviewing(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!!pending} onClick={() => void billingAction('checkout')}>
            {pending === 'checkout' ? 'Opening checkout…' : 'Continue to secure checkout'}{' '}
            {!pending && <ExternalLink size={15} />}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

export function CheckoutSummary({ planId, sandbox }: { planId: PlanId; sandbox: boolean }) {
  const plan = plans[planId];
  return (
    <div className="billing-checkout-summary">
      <div>
        <strong>{plan.name}</strong>
        <span>${plan.price.toFixed(2)} USD / month</span>
      </div>
      <p>
        {plan.monthlyEmails.toLocaleString('en-US')} emails per billing month across all your
        connected accounts.
      </p>
      <ul>
        <li>Your first payment is collected when you confirm in Stripe.</li>
        <li>A paid subscription ends any remaining free trial.</li>
        <li>
          Renews monthly until canceled. Cancel anytime in Manage billing; access continues through
          the paid period.
        </li>
      </ul>
      {sandbox && (
        <p className="billing-environment">
          Sandbox checkout. Use a Stripe test card. No real money is charged.
        </p>
      )}
      <p>
        <LockKeyhole size={14} /> Your payment details are handled securely by Stripe.
      </p>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
function billingStatus({ billing, plan, usage }: AccountOverview) {
  switch (billing.access) {
    case 'preview':
      return {
        title: 'Billing setup pending',
        description: 'This deployment has preview access. Paid billing is not enabled.',
      };
    case 'manual':
      return {
        title: `${plan.name} access granted`,
        description: 'Access was granted to your account. This is not a paid subscription.',
      };
    case 'trial_available':
      return {
        title: 'Your free trial is ready',
        description:
          'Start your trial to enable AI organization. Reading and replying remain available.',
      };
    case 'trial':
      return {
        title: 'Free trial active',
        description: `Ends ${billing.trialEndsAt ? formatDate(billing.trialEndsAt) : 'after 72 hours'}. No automatic charge when it ends.`,
      };
    case 'active':
      return {
        title: `${plan.name} subscription active`,
        description: `$${plan.price.toFixed(2)} USD/month. ${billing.cancelAtPeriodEnd ? 'Access ends' : 'Renews'} ${formatDate(usage.periodEnd)}.`,
      };
    case 'limit_reached':
      return {
        title: 'Email allowance reached',
        description:
          'AI processing is paused. No overage charges. Reading and replying remain available.',
      };
    case 'payment_required':
      if (billing.status === 'canceled' || billing.status === 'incomplete_expired')
        return {
          title:
            billing.status === 'canceled' ? 'Subscription ended' : 'Subscription not completed',
          description: `${billing.status === 'canceled' ? 'Your subscription has ended.' : 'Your subscription payment was not completed.'} Choose a plan to continue AI organization. Reading and replying remain available.`,
        };
      return {
        title: 'Payment needs attention',
        description:
          'AI processing is paused. Manage billing to review your payment or subscription. Reading and replying remain available.',
      };
    case 'expired':
      return {
        title: 'AI processing paused',
        description: `${billing.status ? 'Your subscription has ended.' : 'Your free trial has ended without a charge.'} Subscribe to continue AI organization. Reading and replying remain available.`,
      };
  }
}
