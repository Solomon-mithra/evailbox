import type { ReplyDraftDTO, ReplyDraftResult } from './mail-actions';
import type { ReplyMode } from './providers/actions';
import type { WorkspaceId } from './workspace-selection';
type DemoEmail = { id: string; accountId: string; subject: string; sender: string };
// Demo text stays in memory; there is no network transport or browser persistence here.
const drafts = new Map<
  string,
  { draft: ReplyDraftDTO; email: DemoEmail; from: string; provider: string }
>();
const key = (workspace: WorkspaceId, emailId: string) => `${workspace}:${emailId}`;
export function getDemoReplyDraft(
  workspace: WorkspaceId,
  email: DemoEmail,
  from: string,
  mode?: ReplyMode,
  provider = 'GMAIL',
): ReplyDraftResult {
  const saved = drafts.get(key(workspace, email.id));
  return {
    draft: saved?.draft ?? null,
    context: { from, to: [email.sender], cc: [], subject: `Re: ${email.subject}` },
    account: { id: email.accountId, email: from, provider },
    notice:
      mode === 'reply-all'
        ? 'Demo: sample recipients only. No email will be sent.'
        : 'Demo: drafts last for this tab session. No email will be sent.',
  };
}
export function saveDemoReplyDraft(
  workspace: WorkspaceId,
  email: DemoEmail,
  from: string,
  input: { body: string; mode: ReplyMode },
  provider = 'GMAIL',
): ReplyDraftDTO {
  const previous = drafts.get(key(workspace, email.id))?.draft;
  const draft: ReplyDraftDTO = {
    id: previous?.id ?? `demo-${email.id}`,
    ...input,
    revision: (previous?.revision ?? -1) + 1,
    status: 'editing',
    lastError: null,
    updatedAt: new Date().toISOString(),
    acceptedAt: null,
  };
  drafts.set(key(workspace, email.id), { draft, email, from, provider });
  return draft;
}
export function sendDemoReplyDraft(workspace: WorkspaceId, emailId: string): ReplyDraftDTO {
  const saved = drafts.get(key(workspace, emailId));
  if (!saved) throw new Error('Save a sample draft first.');
  saved.draft = { ...saved.draft, status: 'accepted', acceptedAt: new Date().toISOString() };
  return saved.draft;
}
export function listDemoReplyDrafts(workspace: WorkspaceId) {
  return [...drafts.entries()]
    .filter(([id]) => id.startsWith(`${workspace}:`))
    .map(([, { draft, email, from, provider }]) => ({
      id: draft.id,
      emailId: email.id,
      accountId: email.accountId,
      mode: draft.mode,
      status: draft.status,
      updatedAt: draft.updatedAt,
      account: { email: from, provider },
      email: { subject: email.subject, sender: email.sender },
    }));
}
