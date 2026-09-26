/** Temporary, read-only evidence collector. See eval-production.md for the runbook. */
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';
import { currentModelVersion } from '../src/lib/classification-version';
import { collectSnapshot } from './eval-production-db';
import {
  distribution,
  finishObservation,
  observe,
  summarize,
  type Snapshot,
} from './eval-production-core';

const help = `Usage:
  node --conditions=react-server --import tsx scripts/eval-production.ts --env-file .env.local
  node --conditions=react-server --import tsx scripts/eval-production.ts --env-file .env.local --watch-seconds 600 --min-emails 1000

Options:
  --env-file PATH       Required. Only this file supplies service settings; no dotenv fallback.
  --watch-seconds N     Observe new real imports for up to N seconds (1..1800); omit for audit.
  --min-emails N        Minimum distinct new emails for an observation (default 1000).
  --poll-ms N           Pause between reads (1000..60000, default 5000).
  --max-rows N          Refuse truncated evidence (1..50000, default 10000).
  --user-id UUID        Optional tenant scope; defaults to the whole configured database.
  --help               Show this help.

Evidence is written under ignored test-results/production-eval/<run-id>/.
Exit 0: data observed; 2: insufficient/incomplete evidence; 1: collection/setup error; 130: interrupted.
No mailbox, inference, queue, or database writes. Start the real import through the app.
An audit or polling observation does not measure request-to-inbox end-to-end latency.`;

