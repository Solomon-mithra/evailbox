/** One-off, opt-in live experiment. Only Jev native evaluation and the existing adapter are invoked. */
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { experimental_evaluate as evaluate } from 'ai';
import { createGateway } from '@ai-sdk/gateway';

const { values } = parseArgs({
  options: {
    run: { type: 'boolean' },
    'env-file': { type: 'string' },
    limit: { type: 'string' },
    grouped: { type: 'boolean' },
    'pace-ms': { type: 'string', default: '13000' },
    out: { type: 'string' },
  },
});
const root = process.cwd();
const corpusPath = resolve(root, 'scripts/fixtures/jev-semantics.json');
const corpusText = await readFile(corpusPath, 'utf8');
const corpus = JSON.parse(corpusText);
const hash = (text) => createHash('sha256').update(text).digest('hex');
const rules = new Map(corpus.rules.map((rule) => [rule.id, rule]));
const variants = corpus.methodology.variants;
const paceMs = Number(values['pace-ms']);
assert(Number.isInteger(paceMs) && paceMs >= 0 && paceMs <= 120000);
const concurrency = 1;
const limit = values.limit === undefined ? corpus.cases.length : Number(values.limit);
assert(Number.isInteger(limit) && limit >= 1 && limit <= corpus.cases.length);

function makeTag(rule, variant, id = variant) {
  return {
    id,
    name: rule.name,
    prompt: variant === 'rephrased' ? rule.paraphrase : rule.prompt,
    keywords:
      variant === 'hints'
        ? rule.keywords
        : variant === 'misleading_hints'
          ? ['message', 'your', 'the', 'free', 'newsletter']
          : [],
    senders: variant === 'misleading_hints' ? ['person@example.net'] : [],
  };
}

function keywordBaseline(email, rule) {
  const text = [email.subject, email.snippet, email.body ?? ''].join('\n').toLowerCase();
  return rule.keywords.some((word) => text.includes(word.toLowerCase())) ||
    rule.senders.some((sender) => email.sender.toLowerCase().includes(sender.toLowerCase()))
    ? 'match'
    : 'no_match';
}

