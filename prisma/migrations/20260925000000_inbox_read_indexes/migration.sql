-- Ordered keyset reads stay within a tenant and workspace, with or without an account filter.
CREATE INDEX "emails_inbox_cursor_idx" ON "emails" ("userId", "workspace", "receivedAt" DESC, "id" DESC);
CREATE INDEX "emails_account_cursor_idx" ON "emails" ("userId", "workspace", "accountId", "receivedAt" DESC, "id" DESC);
CREATE INDEX "classifications_workspace_tag_idx" ON "email_classifications" ("userId", "workspace", "tagId", "matched", "tagVersion", "emailId");
