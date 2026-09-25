CREATE TABLE "mailbox_subscriptions" (
  "accountId" TEXT NOT NULL PRIMARY KEY,
  "userId" UUID NOT NULL,
  "workspace" "WorkspaceKind" NOT NULL,
  "provider" "Provider" NOT NULL,
  "providerSubscriptionId" TEXT,
  "providerMailboxId" TEXT,
  "resource" TEXT,
  "clientState" TEXT,
  "expiresAt" TIMESTAMP(3),
  "watchHistoryId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "renewalRequested" BOOLEAN NOT NULL DEFAULT true,
  "renewalRevision" INTEGER NOT NULL DEFAULT 0,
  "renewalLeaseId" TEXT,
  "renewalLeaseUntil" TIMESTAMP(3),
  "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mailbox_subscriptions_account_fkey" FOREIGN KEY ("accountId", "userId", "workspace")
    REFERENCES "email_accounts"("id", "userId", "workspace") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "mailbox_subscriptions_providerSubscriptionId_idx" ON "mailbox_subscriptions"("providerSubscriptionId");
CREATE UNIQUE INDEX "mailbox_subscriptions_accountId_userId_workspace_key" ON "mailbox_subscriptions"("accountId", "userId", "workspace");
CREATE INDEX "mailbox_subscriptions_renewalRequested_retryAt_expiresAt_idx" ON "mailbox_subscriptions"("renewalRequested", "retryAt", "expiresAt");
-- Client-state and provider subscription records are server-only, including for their owner.
ALTER TABLE "mailbox_subscriptions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "mailbox_subscriptions" FROM anon, authenticated;