// Validate labels, balance, distinct inputs, and the deliberately simple baseline locally.
assert.equal(rules.size, 16);
assert.equal(corpus.cases.length, 224);
assert.equal(new Set(corpus.cases.map((item) => item.id)).size, corpus.cases.length);
for (const item of corpus.cases) {
  assert(rules.has(item.rule));
  assert(['match', 'no_match', 'uncertain'].includes(item.expected));
  assert(item.rationale.length > 10);
  for (const key of ['subject', 'sender', 'snippet'])
    assert.equal(typeof item.email[key], 'string');
  assert(item.email.body === null || typeof item.email.body === 'string');
}
for (const rule of rules.values()) {
  const core = corpus.cases.filter((item) => item.rule === rule.id && item.suite === 'core');
  assert.equal(core.length, 12);
  assert.equal(core.filter((item) => item.expected === 'match').length, 6);
  assert.equal(core.filter((item) => item.expected === 'no_match').length, 6);
  assert.equal(new Set(core.map((item) => JSON.stringify(item.email))).size, 12);
  assert.deepEqual(makeTag(rule, 'plain').keywords, []);
  assert.deepEqual(makeTag(rule, 'plain').senders, []);
}
assert.equal(
  keywordBaseline(
    { subject: 'INVOICE', snippet: '', body: null },
    { keywords: ['invoice'], senders: [] },
  ),
  'match',
);
assert.equal(
  keywordBaseline(
    { subject: 'hello', snippet: '', body: null },
    { keywords: ['invoice'], senders: [] },
  ),
  'no_match',
);
console.log(
  JSON.stringify({
    event: 'validated',
    rules: rules.size,
    cases: corpus.cases.length,
    corpusSha256: hash(corpusText),
    live: !!values.run,
  }),
);
if (!values.run) {
  console.log(
    'No network calls. Add --run --env-file .env.local to opt into the live Jev evaluation.',
  );
  process.exit(0);
}
assert(values['env-file'], '--env-file is required for live execution');
const env = parseEnv(await readFile(resolve(values['env-file']), 'utf8'));
assert(env.JEV_API_KEY, 'Selected file has no JEV_API_KEY');
assert.equal(env.JEV_MODEL_ID || 'typesafe-ai/jev', 'typesafe-ai/jev', 'Only Jev may be used');
const gateway = env.JEV_GATEWAY_URL || 'https://ai-gateway.vercel.sh/v4/ai';
const gatewayUrl = new URL(gateway);
assert.equal(gatewayUrl.protocol, 'https:');
assert(!gatewayUrl.username && !gatewayUrl.password && !gatewayUrl.search && !gatewayUrl.hash);
for (const name of ['JEV_API_KEY', 'JEV_GATEWAY_URL', 'JEV_MODEL_ID', 'JEV_MODEL_VERSION']) {
  if (env[name]) process.env[name] = env[name];
  else delete process.env[name];
}
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(values.out || `test-results/jev-semantics/${runId}`);
await mkdir(out, { recursive: true, mode: 0o700 });
const save = (name, data) =>
  writeFile(resolve(out, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const context = new AsyncLocalStorage();
const network = [];
const originalFetch = globalThis.fetch;
// Intercept all SDK fetch calls: reject other endpoints/models and forbid redirects.
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  assert.equal(
    url,
    gateway.replace(/\/$/, '') + '/evaluation-model',
    'Non-Jev network request blocked',
  );
  const headers = new Headers(init?.headers);
  assert.equal(headers.get('ai-model-id'), 'typesafe-ai/jev', 'Non-Jev model blocked');
  assert.equal(init?.method, 'POST');
  const payload = JSON.parse(String(init.body));
  assert(!('messages' in payload));
  assert.equal(payload.providerOptions.gateway.zeroDataRetention, true);
  assert.equal(payload.providerOptions.gateway.disallowPromptTraining, true);
  const started = performance.now();
  const entry = {
    job: context.getStore(),
    endpoint: url,
    model: headers.get('ai-model-id'),
    questionCount: Object.keys(payload.questions).length,
    requestSha256: hash(String(init.body)),
    visibleStateSha256: hash(JSON.stringify(payload.state)),
    status: null,
  };
  network.push(entry);
  try {
    const response = await originalFetch(input, { ...init, redirect: 'error' });
    entry.status = response.status;
    const body = await response.clone().json();
    entry.answers = body.answers ?? null;
    entry.usage = body.usage ?? null;
    const meta = body.providerMetadata?.gateway;
    entry.cost = meta?.cost ?? null;
    entry.marketCost = meta?.marketCost ?? null;
    entry.servedModel = meta?.model ?? null;
    entry.retryAfter = response.headers.get('retry-after');
    entry.rateLimits = Object.fromEntries(
      [...response.headers].filter(([name]) => /ratelimit|retry-after/.test(name)),
    );
    entry.errorMessage = response.ok
      ? null
      : String(body.error?.message ?? body.error ?? 'Unknown provider error').replaceAll(
          env.JEV_API_KEY,
          '[redacted]',
        );
    return response;
  } finally {
    entry.latencyMs = Math.round(performance.now() - started);
    await appendFile(resolve(out, 'network.ndjson'), JSON.stringify(entry) + '\n', { mode: 0o600 });
  }
};
const { classifyEmailAgainstTags } = await import('../src/lib/jev.ts');
const { boundedEmailInput, CLASSIFICATION_POLICY_VERSION } =
  await import('../src/lib/classification-version.ts');
let jobs = corpus.cases.slice(0, limit).map((item) => ({
  id: item.id,
  phase: 'main',
  item,
  tags: variants.map((variant) => makeTag(rules.get(item.rule), variant)),
  expected: Object.fromEntries(variants.map((variant) => [variant, item.expected])),
}));
if (limit === corpus.cases.length) {
  for (const caseId of corpus.methodology.repeatCaseIds) {
    const item = corpus.cases.find((candidate) => candidate.id === caseId);
    for (let repeat = 1; repeat <= corpus.methodology.repeatRuns; repeat++) {
      jobs.push({
        id: `${caseId}-repeat-${repeat}`,
        phase: 'repeat',
        item,
        tags: [makeTag(rules.get(item.rule), 'plain')],
        expected: { plain: item.expected },
      });
    }
  }
  // Thirty questions: opposing rules on a single email, with order reversed in a second call.
  for (const caseId of ['payment-02', 'payment-08']) {
    const item = corpus.cases.find((candidate) => candidate.id === caseId);
    const forward = Array.from({ length: 30 }, (_, index) => {
      const tag = makeTag(rules.get('payment'), 'plain', `tag${index}`);
      if (index % 2) {
        tag.name = 'No money owed';
        tag.prompt =
          'Match only if the email explicitly states that I owe no money and have nothing to pay.';
      }
      return tag;
    });
    const expected = Object.fromEntries(
      forward.map((tag, index) => [
        tag.id,
        index % 2 ? (item.expected === 'match' ? 'no_match' : 'match') : item.expected,
      ]),
    );
    for (const order of ['forward', 'reverse'])
      jobs.push({
        id: `${caseId}-batch30-${order}`,
        phase: 'batch30',
        item,
        tags: order === 'forward' ? forward : [...forward].reverse(),
        expected,
      });
  }
}
const adapterSource = await readFile('src/lib/jev.ts', 'utf8');
const adapterInstructions = JSON.parse(
  adapterSource.match(/const instructions =\s*("(?:[^"\\]|\\.)*");/)[1],
);
const nativeModel = createGateway({ baseURL: gateway, apiKey: env.JEV_API_KEY }).evaluation(
  'typesafe-ai/jev',
);
if (values.grouped) {
  const individualJobs = jobs;
  const batches = [];
  const pack = (rows, count, prefix) => {
    for (let offset = 0; offset < rows.length; offset += count) {
      batches.push({
        id: `${prefix}-${offset / count + 1}`,
        items: rows.slice(offset, offset + count),
      });
    }
  };
  const mainJobs = individualJobs.filter((job) => job.phase === 'main');
  mainJobs.sort((a, b) => hash(a.id).localeCompare(hash(b.id)));
  pack(mainJobs, 7, 'group');
  for (let repeat = 1; repeat <= corpus.methodology.repeatRuns; repeat++) {
    const rows = individualJobs.filter(
      (job) => job.phase === 'repeat' && job.id.endsWith(`-${repeat}`),
    );
    if (repeat % 2 === 0) rows.reverse();
    pack(rows, 12, `repeat-pass-${repeat}`);
  }
  jobs = [...batches, ...individualJobs.filter((job) => job.phase === 'batch30')];
  if (limit === corpus.cases.length) {
    for (const rule of rules.values()) {
      for (const suffix of ['02', '08']) {
        const original = individualJobs.find((job) => job.id === `${rule.id}-${suffix}`);
        jobs.push({ ...original, id: `adapter-${original.id}`, phase: 'adapter' });
      }
    }
  }
}
// Deterministic interleaving prevents entire categories sharing the same time window.
jobs.sort((a, b) => hash(a.id).localeCompare(hash(b.id)));
const logicalJobs = jobs.flatMap((job) => job.items || [job]);
async function execute(job) {
  if (!job.items) return [await classifyEmailAgainstTags(job.item.email, job.tags, 80, 20000)];
  const state = {
    emails: Object.fromEntries(
      job.items.map((item, index) => [`email${index}`, boundedEmailInput(item.item.email)]),
    ),
  };
  const questions = {};
  for (const [index, item] of job.items.entries()) {
    for (const tag of item.tags) {
      questions[`email${index}_${tag.id}`] = {
        type: 'boolean',
        instructions: {
          task: `Evaluate ONLY state.emails.email${index}. Ignore all other emails in the state. ${adapterInstructions}`,
          tag: { name: tag.name, prompt: tag.prompt, keywords: tag.keywords, senders: tag.senders },
        },
        criteria: {
          true: "The email meets this tag's criteria.",
          false: "The email does not meet this tag's criteria.",
        },
      };
    }
  }
  assert(Object.keys(questions).length <= 30);
  const result = await evaluate({
    model: nativeModel,
    state,
    questions,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(20000),
    providerOptions: { gateway: { zeroDataRetention: true, disallowPromptTraining: true } },
  });
  assert.deepEqual(Object.keys(result.answers).sort(), Object.keys(questions).sort());
  return job.items.map((item, index) =>
    Object.fromEntries(
      item.tags.map((tag) => {
        const answer = result.answers[`email${index}_${tag.id}`];
        assert.equal(answer.type, 'boolean');
        const probability = answer.probability;
        assert(Number.isFinite(probability) && probability >= 0 && probability <= 1);
        const confidence = probability * 100;
        const decision = confidence >= 80 ? 'match' : confidence <= 20 ? 'no_match' : 'uncertain';
        return [tag.id, { matched: decision === 'match', confidence, decision }];
      }),
    ),
  );
}
const manifest = {
  runId,
  startedAt: new Date().toISOString(),
  adapterRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  adapterSha256: hash(await readFile('src/lib/jev.ts')),
  boundsSha256: hash(await readFile('src/lib/classification-version.ts')),
  runnerSha256: hash(await readFile('scripts/eval-jev-semantics.mjs')),
  corpusSha256: hash(corpusText),
  corpusFrozenBeforeRequests: true,
  policy: CLASSIFICATION_POLICY_VERSION,
  model: 'typesafe-ai/jev',
  modelVersionSetting: env.JEV_MODEL_VERSION || '1',
  gateway,
  environmentFile: values['env-file'],
  syntheticOnly: true,
  threshold: 80,
  concurrency,
  expectedCalls: jobs.length,
  expectedDecisions: logicalJobs.reduce((sum, job) => sum + job.tags.length, 0),
  groupedNative: !!values.grouped,
  paceMs,
  sdkRetries: 0,
  harness429Retries: 2,
  protocolAmendment:
    'After observing a five-request-per-minute limit, group up to seven separate emails into a shared native evaluation state with one explicit email selector per question; preserve original labels. Add 32 exact adapter cases (02 and 08 for every rubric). Repeats are separate native requests. Report grouped and adapter results separately.',
  methodology: corpus.methodology,
};
await save('manifest.json', manifest);
console.log(
  JSON.stringify({
    event: 'starting',
    calls: manifest.expectedCalls,
    decisions: manifest.expectedDecisions,
    out,
  }),
);
const records = [];
let completedCalls = 0;
let stopped = false;
let nextStart = 0;
try {
  for (const job of jobs) {
    if (stopped) break;
    const started = performance.now();
    let results;
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      while (Date.now() < nextStart) await sleep(Math.min(30000, nextStart - Date.now()));
      nextStart = Date.now() + paceMs;
      try {
        results = await context.run(job.id, () => execute(job));
        failure = undefined;
        break;
      } catch (error) {
        failure = {
          name: String(error.name),
          status: error.statusCode ?? error.cause?.statusCode ?? null,
        };
        if (failure.status !== 429 || attempt === 2) break;
        const latest = network.at(-1);
        const retryAfter = Number(latest?.retryAfter);
        nextStart = Math.max(
          nextStart,
          Date.now() + (Number.isFinite(retryAfter) ? retryAfter * 1000 + 1000 : 61000),
        );
        console.log(
          JSON.stringify({
            event: 'cooldown',
            job: job.id,
            attempt: attempt + 1,
            waitMs: nextStart - Date.now(),
          }),
        );
      }
    }
    const items = job.items || [job];
    for (const [index, item] of items.entries()) {
      const record = {
        job: item.id,
        requestJob: job.id,
        phase: item.phase,
        protocol: job.items ? 'grouped-native' : 'exact-app-adapter',
        caseId: item.item.id,
        suite: item.item.suite,
        rule: item.item.rule,
        facet: item.item.facet,
        expected: item.expected,
        baseline: keywordBaseline(item.item.email, rules.get(item.item.rule)),
        inputTruncated:
          JSON.stringify(item.item.email) !== JSON.stringify(boundedEmailInput(item.item.email)),
        ...(results ? { results: results[index] } : { error: failure }),
        elapsedIncludingPacingMs: Math.round(performance.now() - started),
      };
      records.push(record);
      await appendFile(resolve(out, 'results.ndjson'), JSON.stringify(record) + '\n', {
        mode: 0o600,
      });
    }
    completedCalls++;
    console.log(
      JSON.stringify({
        event: 'progress',
        completedCalls,
        totalCalls: jobs.length,
        completedCases: records.length,
        errors: records.filter((row) => row.error).length,
        lastJob: job.id,
        error: failure,
      }),
    );
    if (failure) stopped = true;
  }
} finally {
  globalThis.fetch = originalFetch;
}
function metrics(rows, variant = 'plain') {
  const completed = rows.filter((row) => row.results?.[variant]);
  const labeled = completed.filter((row) => row.expected[variant] !== 'uncertain');
  const correct = completed.filter(
    (row) => row.results[variant].decision === row.expected[variant],
  );
  const confidentWrong = labeled.filter(
    (row) =>
      row.results[variant].decision !== 'uncertain' &&
      row.results[variant].decision !== row.expected[variant],
  );
  const truePositive = labeled.filter(
    (row) => row.expected[variant] === 'match' && row.results[variant].decision === 'match',
  ).length;
  const falsePositive = labeled.filter(
    (row) => row.expected[variant] === 'no_match' && row.results[variant].decision === 'match',
  ).length;
  const positives = labeled.filter((row) => row.expected[variant] === 'match').length;
  return {
    attempted: rows.length,
    completed: completed.length,
    correct: correct.length,
    accuracy: completed.length ? correct.length / completed.length : null,
    uncertain: completed.filter((row) => row.results[variant].decision === 'uncertain').length,
    confidentWrong: confidentWrong.length,
    precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null,
    recall: positives ? truePositive / positives : null,
    brierScore: labeled.length
      ? labeled.reduce(
          (sum, row) =>
            sum +
            (row.results[variant].confidence / 100 - (row.expected[variant] === 'match' ? 1 : 0)) **
              2,
          0,
        ) / labeled.length
      : null,
    baselineCorrect: labeled.filter((row) => row.baseline === row.expected[variant]).length,
    failures: completed
      .filter((row) => row.results[variant].decision !== row.expected[variant])
      .map((row) => ({
        id: row.caseId,
        expected: row.expected[variant],
        actual: row.results[variant].decision,
        probability: row.results[variant].confidence / 100,
      })),
  };
}
const main = records.filter((row) => row.phase === 'main');
const core = main.filter((row) => row.suite === 'core');
const latency = network.map((row) => row.latencyMs).sort((a, b) => a - b);
const percentile = (percent) =>
  latency.length ? latency[Math.ceil(percent * latency.length) - 1] : null;
