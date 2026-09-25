import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const m = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  requireUser: m.user,
  supabaseServer: async () => ({ auth: { getSession: m.session } }),
}));
import { GET } from '../src/app/api/realtime/session/route';
import { ApiError } from '../src/lib/errors';
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: 'verified' });
});
it('requires server-verified identity before exposing realtime credentials', async () => {
  m.user.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Sign in'));
  expect((await GET(new Request('http://localhost/api/realtime/session'))).status).toBe(401);
  expect(m.session).not.toHaveBeenCalled();
});
it('refuses a mismatched session and returns no tokens', async () => {
  m.session.mockResolvedValue({
    data: { session: { user: { id: 'other' }, access_token: 'private' } },
  });
  const response = await GET(new Request('http://localhost/api/realtime/session'));
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain('private');
});
it('returns a no-store scoped short-lived token', async () => {
  m.session.mockResolvedValue({
    data: { session: { user: { id: 'verified' }, access_token: 'fixture', expires_at: 123 } },
  });
  const response = await GET(new Request('http://localhost/api/realtime/session'));
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).data).toMatchObject({ userId: 'verified', expiresAt: 123000 });
});
const pg = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
beforeAll(async () => {
  await pg.exec(
    `CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA realtime; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic',true) $$; CREATE TABLE realtime.messages(extension text); ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA auth,realtime TO authenticated; GRANT SELECT,INSERT ON realtime.messages TO authenticated; INSERT INTO realtime.messages VALUES ('broadcast');`,
  );
  await pg.exec(
    await readFile('prisma/migrations/20260925010000_private_realtime/migration.sql', 'utf8'),
  );
}, 30000);
afterAll(() => pg.close());
it('allows only own workspace broadcasts and denies browser publishing', async () => {
  await pg.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${alice}'`);
  try {
    for (const topic of [`inbox:${alice}:PERSONAL`, `inbox:${alice}:WORK`]) {
      await pg.query("SELECT set_config('realtime.topic',$1,false)", [topic]);
      expect((await pg.query('SELECT * FROM realtime.messages')).rows).toHaveLength(1);
    }
    for (const topic of [
      'inbox:22222222-2222-4222-8222-222222222222:PERSONAL',
      `inbox:${alice}:OTHER`,
    ]) {
      await pg.query("SELECT set_config('realtime.topic',$1,false)", [topic]);
      expect((await pg.query('SELECT * FROM realtime.messages')).rows).toHaveLength(0);
    }
    await expect(pg.query("INSERT INTO realtime.messages VALUES ('broadcast')")).rejects.toThrow(
      /row-level security/,
    );
  } finally {
    await pg.exec('RESET ROLE');
  }
});
