-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GMAIL', 'OUTLOOK');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "lastBackgroundSyncAt" TIMESTAMP(3),
    "workRequested" BOOLEAN NOT NULL DEFAULT false,
    "workRevision" INTEGER NOT NULL DEFAULT 0,
    "workLeaseId" TEXT,
    "workLeaseUntil" TIMESTAMP(3),
    "workNotBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "senders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_accounts" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "email" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cursor" TEXT,
    "rescanStartedAt" TIMESTAMP(3),
    "lastSync" TIMESTAMP(3),
    "syncError" TEXT,
    "syncRequested" BOOLEAN NOT NULL DEFAULT true,
    "syncRevision" INTEGER NOT NULL DEFAULT 0,
    "syncLeaseUntil" TIMESTAMP(3),
    "syncLeaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "accountId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerMessageId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "body" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "webUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_classifications" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "emailId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "tagVersion" INTEGER NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "decision" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_prefs" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "browserPush" BOOLEAN NOT NULL DEFAULT false,
    "dailyDigest" BOOLEAN NOT NULL DEFAULT false,
    "digestTime" TEXT NOT NULL DEFAULT '09:00',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "minConfidence" INTEGER NOT NULL DEFAULT 80,
    "refreshMinutes" INTEGER NOT NULL DEFAULT 5,
    "unsubscribeToken" TEXT NOT NULL,

    CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digest_history" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "localDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "providerId" TEXT,
    "windowEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "digest_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_workRequested_workNotBefore_lastBackgroundSyncAt_idx" ON "users"("workRequested", "workNotBefore", "lastBackgroundSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "tags_userId_nameKey_key" ON "tags"("userId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "tags_id_userId_key" ON "tags"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_userId_provider_email_key" ON "email_accounts"("userId", "provider", "email");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_id_userId_key" ON "email_accounts"("id", "userId");

-- CreateIndex
CREATE INDEX "emails_userId_receivedAt_idx" ON "emails"("userId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "emails_accountId_providerMessageId_key" ON "emails"("accountId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "emails_id_userId_key" ON "emails"("id", "userId");

-- CreateIndex
CREATE INDEX "email_classifications_userId_matched_confidence_idx" ON "email_classifications"("userId", "matched", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "email_classifications_emailId_tagId_key" ON "email_classifications"("emailId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_prefs_userId_key" ON "notification_prefs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_prefs_unsubscribeToken_key" ON "notification_prefs"("unsubscribeToken");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "digest_history_userId_localDate_key" ON "digest_history"("userId", "localDate");

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_accountId_userId_fkey" FOREIGN KEY ("accountId", "userId") REFERENCES "email_accounts"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_classifications" ADD CONSTRAINT "email_classifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_classifications" ADD CONSTRAINT "email_classifications_emailId_userId_fkey" FOREIGN KEY ("emailId", "userId") REFERENCES "emails"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_classifications" ADD CONSTRAINT "email_classifications_tagId_userId_fkey" FOREIGN KEY ("tagId", "userId") REFERENCES "tags"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digest_history" ADD CONSTRAINT "digest_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The server uses a privileged connection and MUST scope every query by userId.
-- Direct client access to credentials, preferences and delivery records is forbidden.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digest_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_select ON public.users FOR SELECT TO authenticated USING (id=auth.uid());
CREATE POLICY tags_select ON public.tags FOR SELECT TO authenticated USING ("userId"=auth.uid());
CREATE POLICY emails_select ON public.emails FOR SELECT TO authenticated USING ("userId"=auth.uid());
CREATE POLICY classifications_select ON public.email_classifications FOR SELECT TO authenticated USING ("userId"=auth.uid());
REVOKE ALL ON public.email_accounts, public.notification_prefs, public.push_subscriptions, public.digest_history FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.users, public.tags, public.emails, public.email_classifications FROM anon, authenticated;
ALTER TABLE public.email_classifications ADD CONSTRAINT confidence_range CHECK (confidence >= 0 AND confidence <= 100);
ALTER TABLE public.notification_prefs ADD CONSTRAINT notification_confidence_range CHECK ("minConfidence" >= 0 AND "minConfidence" <= 100);
ALTER TABLE public.notification_prefs ADD CONSTRAINT refresh_range CHECK ("refreshMinutes" >= 1 AND "refreshMinutes" <= 60);
GRANT SELECT ON public.users, public.tags, public.emails, public.email_classifications TO authenticated;
ALTER TABLE public.users ADD CONSTRAINT users_auth_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
