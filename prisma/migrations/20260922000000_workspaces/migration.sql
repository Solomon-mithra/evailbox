-- Existing rows remain in Personal. Apply constraints atomically.
BEGIN;
-- CreateEnum
CREATE TYPE "WorkspaceKind" AS ENUM ('PERSONAL', 'WORK');

-- DropForeignKey
ALTER TABLE "emails" DROP CONSTRAINT "emails_accountId_userId_fkey";

-- DropForeignKey
ALTER TABLE "email_classifications" DROP CONSTRAINT "email_classifications_emailId_userId_fkey";

-- DropForeignKey
ALTER TABLE "email_classifications" DROP CONSTRAINT "email_classifications_tagId_userId_fkey";

-- DropIndex
DROP INDEX "tags_userId_nameKey_key";

-- DropIndex
DROP INDEX "email_accounts_userId_provider_email_key";

-- AlterTable
ALTER TABLE "tags" ADD COLUMN     "workspace" "WorkspaceKind" NOT NULL DEFAULT 'PERSONAL';

-- AlterTable
ALTER TABLE "email_accounts" ADD COLUMN     "workspace" "WorkspaceKind" NOT NULL DEFAULT 'PERSONAL';

-- AlterTable
ALTER TABLE "emails" ADD COLUMN     "workspace" "WorkspaceKind" NOT NULL DEFAULT 'PERSONAL';

-- AlterTable
ALTER TABLE "email_classifications" ADD COLUMN     "workspace" "WorkspaceKind" NOT NULL DEFAULT 'PERSONAL';

-- CreateIndex
CREATE UNIQUE INDEX "tags_userId_workspace_nameKey_key" ON "tags"("userId", "workspace", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "tags_id_userId_workspace_key" ON "tags"("id", "userId", "workspace");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_userId_workspace_provider_email_key" ON "email_accounts"("userId", "workspace", "provider", "email");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_id_userId_workspace_key" ON "email_accounts"("id", "userId", "workspace");

-- CreateIndex
CREATE UNIQUE INDEX "emails_id_userId_workspace_key" ON "emails"("id", "userId", "workspace");

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_accountId_userId_workspace_fkey" FOREIGN KEY ("accountId", "userId", "workspace") REFERENCES "email_accounts"("id", "userId", "workspace") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_classifications" ADD CONSTRAINT "email_classifications_emailId_userId_workspace_fkey" FOREIGN KEY ("emailId", "userId", "workspace") REFERENCES "emails"("id", "userId", "workspace") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_classifications" ADD CONSTRAINT "email_classifications_tagId_userId_workspace_fkey" FOREIGN KEY ("tagId", "userId", "workspace") REFERENCES "tags"("id", "userId", "workspace") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