const summary = {
  completedAt: new Date().toISOString(),
  complete: records.length === logicalJobs.length && records.every((row) => row.results),
  calls: completedCalls,
  httpRequests: network.length,
  expectedCalls: jobs.length,
  successfulDecisions: records.reduce((sum, row) => sum + Object.keys(row.results || {}).length, 0),
  errors: records.filter((row) => row.error).map((row) => ({ job: row.job, ...row.error })),
  latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: latency.at(-1) ?? null },
  reportedCost: network.some((row) => row.cost !== null)
    ? network.reduce((sum, row) => sum + Number(row.cost || 0), 0)
    : null,
  suites: Object.fromEntries(
    ['core', 'adversarial', 'ambiguity', 'input_limits'].map((suite) => [
      suite,
      Object.fromEntries(
        variants.map((variant) => [
          variant,
          metrics(
            main.filter((row) => row.suite === suite),
            variant,
          ),
        ]),
      ),
    ]),
  ),
  adapter: Object.fromEntries(
    variants.map((variant) => [
      variant,
      metrics(
        records.filter((row) => row.phase === 'adapter'),
        variant,
      ),
    ]),
  ),
  byRule: Object.fromEntries(
    [...rules.keys()].map((id) => [id, metrics(core.filter((row) => row.rule === id))]),
  ),
  byFacet: Object.fromEntries(
    [...new Set(core.map((row) => row.facet))].map((facet) => [
      facet,
      metrics(core.filter((row) => row.facet === facet)),
    ]),
  ),
  invariance: Object.fromEntries(
    variants
      .filter((variant) => variant !== 'plain')
      .map((variant) => {
        const eligible = core.filter((row) => row.results?.plain && row.results?.[variant]);
        return [
          variant,
          {
            compared: eligible.length,
            unchanged: eligible.filter(
              (row) => row.results.plain.decision === row.results[variant].decision,
            ).length,
            changes: eligible
              .filter((row) => row.results.plain.decision !== row.results[variant].decision)
              .map((row) => row.caseId),
          },
        ];
      }),
  ),
  repeats: corpus.methodology.repeatCaseIds.map((caseId) => {
    const observations = records.filter(
      (row) => row.caseId === caseId && row.phase !== 'batch30' && row.results?.plain,
    );
    return {
      caseId,
      observations: observations.map((row) => ({
        phase: row.phase,
        decision: row.results.plain.decision,
        probability: row.results.plain.confidence / 100,
      })),
      consistent: new Set(observations.map((row) => row.results.plain.decision)).size === 1,
    };
  }),
  batch30: records
    .filter((row) => row.phase === 'batch30')
    .map((row) => ({
      job: row.job,
      completed: Object.keys(row.results || {}).length,
      correct: Object.entries(row.results || {}).filter(
        ([id, result]) => result.decision === row.expected[id],
      ).length,
    })),
};
await save('summary.json', summary);
await save('evidence.json', { manifest, summary, records, network });
console.log(
  JSON.stringify({
    event: 'finished',
    out,
    complete: summary.complete,
    calls: summary.calls,
    successfulDecisions: summary.successfulDecisions,
    core: Object.fromEntries(
      variants.map((variant) => [
        variant,
        { ...summary.suites.core[variant], failures: undefined },
      ]),
    ),
    latencyMs: summary.latencyMs,
    reportedCost: summary.reportedCost,
  }),
);
if (!summary.complete) process.exitCode = 2;
