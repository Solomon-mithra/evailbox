import 'server-only';
import { workspaceIds, type WorkspaceId } from './workspace-selection';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
function key() {
  const value = process.env.ENCRYPTION_SECRET_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid encryption key');
  return Buffer.from(value, 'hex');
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
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
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
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
