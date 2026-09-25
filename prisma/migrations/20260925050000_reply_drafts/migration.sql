CREATE UNIQUE INDEX "emails_id_userId_workspace_accountId_key" ON emails (id,"userId",workspace,"accountId");
CREATE TABLE reply_drafts (
  id TEXT NOT NULL PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  workspace "WorkspaceKind" NOT NULL,
  "accountId" TEXT NOT NULL,
  "emailId" TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'reply' CHECK (mode IN ('reply','reply-all')),
  body TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'editing' CHECK (status IN ('editing','preparing','sending','unknown','accepted')),
  "rfcMessageId" TEXT NOT NULL,
  "providerDraftId" TEXT,
  "providerMessageId" TEXT,
  "leaseId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("emailId","userId",workspace,"accountId") REFERENCES emails(id,"userId",workspace,"accountId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("accountId","userId",workspace) REFERENCES email_accounts(id,"userId",workspace) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "reply_drafts_rfcMessageId_key" ON reply_drafts ("rfcMessageId");
CREATE UNIQUE INDEX "reply_drafts_emailId_userId_workspace_key" ON reply_drafts ("emailId","userId",workspace);
CREATE UNIQUE INDEX "reply_drafts_emailId_userId_workspace_accountId_key" ON reply_drafts ("emailId","userId",workspace,"accountId");
CREATE INDEX "reply_drafts_userId_workspace_status_updatedAt_idx" ON reply_drafts ("userId",workspace,status,"updatedAt");
ALTER TABLE reply_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reply_drafts FROM anon, authenticated;
