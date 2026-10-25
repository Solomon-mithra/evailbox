import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * A fresh, fully migrated SQLite file per test file. Cached on globalThis so tests that call
 * vi.resetModules() (and re-run the mocked '@/lib/db' factory) keep talking to the same file.
 */
type Shared = { dir: string; url: string; client: PrismaClient };
const g = globalThis as unknown as { __evailboxTestDb?: Shared };
if (!g.__evailboxTestDb) {
  const dir = mkdtempSync(join(tmpdir(), 'evailbox-test-'));
  const url = `file:${join(dir, 'test.db')}`;
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  g.__evailboxTestDb = { dir, url, client: new PrismaClient({ datasourceUrl: url }) };
}
const shared = g.__evailboxTestDb;
export const testDb = shared.client;
export const testDbUrl = shared.url;

export async function closeTestDb() {
  await testDb.$disconnect();
  rmSync(shared.dir, { recursive: true, force: true });
}

/** Empties every table (cascade from users, plus singletons) between tests. */
export async function resetTestDb() {
  await testDb.user.deleteMany();
  await testDb.appSettings.deleteMany();
  await testDb.processingState.deleteMany();
}