class SetupError extends Error {}
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new SetupError(`Numeric option must be an integer between ${min} and ${max}.`);
  return n;
}
function git(...args: string[]) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      'env-file': { type: 'string' },
      'watch-seconds': { type: 'string' },
      'min-emails': { type: 'string' },
      'poll-ms': { type: 'string' },
      'max-rows': { type: 'string' },
      'user-id': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (!values['env-file'])
    throw new SetupError('Pass --env-file explicitly. Use --help for commands.');
  const seconds = integer(values['watch-seconds'], 0, values['watch-seconds'] ? 1 : 0, 1800);
  const minimum = integer(values['min-emails'], 1000, 1, 50000);
  const pollMs = integer(values['poll-ms'], 5000, 1000, 60000);
  const maxRows = integer(values['max-rows'], 10000, 1, 50000);
  if (seconds && minimum > maxRows) throw new SetupError('--min-emails cannot exceed --max-rows.');
  const userId = values['user-id'];
  if (userId && !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(userId))
    throw new SetupError('--user-id must be a UUID.');
  const envFile = resolve(values['env-file']);
  const env = parseEnv(await readFile(envFile, 'utf8'));
  if (env.APP_MODE !== 'live')
    throw new SetupError(
      'Selected env file must explicitly set APP_MODE=live. Demo results are not evidence.',
    );
  if (!env.DATABASE_URL?.startsWith('postgres'))
    throw new SetupError('Selected env file needs a PostgreSQL DATABASE_URL.');
  const dbUrl = new URL(env.DATABASE_URL);
  // Use the selected file's model settings, never ambient shell values.
  process.env.JEV_MODEL_ID = env.JEV_MODEL_ID || 'typesafe-ai/jev';
  process.env.JEV_MODEL_VERSION = env.JEV_MODEL_VERSION || '1';
  const modelVersion = currentModelVersion();
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const output = resolve('test-results/production-eval', runId);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const write = (name: string, value: unknown) =>
    writeFile(
      resolve(output, name),
      typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  // One ephemeral HMAC key keeps identities consistent within a run without exporting IDs or content hashes.
  const key = randomBytes(32);
  const pseudonym = (kind: string, value: string) =>
    createHmac('sha256', key).update(`${kind}:${value}`).digest('hex');
  const sourceFiles = [
    'scripts/eval-production.ts',
    'scripts/eval-production-core.ts',
    'scripts/eval-production-db.ts',
    'src/lib/classification-version.ts',
    'src/lib/classification.ts',
    'src/lib/sync.ts',
    'src/lib/inngest/work.ts',
    'src/lib/inngest/functions.ts',
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(sourceFiles.map(async (path) => [path, sha256(await readFile(path))])),
  );
  const manifest = {
    schemaVersion: 1,
    runId,
    source: 'configured-live-database',
    mode: seconds ? 'observe' : 'audit',
    environmentFile: relative(process.cwd(), envFile),
    databaseTargetSha256: sha256(
      `${dbUrl.hostname}:${dbUrl.port}/${dbUrl.pathname}/${dbUrl.username}`,
    ),
    databaseIsLoopback: ['localhost', '127.0.0.1', '[::1]'].includes(dbUrl.hostname),
    deploymentEnvironment: 'not_verified',
    deployedRevision: null,
    localRevision: git('rev-parse', 'HEAD').trim(),
    localWorktreeDirty: !!git('status', '--porcelain').trim(),
    localTrackedDiffSha256: sha256(git('diff', '--no-ext-diff', 'HEAD')),
    sourceHashes,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    modelVersion,
    scope: userId ? { user: pseudonym('user', userId) } : 'all_users',
    options: { seconds, minimumEmails: minimum, pollMs, maxRows },
    collection:
      'PostgreSQL REPEATABLE READ + READ ONLY; 15s statement timeout; no content or credentials selected',
    identityPolicy:
      'Ephemeral HMACs; original identifiers, content hashes, and tag IDs are not exported',
    productionSourceAttestation:
      'APP_MODE=live and a real database connection; not independent proof of deployment or historical data origin',
  };
  await write('manifest.json', manifest);
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL, log: [] });
  const snapshots: Snapshot[] = [];
  let interrupted = false,
    failure: string | null = null,
    totalRecords = 0;
  const controller = new AbortController();
  const interrupt = () => {
    interrupted = true;
    controller.abort();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const started = performance.now();
  try {
    do {
      const snapshot = await collectSnapshot(db, modelVersion, maxRows, userId);
      snapshot.emails = snapshot.emails.map((email) => ({
        ...email,
        id: pseudonym('email', email.id),
        userId: pseudonym('user', email.userId),
        contentHash: email.contentHash ? pseudonym('content', email.contentHash) : '',
        rulesSignature: pseudonym('rules', email.rulesSignature),
      }));
      snapshots.push(snapshot);
      totalRecords += snapshot.emails.length;
      await appendFile(resolve(output, 'observations.ndjson'), JSON.stringify(snapshot) + '\n', {
        mode: 0o600,
      });
      console.log(
        JSON.stringify({
          snapshot: snapshots.length,
          at: snapshot.finishedAt,
          ...summarize(snapshot),
          inventory: snapshot.inventory,
        }),
      );
      if (!seconds || interrupted) break;
      const observation = finishObservation(snapshots, minimum);
      // A full new cohort plus idle queue flags is an observation, not proof that the provider mailbox is exhausted.
      if (
        observation.status === 'observed' &&
        !snapshot.inventory.pendingAccounts &&
        !snapshot.inventory.pendingUsers
      )
        break;
      if (totalRecords >= 1_000_000) {
        failure = 'Observation record budget reached; narrow the tenant scope or shorten the run.';
        break;
      }
      const remaining = seconds * 1000 - (performance.now() - started);
      if (remaining <= 0) break;
      await new Promise<void>((done) => {
        const finish = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', finish);
          done();
        };
        const timer = setTimeout(finish, Math.min(pollMs, remaining));
        controller.signal.addEventListener('abort', finish, { once: true });
      });
    } while (!interrupted);
  } catch (error) {
    failure =
      error instanceof Error && error.message === 'EVAL_ROW_LIMIT'
        ? 'Row limit exceeded. Evidence was not truncated. Narrow --user-id or raise --max-rows.'
        : 'Database collection failed. Check connectivity and schema privately; upstream error details were suppressed.';
  } finally {
    await db.$disconnect();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  const last = snapshots.at(-1);
  const audit = last ? summarize(last) : null;
  const observation = seconds ? finishObservation(snapshots, minimum) : null;
  const status = failure
    ? 'collection_failed'
    : interrupted
      ? 'interrupted'
      : (observation?.status ?? (audit?.uniqueEmails ? 'audited' : 'insufficient_evidence'));
  const limitations = [
    'No request-start, provider fetch, Inngest queue, inference, commit, or browser-render spans were collected. End-to-end pipeline latency and 1000 emails in 100ms are not measured.',
    'The selected live database is the data source. Its deployment, historical data origin, and deployed code revision were not independently verified.',
    'Historical import-to-first-decision uses DB transaction timestamps and is only an approximation; it is not first tag match, all-tag completion, inference time, or client-visible latency.',
    'Observation timing is interval-censored between DB snapshots. Upper bounds include polling/query delay; records seen complete at their first observation have a zero lower bound.',
    'Only records visible at polls can be counted. Messages created and deleted entirely between polls are unobservable. Deleted observed records stay in the denominator.',
    'New-cohort completeness is for the imported, visible cohort and current configured model, not proof that every provider email was imported. Idle queue flags alone do not prove success.',
    'Latency distributions cover completed records only; incomplete, changed, late-visible, and missing counts must be reported with them. All observed arrivals are included, even after the minimum is reached.',
    'Observed completions/second is a wall-window rate including idle time, not sustained capacity, an inference benchmark, or a rate extrapolated from a microbenchmark.',
    'No accuracy, cost, retry history, cache-hit rate, speedup, or reliability SLA can be inferred from these records. Current failure flags are not historical failure rates.',
    'Observer query latency measures this local process reading the database; never use it as email processing latency. Local source hashes do not identify deployed code.',
  ];
  const report = {
    runId,
    status,
    failure,
    capturedSnapshots: snapshots.length,
    observerWallMs: performance.now() - started,
    observerQueryWallMs: distribution(snapshots.map((s) => s.queryWallMs)),
    latestInventory: last?.inventory ?? null,
    audit,
    observation,
    pipeline1000In100ms: 'not_measured',
    limitations,
  };
  await write('report.json', report);
  if (seconds) await write('cohort.json', observe(snapshots));
  const story =
    status === 'observed' && observation
      ? `During a ${(observation.observationWindowMs! / 1000).toFixed(2)} s database observation window, ${observation.fullyCurrentNewEmails} newly imported unique emails were observed with decisions for every current tag and the configured model. ${observation.baselineEmailsExcluded} existing emails were excluded. This is an observation of real records, not measured request-to-inbox latency.`
      : !audit
        ? 'No email processing claim can be assessed: database evidence collection did not succeed.'
        : audit.uniqueEmails
          ? `At ${last!.finishedAt}, the configured live database contained ${audit.uniqueEmails} unique email records; ${audit.fullyCurrentEmails} had decisions for every current tag and the configured model. This snapshot does not establish throughput.`
          : 'No email processing performance claim is supported: the configured database had no email records at observation time.';
  await write(
    'report.md',
    `# Real pipeline evidence\n\nRun: \`${runId}\`  \nStatus: **${status}**  \nSource: \`${manifest.environmentFile}\` (configured live database; deployment unverified).\n\n## Defensible wording\n\n${story}\n\n## Claim check\n\n**“1,000 emails processed in 100 ms”: NOT MEASURED.** No replacement or synthetic timing is used.\n\n## Observations\n\n\`\`\`json\n${JSON.stringify({ latestInventory: report.latestInventory, audit, observation }, null, 2)}\n\`\`\`\n\n${failure ? `Collection error: ${failure}\n\n` : ''}## Measurement limits\n\n${limitations.map((s) => `- ${s}`).join('\n')}\n\n## Evidence\n\n- [Report JSON](report.json)\n- [Source/configuration manifest](manifest.json)\n- [Timestamped database observations](observations.ndjson)\n${seconds ? '- [Per-email observation intervals](cohort.json)\n' : ''}- [File checksums](SHA256SUMS)\n\nChecksums detect artifact changes; they do not independently attest that data came from production. Keep this evidence bundle private; timestamps and aggregates may still be sensitive.\n`,
  );
  const names = [
    'manifest.json',
    'report.json',
    'report.md',
    ...(snapshots.length ? ['observations.ndjson'] : []),
    ...(seconds ? ['cohort.json'] : []),
  ];
  await write(
    'SHA256SUMS',
    (
      await Promise.all(
        names.map(async (name) => `${sha256(await readFile(resolve(output, name)))}  ${name}`),
      )
    ).join('\n') + '\n',
  );
  console.log(
    JSON.stringify({ status, report: relative(process.cwd(), resolve(output, 'report.md')) }),
  );
  process.exitCode = failure
    ? 1
    : interrupted
      ? 130
      : ['observed', 'audited'].includes(status)
        ? 0
        : 2;
}

main().catch((error: unknown) => {
  console.error(
    error instanceof SetupError
      ? error.message
      : 'Evaluation setup failed. Check the selected environment file and local tooling; private error details were suppressed.',
  );
  process.exitCode = 1;
});
