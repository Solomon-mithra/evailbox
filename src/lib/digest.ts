import 'server-only';
import { Prisma, type DigestHistory, type NotificationPref, type User } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { digestWindow, escapeHtml } from './notification-utils';

const payloadSchema = z.object({
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  html: z.string(),
  headers: z.record(z.string(), z.string()),
});
type DigestPayload = z.infer<typeof payloadSchema>;
type Preference = NotificationPref & { user: User };
class DeadlineReached extends Error {}
function checkDeadline(deadline: number) {
  if (Date.now() >= deadline) throw new DeadlineReached();
}

async function buildPayload(
  pref: Preference,
  history: DigestHistory,
  deadline: number,
): Promise<DigestPayload> {
  const previous = await db.digestHistory.findFirst({
    where: { userId: pref.userId, status: 'sent', windowEnd: { lte: history.windowEnd } },
    orderBy: { windowEnd: 'desc' },
  });
  const lower = previous?.windowEnd ?? new Date(history.windowEnd.getTime() - 86400000);
  const groups = new Map<string, { subject: string; sender: string; emailId: string }[]>();
  let cursor: string | undefined;
  // Assemble the complete immutable time window. Never send a silently truncated page.
  for (;;) {
    checkDeadline(deadline);
    const matches = await db.emailClassification.findMany({
      where: {
        userId: pref.userId,
        matched: true,
        confidence: { gte: pref.minConfidence },
        createdAt: { gte: lower, lt: history.windowEnd },
      },
      include: { email: true, tag: true },
      take: 200,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    checkDeadline(deadline);
    for (const match of matches) {
      if (match.tagVersion !== match.tag.version) continue;
      const group = groups.get(match.tag.name) ?? [];
      group.push({
        subject: match.email.subject,
        sender: match.email.senderName || match.email.sender,
        emailId: match.email.id,
      });
      groups.set(match.tag.name, group);
    }
    if (matches.length < 200) break;
    cursor = matches[matches.length - 1].id;
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const unsubscribe = `${appUrl}/unsubscribe?token=${encodeURIComponent(pref.unsubscribeToken)}`;
  const summary =
    [...groups].map(([name, items]) => `${items.length} ${name}`).join(', ') || 'No new matches';
  const html = `<html><body style="font-family:Arial,sans-serif;color:#171717;max-width:620px;margin:auto;padding:32px"><h1>Your JevInbox digest</h1><p>${escapeHtml(summary)}</p>${[...groups].map(([name, items]) => `<h2>${escapeHtml(name)}</h2><ul>${items.map((item) => `<li><a href="${escapeHtml(appUrl)}/?email=${encodeURIComponent(item.emailId)}">${escapeHtml(item.subject)}</a> — ${escapeHtml(item.sender)}</li>`).join('')}</ul>`).join('')}<p><a href="${escapeHtml(unsubscribe)}">Unsubscribe from daily digests</a></p></body></html>`;
  return {
    from: process.env.DIGEST_FROM!,
    to: [pref.user.email],
    subject: `JevInbox · ${summary.slice(0, 120)}`,
    html,
    headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
  };
}

export async function sendDigests(deadline = Date.now() + 45000) {
  const preferences = await db.notificationPref.findMany({
    where: { dailyDigest: true },
    include: { user: true },
  });
  let sent = 0,
    failed = 0,
    pending = 0;
  for (const pref of preferences) {
    if (Date.now() >= deadline) {
      pending++;
      break;
    }
    const window = digestWindow(new Date(), pref.timezone, pref.digestTime);
    // Retain retryable work beyond the 15-minute scheduling window. A new due date
    // is recorded even when an older failed delivery still needs processing.
    if (window.due) {
      const existing = await db.digestHistory.findUnique({
        where: { userId_localDate: { userId: pref.userId, localDate: window.date } },
      });
      if (!existing) {
        try {
          await db.digestHistory.create({
            data: {
              userId: pref.userId,
              localDate: window.date,
              windowEnd: new Date(),
              leaseUntil: new Date(0),
            },
          });
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
            throw error;
        }
      }
    }
    const history = await db.digestHistory.findFirst({
      where: { userId: pref.userId, status: { not: 'sent' } },
      orderBy: [{ windowEnd: 'asc' }, { id: 'asc' }],
    });
    if (!history || history.leaseUntil > new Date()) continue;
    if (Date.now() >= deadline) {
      pending++;
      break;
    }
    const leaseUntil = new Date(Date.now() + 120000);
    const owned = { id: history.id, userId: pref.userId, status: { not: 'sent' }, leaseUntil };
    const lock = await db.digestHistory.updateMany({
      where: {
        id: history.id,
        userId: pref.userId,
        status: { not: 'sent' },
        leaseUntil: { lte: new Date() },
      },
      data: { leaseUntil },
    });
    if (!lock.count) continue;
    try {
      checkDeadline(deadline);
      let payload: DigestPayload;
      if (history.payload !== null) payload = payloadSchema.parse(history.payload);
      else {
        payload = await buildPayload(pref, history, deadline);
        checkDeadline(deadline);
        const snapshot = await db.digestHistory.updateMany({ where: owned, data: { payload } });
        if (!snapshot.count) {
          pending++;
          continue;
        }
      }
      checkDeadline(deadline);
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `digest-${history.id}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))),
      });
      if (!response.ok) throw new Error('Digest delivery failed');
      const result = z.object({ id: z.string().min(1) }).parse(await response.json());
      const updated = await db.digestHistory.updateMany({
        where: owned,
        data: { status: 'sent', sentAt: new Date(), providerId: result.id },
      });
      if (updated.count) sent++;
      else pending++;
    } catch (error) {
      if (error instanceof DeadlineReached) pending++;
      else failed++;
      await db.digestHistory.updateMany({
        where: owned,
        data: {
          status: error instanceof DeadlineReached ? 'pending' : 'failed',
          leaseUntil: new Date(0),
        },
      });
    }
  }
  return { sent, failed, pending };
}
