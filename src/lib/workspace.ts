import 'server-only';
import { db } from './db';
import { z } from 'zod';
import { workspaceIds } from './workspace-selection';
import { getInbox, getInboxCounts } from './inbox';
export const publicAccount = {
  id: true,
  email: true,
  provider: true,
  lastSync: true,
  syncError: true,
} as const;
export const publicPrefs = {
  refreshMinutes: true,
} as const;
/** Legacy endpoint adapter; uses the same body-free, current-version reads as the inbox. */
export async function getWorkspace(user: { id: string; email: string }, params: URLSearchParams) {
  const needsParams = new URLSearchParams({
    workspace: params.get('workspace') ?? 'PERSONAL',
    needs: '1',
  });
  const [inbox, needs, counts, metadata, preferences] = await Promise.all([
    getInbox(user, params),
    getInbox(user, needsParams),
    getInboxCounts(user, params),
    getWorkspaceMetadata(user, params),
    getWorkspaceSettings(user),
  ]);
  return { ...metadata, ...inbox, ...counts, preferences, needsYou: needs.emails, page: 0 };
}

export const defaultPreferences = {
  refreshMinutes: 5,
};
export async function getWorkspaceSettings(user: { id: string }) {
  return (
    (await db.notificationPref.findUnique({ where: { userId: user.id }, select: publicPrefs })) ??
    defaultPreferences
  );
}
export async function getWorkspaceMetadata(
  user: { id: string; email: string; workRequested?: boolean },
  params: URLSearchParams,
) {
  const workspace = z.enum(workspaceIds).parse(params.get('workspace') ?? 'PERSONAL');
  const [tags, accounts] = await Promise.all([
    db.tag.findMany({ where: { userId: user.id, workspace }, orderBy: { createdAt: 'asc' } }),
    db.emailAccount.findMany({
      where: { userId: user.id, workspace },
      select: publicAccount,
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    user: { id: user.id, email: user.email, workRequested: user.workRequested ?? false },
    tags,
    accounts,
  };
}
