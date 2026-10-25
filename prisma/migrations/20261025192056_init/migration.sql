-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "lastBackgroundSyncAt" DATETIME,
    "workRequested" BOOLEAN NOT NULL DEFAULT false,
    "workRevision" INTEGER NOT NULL DEFAULT 0,
    "workLeaseId" TEXT,
    "workLeaseUntil" DATETIME,
    "workNotBefore" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "tags" (
    "workspace" TEXT NOT NULL DEFAULT 'PERSONAL',
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "keywords" JSONB NOT NULL DEFAULT [],
    "senders" JSONB NOT NULL DEFAULT [],
    "version" INTEGER NOT NULL DEFAULT 1,
    "matchFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "historyEmailIds" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "email_accounts" (
    "workspace" TEXT NOT NULL DEFAULT 'PERSONAL',
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "cursor" TEXT,
    "rescanStartedAt" DATETIME,
    "lastSync" DATETIME,
    "syncError" TEXT,
    "syncRequested" BOOLEAN NOT NULL DEFAULT true,
    "syncRevision" INTEGER NOT NULL DEFAULT 0,
    "syncLeaseUntil" DATETIME,
    "syncLeaseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "emails" (
    "workspace" TEXT NOT NULL DEFAULT 'PERSONAL',
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "firstClassifiedAt" DATETIME,
    "inInbox" BOOLEAN NOT NULL DEFAULT true,
    "providerMessageId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "webUrl" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "emails_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "emails_accountId_userId_workspace_fkey" FOREIGN KEY ("accountId", "userId", "workspace") REFERENCES "email_accounts" ("id", "userId", "workspace") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "email_classifications" (
    "workspace" TEXT NOT NULL DEFAULT 'PERSONAL',
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "tagVersion" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "modelVersion" TEXT NOT NULL DEFAULT '',
    "matched" BOOLEAN NOT NULL,
    "confidence" REAL NOT NULL,
    "decision" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_classifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "email_classifications_emailId_userId_workspace_fkey" FOREIGN KEY ("emailId", "userId", "workspace") REFERENCES "emails" ("id", "userId", "workspace") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "email_classifications_tagId_userId_workspace_fkey" FOREIGN KEY ("tagId", "userId", "workspace") REFERENCES "tags" ("id", "userId", "workspace") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_prefs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "refreshMinutes" INTEGER NOT NULL DEFAULT 5,
    CONSTRAINT "notification_prefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "processing_state" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notBefore" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "reply_drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspace" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'reply',
    "body" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'editing',
    "rfcMessageId" TEXT NOT NULL,
    "providerDraftId" TEXT,
    "providerMessageId" TEXT,
    "leaseId" TEXT,
    "leaseUntil" DATETIME,
    "lastError" TEXT,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reply_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reply_drafts_emailId_userId_workspace_accountId_fkey" FOREIGN KEY ("emailId", "userId", "workspace", "accountId") REFERENCES "emails" ("id", "userId", "workspace", "accountId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reply_drafts_accountId_userId_workspace_fkey" FOREIGN KEY ("accountId", "userId", "workspace") REFERENCES "email_accounts" ("id", "userId", "workspace") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'app',
    "googleClientId" TEXT NOT NULL DEFAULT '',
    "googleClientSecret" TEXT,
    "microsoftClientId" TEXT NOT NULL DEFAULT '',
    "microsoftClientSecret" TEXT,
    "microsoftTenantId" TEXT NOT NULL DEFAULT 'common',
    "jevApiKey" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_workRequested_workNotBefore_lastBackgroundSyncAt_idx" ON "users"("workRequested", "workNotBefore", "lastBackgroundSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "tags_userId_workspace_nameKey_key" ON "tags"("userId", "workspace", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "tags_id_userId_key" ON "tags"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_id_userId_workspace_key" ON "tags"("id", "userId", "workspace");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_userId_workspace_provider_email_key" ON "email_accounts"("userId", "workspace", "provider", "email");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_id_userId_key" ON "email_accounts"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_id_userId_workspace_key" ON "email_accounts"("id", "userId", "workspace");

-- CreateIndex
CREATE INDEX "emails_userId_receivedAt_idx" ON "emails"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "emails_inbox_cursor_idx" ON "emails"("userId", "workspace", "receivedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "emails_account_cursor_idx" ON "emails"("userId", "workspace", "accountId", "receivedAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "emails_accountId_providerMessageId_key" ON "emails"("accountId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "emails_id_userId_key" ON "emails"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "emails_id_userId_workspace_key" ON "emails"("id", "userId", "workspace");

-- CreateIndex
CREATE UNIQUE INDEX "emails_id_userId_workspace_accountId_key" ON "emails"("id", "userId", "workspace", "accountId");

-- CreateIndex
CREATE INDEX "email_classifications_userId_matched_confidence_idx" ON "email_classifications"("userId", "matched", "confidence");

-- CreateIndex
CREATE INDEX "classifications_workspace_tag_idx" ON "email_classifications"("userId", "workspace", "tagId", "matched", "tagVersion", "emailId");

-- CreateIndex
CREATE UNIQUE INDEX "email_classifications_emailId_tagId_key" ON "email_classifications"("emailId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_prefs_userId_key" ON "notification_prefs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "reply_drafts_rfcMessageId_key" ON "reply_drafts"("rfcMessageId");

-- CreateIndex
CREATE INDEX "reply_drafts_userId_workspace_status_updatedAt_idx" ON "reply_drafts"("userId", "workspace", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "reply_drafts_emailId_userId_workspace_key" ON "reply_drafts"("emailId", "userId", "workspace");

-- CreateIndex
CREATE UNIQUE INDEX "reply_drafts_emailId_userId_workspace_accountId_key" ON "reply_drafts"("emailId", "userId", "workspace", "accountId");
