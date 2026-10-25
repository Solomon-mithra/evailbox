import 'server-only';
import { db } from './db';
import { ApiError } from './errors';
import type { AccountOverview } from '@/types';

export async function getAccountOverview(userId: string): Promise<AccountOverview> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
  };
}
