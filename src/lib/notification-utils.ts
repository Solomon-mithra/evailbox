export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export function digestWindow(now: Date, timezone: string, time: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const [hours, minutes] = time.split(':').map(Number);
  const difference = Number(get('hour')) * 60 + Number(get('minute')) - (hours * 60 + minutes);
  const date = new Date(
    Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))),
  );
  if (difference < 0) date.setUTCDate(date.getUTCDate() - 1);
  return { due: (difference + 1440) % 1440 < 15, date: date.toISOString().slice(0, 10) };
}
export function isPushEndpoint(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443') &&
      (u.hostname === 'fcm.googleapis.com' ||
        u.hostname === 'updates.push.services.mozilla.com' ||
        u.hostname.endsWith('.notify.windows.com') ||
        u.hostname === 'web.push.apple.com')
    );
  } catch {
    return false;
  }
}
