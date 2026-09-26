/** Run against a staging app/DB with fresh, connected test inboxes; no fixture mail is created. */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Inngest } from 'inngest';
import { z } from 'zod';

class SetupError extends Error {}

async function main() {
  const path = process.argv[2];
  if (!path) throw new SetupError('Usage: npm run load:burst -- staging-user-ids.json');
  const ids = z
    .array(z.uuid())
    .length(100)
    .parse(JSON.parse(await readFile(path, 'utf8')));
  if (new Set(ids).size !== 100) throw new SetupError('Provide 100 distinct staging users');
  if (!process.env.DATABASE_URL || !process.env.INNGEST_EVENT_KEY)
    throw new SetupError('Set DATABASE_URL and INNGEST_EVENT_KEY for the same staging environment');
  const maxMs = Number(process.env.BURST_TIMEOUT_MS ?? 1_800_000);
  if (!Number.isFinite(maxMs) || maxMs <= 0) throw new SetupError('Invalid BURST_TIMEOUT_MS');
  const db = new PrismaClient();
  const inngest = new Inngest({
    id: 'evailbox-burst-load-test',
    eventKey: process.env.INNGEST_EVENT_KEY,
  });
  const run = randomUUID();
  try {
    const users = await db.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        workRequested: true,
        workLeaseUntil: true,
        accounts: { select: { id: true, cursor: true, workspace: true } },
        tags: { select: { workspace: true } },
        _count: { select: { emails: true } },
      },
    });
    if (
      users.length !== 100 ||
      users.some(
        (u) =>
          u.workRequested ||
          u.workLeaseUntil ||
          u._count.emails ||
          !u.accounts.length ||
          u.accounts.some((a) => a.cursor || !u.tags.some((t) => t.workspace === a.workspace)),
      )
    )
      throw new SetupError(
        'Use 100 idle staging users with fresh connected accounts, no imported emails, and tags in each account workspace. Pause dispatch while provisioning. No data was changed.',
      );
    const started = Date.now();
    await db.$transaction([
      db.emailAccount.updateMany({
        where: { userId: { in: ids } },
        data: { syncRequested: true, syncRevision: { increment: 1 } },
      }),
      db.user.updateMany({
        where: { id: { in: ids } },
        data: {
          workRequested: true,
          workRevision: { increment: 1 },
          workNotBefore: new Date(0),
          workFailures: 0,
        },
      }),
    ]);
    await inngest.send(
      ids.map((userId) => ({
        id: `burst:${run}:${userId}`,
        name: 'evailbox/work.requested',
        data: { userId },
      })),
    );
    const firstTags = new Map<string, number>(),
      completions = new Map<string, number>();
    let imported = 0,
      tagged = 0;
    while (Date.now() - started < maxMs) {
      const [first, current, total, taggedCount] = await Promise.all([
        db.email.groupBy({
          by: ['userId'],
          where: { userId: { in: ids }, firstClassifiedAt: { not: null } },
          _min: { firstClassifiedAt: true },
        }),
        db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, workRequested: true, accounts: { select: { syncRequested: true } } },
        }),
        db.email.count({ where: { userId: { in: ids }, inInbox: true } }),
        db.email.count({
          where: { userId: { in: ids }, inInbox: true, firstClassifiedAt: { not: null } },
        }),
      ]);
      imported = total;
      tagged = taggedCount;
      for (const row of first)
        if (row._min.firstClassifiedAt)
          firstTags.set(row.userId, Math.max(0, row._min.firstClassifiedAt.getTime() - started));
      for (const row of current)
        if (
          !row.workRequested &&
          row.accounts.every((a) => !a.syncRequested) &&
          !completions.has(row.id)
        )
          completions.set(row.id, Date.now() - started);
      process.stdout.write(
        JSON.stringify({
          elapsedMs: Date.now() - started,
          usersWithFirstTag: firstTags.size,
          completedUsers: completions.size,
          imported,
          tagged,
        }) + '\n',
      );
      if (completions.size === 100) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const percentiles = (values: number[]) => {
      const sorted = values.sort((a, b) => a - b);
      const at = (p: number) =>
        sorted.length
          ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
          : null;
      return { p50: at(0.5), p95: at(0.95), max: at(1) };
    };
    process.stdout.write(
      JSON.stringify(
        {
          run,
          source: 'staging providers + Inngest + Postgres',
          users: 100,
          imported,
          tagged,
          firstTagMs: percentiles([...firstTags.values()]),
          completionMs: percentiles([...completions.values()]),
          usersWithoutFirstTag: 100 - firstTags.size,
          incompleteUsers: 100 - completions.size,
          completionPollingResolutionMs: 1000,
        },
        null,
        2,
      ) + '\n',
    );
    if (completions.size !== 100 || firstTags.size !== 100) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
main().catch((error: unknown) => {
  // Do not print upstream errors: SDK/DB errors may include secrets.
  console.error(
    error instanceof SetupError
      ? error.message
      : 'Burst test failed. Verify staging configuration and fixture prerequisites. Worker progress remains durable.',
  );
  process.exitCode = 1;
});
