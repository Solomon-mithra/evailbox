import { z } from 'zod';
export const planIds = ['STARTER', 'HEAVY'] as const;
export type PlanId = (typeof planIds)[number];
export const plans = {
  STARTER: {
    id: 'STARTER',
    name: 'Starter',
    price: 4.99,
    priceCents: 499,
    monthlyEmails: 10000,
    description: 'For your everyday inbox.',
  },
  HEAVY: {
    id: 'HEAVY',
    name: 'Heavy',
    price: 7.99,
    priceCents: 799,
    monthlyEmails: 20000,
    description: 'For a busy inbox across work and life.',
  },
} as const;
export const TRIAL_DAYS = 3;
export const TRIAL_EMAILS = 10000;
export type BillingAccess =
  | 'preview'
  | 'manual'
  | 'trial'
  | 'active'
  | 'trial_available'
  | 'expired'
  | 'payment_required'
  | 'limit_reached';
export function usagePeriod(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}
export const accountPatch = z
  .object({
    displayName: z.string().trim().max(80).optional(),
    requestedPlan: z.enum(planIds).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Choose something to update.');

export interface AccountOverview {
  user: { id: string; email: string; displayName: string; createdAt: string };
  plan: {
    id: PlanId;
    name: string;
    price: number;
    monthlyEmails: number;
    source: string;
    requested: PlanId | null;
  };
  usage: { emails: number; periodStart: string; periodEnd: string };
  billingEnabled: boolean;
  limitsEnforced: boolean;
  billing: {
    mode?: 'test' | 'live';
    configured: boolean;
    access: BillingAccess;
    status: string | null;
    trialEndsAt: string | null;
    canStartTrial: boolean;
    canManage: boolean;
    cancelAtPeriodEnd: boolean;
    processingAllowed: boolean;
  };
}
