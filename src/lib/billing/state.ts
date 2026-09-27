import 'server-only';
import { Prisma, type BillingAccount } from '@prisma/client';
import { db } from '../db';
import { ApiError } from '../errors';
import { billingEnabled } from './config';
import { resolveBillingAccess } from './access';

type SqlClient = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;
export type BillingSnapshot = BillingAccount & { plan: string; planSource: string; email: string };
export async function readBillingState(userId: string, client: SqlClient = db) {
  const rows = await client.$queryRaw<BillingSnapshot[]>(Prisma.sql`
    SELECT u.plan,u."planSource",u.email,b.*,
      b."trialStartedAt" AT TIME ZONE 'UTC' AS "trialStartedAt", b."trialEndsAt" AT TIME ZONE 'UTC' AS "trialEndsAt",
      b."periodStart" AT TIME ZONE 'UTC' AS "periodStart", b."periodEnd" AT TIME ZONE 'UTC' AS "periodEnd"
      FROM users u LEFT JOIN billing_accounts b ON b."userId"=u.id WHERE u.id=${userId}::uuid`);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
  return rows[0];
}
export async function processingAccess(userId: string, client: SqlClient = db, now = new Date()) {
  const state = await readBillingState(userId, client);
  const access = resolveBillingAccess(state, state, billingEnabled(), now);
  const usage =
    access.access === 'preview' || access.access === 'manual'
      ? await client.$queryRaw<{ emails: number }[]>(
          Prisma.sql`SELECT emails FROM monthly_usage WHERE "userId"=${userId}::uuid AND month=${access.start.toISOString()}::date`,
        )
      : await client.$queryRaw<{ emails: number }[]>(
          Prisma.sql`SELECT emails FROM billing_usage WHERE "userId"=${userId}::uuid AND "periodStart"=${access.start.toISOString()}::timestamp`,
        );
  const used = usage[0]?.emails ?? 0;
  const remaining = Math.max(0, access.limit - used);
  return {
    ...access,
    state,
    used,
    remaining,
    source:
      access.access === 'manual'
        ? 'manual'
        : state.subscriptionStatus
          ? 'stripe'
          : state.planSource,
    access:
      access.allowed && access.enforced && remaining === 0
        ? ('limit_reached' as const)
        : access.access,
    allowed: access.allowed && (!access.enforced || remaining > 0),
  };
}
/** Serialize billing/usage writes without blocking FK key-share locks during imports. */
export async function lockBillingUser(userId: string, tx: SqlClient) {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM users WHERE id=${userId}::uuid FOR NO KEY UPDATE`,
  );
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
}
export async function withBillingLock<T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient, state: BillingSnapshot) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      await lockBillingUser(userId, tx);
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO billing_accounts("userId") VALUES(${userId}::uuid) ON CONFLICT DO NOTHING`,
      );
      const state = await readBillingState(userId, tx);
      if (state.deletingAt)
        throw new ApiError(409, 'ACCOUNT_DELETING', 'Account deletion is in progress.');
      return operation(tx, state);
    },
    { maxWait: 5000, timeout: 30000 },
  );
}
export async function requestBillingWork(userId: string, tx: SqlClient) {
  await tx.$executeRaw(
    Prisma.sql`UPDATE users SET "workRequested"=true,"workRevision"="workRevision"+1 WHERE id=${userId}::uuid`,
  );
}
