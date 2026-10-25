import 'server-only';
import { workspaceIds, type WorkspaceId } from './workspace-selection';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
let generated: Buffer | undefined;
/** ENCRYPTION_SECRET_KEY wins; otherwise one key is created on first use in data/secret.key. */
export function serverSecret() {
  const value = process.env.ENCRYPTION_SECRET_KEY;
  if (value) {
    if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid encryption key');
    return Buffer.from(value, 'hex');
  }
  if (generated) return generated;
  const dir = join(process.cwd(), 'data'),
    file = join(dir, 'secret.key');
  try {
    generated = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    mkdirSync(dir, { recursive: true });
    // 'wx' never overwrites a key another process just wrote; losing it orphans every token.
    try {
      writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    } catch (race) {
      if ((race as NodeJS.ErrnoException).code !== 'EEXIST') throw race;
    }
    generated = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  }
  if (generated.length !== 32) throw new Error('Invalid data/secret.key');
  return generated;
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', serverSecret(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}
export function decrypt(value: string) {
  const [version, iv, tag, data, ...extra] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data || extra.length)
    throw new Error('Invalid encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', serverSecret(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
export function constantTimeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function createOAuthState(
  userId: string,
  provider: string,
  verifier: string,
  now = Date.now(),
  workspace: WorkspaceId = 'PERSONAL',
) {
  return encrypt(
    JSON.stringify({
      userId,
      workspace,
      provider,
      verifier,
      createdAt: now,
      nonce: randomBytes(24).toString('hex'),
    }),
  );
}
export function verifyOAuthState(value: string, userId: string, provider: string) {
  const data: unknown = JSON.parse(decrypt(value));
  if (typeof data !== 'object' || !data) throw new Error('Invalid OAuth state');
  const d = data as Record<string, unknown>;
  if (
    d.userId !== userId ||
    d.provider !== provider ||
    typeof d.verifier !== 'string' ||
    typeof d.createdAt !== 'number' ||
    Date.now() - d.createdAt > 600000 ||
    d.createdAt > Date.now() + 30000
  )
    throw new Error('Expired or invalid OAuth state');
  const workspace = d.workspace ?? 'PERSONAL';
  if (!workspaceIds.includes(workspace as WorkspaceId)) throw new Error('Invalid workspace');
  return { verifier: d.verifier, workspace: workspace as WorkspaceId };
}
