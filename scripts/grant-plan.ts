import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
const db = new PrismaClient();
async function main() {
  const email = z.email().parse(process.argv[2]).toLowerCase();
  const plan = z.enum(['STARTER', 'HEAVY']).parse(process.argv[3]);
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;
  let target;
  for (let page = 1; page <= 10000; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('Could not look up the Supabase account.');
    target = data.users.find((user) => user.email?.toLowerCase() === email);
    if (target || data.users.length < 1000) break;
  }
  if (!target?.email_confirmed_at)
    throw new Error('A confirmed Supabase account with this email is required.');
  const grantedAt = new Date();
  // Idempotent administrative operation. Never accepts user-editable metadata as authority.
  await db.user.upsert({
    where: { id: target.id },
    create: { id: target.id, email, plan, planSource: 'manual', planGrantedAt: grantedAt },
    update: { plan, planSource: 'manual', planGrantedAt: grantedAt },
  });
  const { error } = await admin.updateUserById(target.id, {
    app_metadata: {
      ...target.app_metadata,
      evailbox: { plan, source: 'manual', grantedAt: grantedAt.toISOString() },
    },
  });
  if (error)
    throw new Error(
      'Database grant saved; Supabase metadata update failed. Rerun this command to reconcile.',
    );
  const [saved, identity] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { plan: true, planSource: true },
    }),
    admin.getUserById(target.id),
  ]);
  if (
    identity.error ||
    saved.plan !== plan ||
    identity.data.user.app_metadata.evailbox?.plan !== plan
  )
    throw new Error('Grant verification failed. Rerun to reconcile.');
  console.log(
    JSON.stringify({
      email,
      plan: saved.plan,
      source: saved.planSource,
      verified: true,
      billingEnabled: false,
      limitsEnforced: false,
    }),
  );
}
main()
  .catch((error) => {
    console.error(
      error instanceof z.ZodError
        ? 'Usage: node --env-file=.env.local --import tsx scripts/grant-plan.ts EMAIL STARTER|HEAVY'
        : error.message,
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
