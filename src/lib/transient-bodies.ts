import 'server-only';

/** Caller-owned memory for ONE worker step. Never return, log, or persist this map. */
export type TransientBodies = Map<string, { body: string | null; contentHash: string }>;
export function bodyKey(accountId: string, providerMessageId: string) {
  return JSON.stringify([accountId, providerMessageId]);
}
