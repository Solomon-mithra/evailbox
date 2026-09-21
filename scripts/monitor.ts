const target = process.env.HEALTHCHECK_URL;
if (!target) throw new Error('HEALTHCHECK_URL is required');
const until = process.env.MONITOR_UNTIL;
if (process.env.MONITOR_EVENT === 'schedule' && until && Date.now() > new Date(until).getTime()) {
  console.log('Initial 24-hour monitoring window is complete.');
} else {
  const response = await fetch(new URL('/api/health', target), {
    signal: AbortSignal.timeout(15000),
  });
  const result = (await response.json()) as { data?: { status?: string; mode?: string } };
  if (!response.ok || result.data?.status !== 'ok')
    throw new Error(`Health check failed: HTTP ${response.status}`);
  console.log(
    JSON.stringify({ at: new Date().toISOString(), status: 'ok', mode: result.data.mode }),
  );
}
export {};
