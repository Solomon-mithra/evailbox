import 'server-only';
import { Inngest } from 'inngest';
import { isConfigured, isDemo } from '../env';

export function backgroundConfigured() {
  return (
    !isDemo() &&
    ((process.env.NODE_ENV !== 'production' && process.env.INNGEST_DEV === '1') ||
      (isConfigured(process.env.INNGEST_EVENT_KEY) &&
        isConfigured(process.env.INNGEST_SIGNING_KEY)))
  );
}

export const inngest = new Inngest({
  id: 'evailbox',
  // A step gets its own request, keeping two 40-second batches out of one 60-second function.
  checkpointing: false,
  isDev: process.env.NODE_ENV !== 'production' && process.env.INNGEST_DEV === '1',
  aiMetadata: false,
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(5000),
    }),
});
