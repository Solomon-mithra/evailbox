import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
const deadlines = new AsyncLocalStorage<number>();
export function withProviderDeadline<T>(deadline: number, operation: () => Promise<T>): Promise<T> {
  return deadlines.run(deadline, operation);
}
export class ProviderHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Email provider request failed (${status})`);
    this.name = 'ProviderHttpError';
  }
}
export async function requestJson(url: string | URL, init: RequestInit = {}): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = (deadlines.getStore() ?? Date.now() + 12000) - Date.now();
    if (remaining <= 0) throw new Error('Provider deadline exceeded');
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, Math.min(12000, remaining))),
    });
    if (response.ok) return response.json();
    if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
      const header = response.headers.get('retry-after');
      const seconds = header === null ? NaN : Number(header);
      const retryAfter = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(header ?? '') - Date.now();
      // Do not retry earlier than requested or block a web worker for an unbounded interval.
      if (retryAfter > 5000 || retryAfter > remaining) throw new ProviderHttpError(response.status);
      await response.body?.cancel();
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, Number.isFinite(retryAfter) ? retryAfter : 250 * 2 ** attempt),
        ),
      );
      continue;
    }
    await response.body?.cancel();
    throw new ProviderHttpError(response.status);
  }
  throw new Error('Email provider retry limit exceeded');
}
export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
