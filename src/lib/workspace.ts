import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { z } from 'zod';
export const publicAccount = {
  id: true,
  email: true,
  provider: true,
  lastSync: true,
  syncError: true,
} as const;
export const publicPrefs = {
  browserPush: true,
  dailyDigest: true,
  digestTime: true,
  timezone: true,
  minConfidence: true,
  refreshMinutes: true,
} as const;
export async function getWorkspace(user: { id: string; email: string }, params: URLSearchParams) {
  const input = z
    .object({
      search: z.string().max(200).default(''),
      tag: z.string().max(100).default(''),
      account: z.string().max(100).default(''),
      range: z.enum(['week', 'month', 'all']).default('all'),
      page: z.coerce.number().int().min(0).max(10000).default(0),
    })
    .parse(Object.fromEntries(params));
  const where: Prisma.EmailWhereInput = {
    userId: user.id,
    ...(input.account ? { accountId: input.account } : {}),
    ...(input.tag ? { classifications: { some: { tagId: input.tag, matched: true } } } : {}),
    ...(input.range === 'all'
      ? {}
      : {
          receivedAt: { gte: new Date(Date.now() - (input.range === 'week' ? 7 : 30) * 86400000) },
        }),
    ...(input.search
      ? {
          OR: [
            { subject: { contains: input.search, mode: 'insensitive' } },
            { sender: { contains: input.search, mode: 'insensitive' } },
            { senderName: { contains: input.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const needWhere: Prisma.EmailWhereInput = {
    userId: user.id,
    handled: false,
    isRead: false,
    classifications: { some: { matched: true, tag: { priority: 'HIGH' } } },
  };
  const [tags, accounts, emails, preferences, total, needs, needsTotal, groups] = await Promise.all(
    [
      db.tag.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } }),
      db.emailAccount.findMany({
        where: { userId: user.id },
        select: publicAccount,
        orderBy: { createdAt: 'asc' },
      }),
      db.email.findMany({
        where,
        include: {
          classifications: {
            include: { tag: { select: { id: true, name: true, priority: true, version: true } } },
          },
        },
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        take: 50,
        skip: input.page * 50,
      }),
      db.notificationPref.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: {},
        select: publicPrefs,
      }),
      db.email.count({ where }),
      db.emailClassification.findMany({
        where: {
          userId: user.id,
          matched: true,
          tag: { priority: 'HIGH' },
          email: { handled: false, isRead: false },
        },
        distinct: ['emailId'],
        orderBy: { confidence: 'desc' },
        take: 50,
        include: {
          email: {
            omit: { body: true },
            include: {
              classifications: {
                include: {
                  tag: { select: { id: true, name: true, priority: true, version: true } },
                },
              },
            },
          },
        },
      }),
      db.email.count({ where: needWhere }),
      db.emailClassification.groupBy({
        by: ['tagId'],
        where: { userId: user.id, matched: true },
        _count: { emailId: true },
      }),
    ],
  );
  return {
    needsYou: needs.map((c) => ({ ...c.email, body: null })),
    needsTotal,
    tagCounts: Object.fromEntries(groups.map((g) => [g.tagId, g._count.emailId])),
    user: {
      id: user.id,
      email: user.email,
      workRequested: (user as { workRequested?: boolean }).workRequested ?? false,
    },
    tags,
    accounts,
    emails: emails.map((e) => ({
      ...e,
      body: null,
      classifications: e.classifications.filter((c) => c.tagVersion === c.tag.version),
    })),
    preferences,
    total,
    page: input.page,
    pageSize: 50,
  };
}
