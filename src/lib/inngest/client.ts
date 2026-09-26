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
  // Each durable step gets its own request; import and classification share one 40-second step.
  checkpointing: false,
  isDev: process.env.NODE_ENV !== 'production' && process.env.INNGEST_DEV === '1',
  aiMetadata: false,
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(5000),
    }),
});
