import 'server-only';
import { createHash } from 'node:crypto';
export type ClassificationInput = {
  subject: string;
  sender: string;
  snippet: string;
  body: string | null;
};
/** Bump whenever instructions, input bounds, question semantics or decision thresholds change. */
export const CLASSIFICATION_POLICY_VERSION = 'independent-tags-80-20-v1';
export function currentModelId() {
  return process.env.JEV_MODEL_ID || 'typesafe-ai/jev';
}
export function currentModelVersion() {
  return JSON.stringify([
    currentModelId(),
    process.env.JEV_MODEL_VERSION || '1',
    CLASSIFICATION_POLICY_VERSION,
  ]);
}
export function boundedEmailInput(email: ClassificationInput): ClassificationInput {
  return {
    subject: email.subject.slice(0, 2000),
    sender: email.sender.slice(0, 1000),
    snippet: email.snippet.slice(0, 2000),
    body: email.body?.slice(0, 24000) ?? null,
  };
}
export function emailContentHash(email: ClassificationInput) {
  return createHash('sha256')
    .update(JSON.stringify(boundedEmailInput(email)))
    .digest('hex');
}
