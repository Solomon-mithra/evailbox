import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const evaluate = vi.hoisted(() => vi.fn());
vi.mock('ai', () => ({ experimental_evaluate: evaluate }));
import { classifyEmailAgainstTag, classifyEmailAgainstTags } from '../src/lib/jev';
const email = { subject: 'Invoice', sender: 'ada@example.com', snippet: 'Due', body: 'Please pay' };
const tag = {
  name: 'Finance',
  prompt: 'Invoices requiring action',
  keywords: ['invoice'],
  senders: [],
};
beforeEach(() => {
  vi.stubEnv('JEV_API_KEY', 'fixture-key');
  vi.stubEnv('JEV_GATEWAY_URL', 'https://ai-gateway.vercel.sh/v4/ai');
  evaluate.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  [0.92, true, 'match'],
  [0.1, false, 'no_match'],
  [0.6, false, 'uncertain'],
] as const)(
  'maps native probability %s through explicit thresholds',
  async (probability, matched, decision) => {
    evaluate.mockResolvedValue({ answers: { matchesTag: { type: 'boolean', probability } } });
    const result = await classifyEmailAgainstTag(email, tag);
    expect(result).toMatchObject({ matched, decision, confidence: probability * 100 });
    expect(result.reasoning).toContain('P(match)');
    const call = evaluate.mock.calls[0][0];
    expect(call.questions.matchesTag.type).toBe('boolean');
    expect(call.state.email.subject).toBe('Invoice');
    expect(call.providerOptions.gateway.zeroDataRetention).toBe(true);
  },
);
it('rejects malformed model outputs and propagates inference failures', async () => {
  evaluate.mockResolvedValueOnce({
    answers: { matchesTag: { type: 'boolean', probability: 1.4 } },
  });
  await expect(classifyEmailAgainstTag(email, tag)).rejects.toThrow();
  evaluate.mockRejectedValueOnce(new Error('model unavailable'));
  await expect(classifyEmailAgainstTag(email, tag)).rejects.toThrow('model unavailable');
});
it('rejects invalid thresholds before inference', async () => {
  await expect(classifyEmailAgainstTag(email, tag, 40)).rejects.toThrow();
  expect(evaluate).not.toHaveBeenCalled();
});
it('uses the installed SDK evaluation-model wire protocol, with no chat request', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  evaluate.mockImplementation(actual.experimental_evaluate);
  const fetchFixture = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          answers: { matchesTag: { type: 'boolean', probability: 0.87 } },
          usage: { inputTokens: 30 },
          warnings: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchFixture);
  try {
    expect((await classifyEmailAgainstTag(email, tag)).matched).toBe(true);
    const calls = fetchFixture.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('https://ai-gateway.vercel.sh/v4/ai/evaluation-model');
    const headers = new Headers(calls[0][1].headers);
    expect(headers.get('ai-model-id')).toBe('typesafe-ai/jev');
    expect(headers.get('ai-evaluation-model-specification-version')).toBe('4');
    const payload = JSON.parse(String(calls[0][1].body));
    expect(payload.questions.matchesTag.type).toBe('boolean');
    expect(payload).not.toHaveProperty('messages');
  } finally {
    vi.unstubAllGlobals();
  }
});
it('evaluates three tag questions in one native Gateway request and maps results by caller ID', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  evaluate.mockImplementation(actual.experimental_evaluate);
  const fetchFixture = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          answers: {
            q0: { type: 'boolean', probability: 0.91 },
            q1: { type: 'boolean', probability: 0.1 },
            q2: { type: 'boolean', probability: 0.55 },
          },
          warnings: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchFixture);
  try {
    const tags = [
      { ...tag, id: 'finance' },
      { ...tag, id: 'hiring', prompt: 'Interviews and hiring updates' },
      { ...tag, id: '__proto__', prompt: 'Messages requesting an urgent reply' },
    ];
    const result = await classifyEmailAgainstTags(email, tags, 80, 1200);
    expect(fetchFixture).toHaveBeenCalledTimes(1);
    expect(result.finance.decision).toBe('match');
    expect(result.hiring.decision).toBe('no_match');
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(result['__proto__'].decision).toBe('uncertain');
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    const calls = fetchFixture.mock.calls as unknown as [string, RequestInit][];
    const payload = JSON.parse(String(calls[0][1].body));
    expect(Object.keys(payload.questions)).toEqual(['q0', 'q1', 'q2']);
    expect(payload.state).toEqual({ email });
    expect(payload.questions.q1.instructions.tag.prompt).toBe(tags[1].prompt);
    expect(payload.questions.q0.instructions.tag.prompt).toBe(tags[0].prompt);
    expect(payload.questions.q0.type).toBe('boolean');
    expect(payload).not.toHaveProperty('messages');
    expect(evaluate.mock.calls[0][0].maxRetries).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
it('returns a Gateway 429 immediately without retrying the HTTP request', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  evaluate.mockImplementation(actual.experimental_evaluate);
  const fetchFixture = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: { type: 'rate_limit_exceeded', message: 'fixture rate limit' },
          generationId: 'gen_fixture',
        }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } },
      ),
  );
  vi.stubGlobal('fetch', fetchFixture);
  try {
    await expect(classifyEmailAgainstTag(email, tag)).rejects.toMatchObject({ statusCode: 429 });
    expect(fetchFixture).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
it.each([
  { q0: { type: 'boolean', probability: 0.9 } },
  { q0: { type: 'boolean', probability: 0.9 }, q1: { type: 'boolean', probability: 5 } },
  {
    q0: { type: 'boolean', probability: 0.9 },
    q1: { type: 'boolean', probability: 0.1 },
    unexpected: { type: 'boolean', probability: 0.5 },
  },
])('rejects an incomplete or invalid question set atomically', async (answers) => {
  evaluate.mockResolvedValue({ answers });
  await expect(
    classifyEmailAgainstTags(email, [
      { ...tag, id: 'one' },
      { ...tag, id: 'two' },
    ]),
  ).rejects.toThrow();
});
it('returns no decisions and makes no call for zero tags', async () => {
  expect(await classifyEmailAgainstTags(email, [])).toEqual({});
  expect(evaluate).not.toHaveBeenCalled();
});
it('rejects duplicate or invalid IDs and batches larger than thirty before inference', async () => {
  await expect(
    classifyEmailAgainstTags(email, [
      { ...tag, id: 'duplicate' },
      { ...tag, id: 'duplicate' },
    ]),
  ).rejects.toThrow();
  await expect(classifyEmailAgainstTags(email, [{ ...tag, id: '' }])).rejects.toThrow();
  await expect(
    classifyEmailAgainstTags(
      email,
      Array.from({ length: 31 }, (_, i) => ({ ...tag, id: `id${i}` })),
    ),
  ).rejects.toThrow();
  expect(evaluate).not.toHaveBeenCalled();
});
it('uses the remaining caller timeout and rejects exhausted budgets before inference', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  evaluate.mockResolvedValue({ answers: { q0: { type: 'boolean', probability: 0.9 } } });
  try {
    await classifyEmailAgainstTags(email, [{ ...tag, id: 'one' }], 80, 1500);
    expect(timeout).toHaveBeenCalledWith(1500);
    evaluate.mockClear();
    await expect(classifyEmailAgainstTags(email, [{ ...tag, id: 'one' }], 80, 0)).rejects.toThrow();
    expect(evaluate).not.toHaveBeenCalled();
  } finally {
    timeout.mockRestore();
  }
});
