ALTER TABLE emails ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE emails ADD COLUMN "firstClassifiedAt" TIMESTAMP(3);
ALTER TABLE emails ADD COLUMN "inInbox" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE email_classifications ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE email_classifications ADD COLUMN "modelVersion" TEXT NOT NULL DEFAULT '';
-- Empty legacy versions are deliberately stale and will be evaluated by recovery.
CREATE TABLE processing_state (
  id TEXT NOT NULL PRIMARY KEY,
  "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE processing_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON processing_state FROM anon, authenticated;
CREATE INDEX "emails_inbox_read_idx" ON emails ("userId", workspace, "receivedAt" DESC, id DESC) WHERE "inInbox";
