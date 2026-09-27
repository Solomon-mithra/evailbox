CREATE TABLE billing_accounts (
  "userId" UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "trialStartedAt" TIMESTAMP(3), "trialEndsAt" TIMESTAMP(3),
  "stripeCustomerId" TEXT UNIQUE, "stripeSubscriptionId" TEXT UNIQUE,
  "stripePriceId" TEXT, "subscriptionPlan" TEXT CHECK ("subscriptionPlan" IN ('STARTER','HEAVY')),
  "subscriptionStatus" TEXT, "invoicePaid" BOOLEAN NOT NULL DEFAULT false,
  "periodStart" TIMESTAMP(3), "periodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "checkoutSessionId" TEXT, "checkoutPlan" TEXT CHECK ("checkoutPlan" IN ('STARTER','HEAVY')),
  "checkoutGeneration" INTEGER NOT NULL DEFAULT 0,
  "deletingAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT billing_trial_window CHECK (("trialStartedAt" IS NULL AND "trialEndsAt" IS NULL) OR ("trialStartedAt" IS NOT NULL AND "trialEndsAt" > "trialStartedAt"))
);
CREATE TABLE billing_usage (
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "periodStart" TIMESTAMP(3) NOT NULL,
  emails INTEGER NOT NULL DEFAULT 0 CHECK (emails >= 0),
  PRIMARY KEY ("userId", "periodStart")
);
CREATE TABLE stripe_webhook_receipts (id TEXT PRIMARY KEY, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_accounts, billing_usage, stripe_webhook_receipts FROM anon, authenticated;
