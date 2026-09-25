import { afterEach, expect, it, vi } from 'vitest';
import {
  boundedEmailInput,
  emailContentHash,
  currentModelVersion,
} from '@/lib/classification-version';
afterEach(() => vi.unstubAllEnvs());
const email = { subject: 'Invoice', sender: 'a@example.com', snippet: 'Short', body: 'private' };
it('hashes exactly the bounded model input and ignores fields the model never receives', () => {
  const long = { ...email, body: 'a'.repeat(24000) + 'tail' };
  expect(boundedEmailInput(long).body).toHaveLength(24000);
  expect(emailContentHash(long)).toBe(
    emailContentHash({ ...long, body: 'a'.repeat(24000) + 'changed tail' }),
  );
  expect(emailContentHash(email)).not.toBe(emailContentHash({ ...email, subject: 'Changed' }));
  expect(emailContentHash({ ...email, body: null })).not.toBe(
    emailContentHash({ ...email, body: '' }),
  );
});
it('invalidates decisions for model identity and deployment revision changes', () => {
  const initial = currentModelVersion();
  vi.stubEnv('JEV_MODEL_VERSION', 'revision-2');
  expect(currentModelVersion()).not.toBe(initial);
  const revised = currentModelVersion();
  vi.stubEnv('JEV_MODEL_ID', 'typesafe-ai/next');
  expect(currentModelVersion()).not.toBe(revised);
});
