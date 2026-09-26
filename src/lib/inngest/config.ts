/** Per-user turns stay small even on larger Inngest plans. */
export const WORK_BATCH_SIZE = 20;
export function inboxConcurrency() {
  const value = Number(process.env.INBOX_WORK_CONCURRENCY ?? 5);
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.floor(value))) : 5;
}
