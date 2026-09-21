import { expect, it } from 'vitest';
import { digestWindow, escapeHtml, isPushEndpoint } from '../src/lib/notification-utils';
it('schedules per timezone, once in the 15 minute window', () => {
  expect(digestWindow(new Date('2026-09-21T16:05:00Z'), 'America/Los_Angeles', '09:00')).toEqual({
    due: true,
    date: '2026-09-21',
  });
  expect(digestWindow(new Date('2026-09-21T17:05:00Z'), 'America/Los_Angeles', '09:00').due).toBe(
    false,
  );
});
it('escapes untrusted email content', () => {
  expect(escapeHtml('<img src="x">&')).toBe('&lt;img src=&quot;x&quot;&gt;&amp;');
});
it('rejects arbitrary push endpoints and private network targets', () => {
  expect(isPushEndpoint('https://localhost/push')).toBe(false);
  expect(isPushEndpoint('https://fcm.googleapis.com.evil.com/a')).toBe(false);
  expect(isPushEndpoint('http://fcm.googleapis.com/a')).toBe(false);
  expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/test')).toBe(true);
});

it('delivers a late-night scheduled digest after midnight against previous date', () => {
  expect(digestWindow(new Date('2026-09-22T00:00:00Z'), 'UTC', '23:59')).toEqual({
    due: true,
    date: '2026-09-21',
  });
});
