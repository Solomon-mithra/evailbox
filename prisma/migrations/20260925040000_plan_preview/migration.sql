ALTER TABLE users ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'STARTER';
ALTER TABLE users ADD COLUMN "planSource" TEXT NOT NULL DEFAULT 'preview';
ALTER TABLE users ADD COLUMN "requestedPlan" TEXT;
ALTER TABLE users ADD COLUMN "planGrantedAt" TIMESTAMP(3);
ALTER TABLE users ADD CONSTRAINT valid_plan CHECK (plan IN ('STARTER','HEAVY'));
ALTER TABLE users ADD CONSTRAINT valid_requested_plan CHECK ("requestedPlan" IS NULL OR "requestedPlan" IN ('STARTER','HEAVY'));
CREATE TABLE monthly_usage (
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  month DATE NOT NULL,
  emails INTEGER NOT NULL DEFAULT 0 CHECK (emails >= 0),
  PRIMARY KEY ("userId", month)
);
ALTER TABLE monthly_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON monthly_usage FROM anon, authenticated;
