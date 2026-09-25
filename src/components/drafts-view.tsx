'use client';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePenLine } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { workspacePath } from '@/lib/workspace-selection';
import { listDemoReplyDrafts } from '@/lib/reply-demo';
import { useWorkspaceSelection } from './workspace-selection';
import { useDemo, useTrustedUser } from './providers';
import { ReplyComposer, type ReplyComposerHandle } from './reply-composer';
import { Dialog } from './ui/dialog';
import { EmptyState, ErrorState } from './states';
import { Skeleton } from './ui/loader';
import styles from './reply-composer.module.css';
type DraftSummary = {
  id: string;
  emailId: string;
  accountId: string;
  mode: string;
  status: string;
  updatedAt: string;
  account: { email: string; provider: string };
  email: { subject: string; sender: string };
};
export function DraftsView() {
  const { workspace } = useWorkspaceSelection(),
    user = useTrustedUser(),
    demo = useDemo(),
    client = useQueryClient();
  const [selected, setSelected] = useState<DraftSummary | null>(null);
  const composer = useRef<ReplyComposerHandle>(null);
  const key = demo ? ['demo', workspace, 'drafts'] : ['private', user?.id, workspace, 'drafts'];
  const drafts = useQuery({
    queryKey: key,
    enabled: demo || !!user,
    queryFn: () =>
      demo
        ? Promise.resolve(listDemoReplyDrafts(workspace))
        : api.get<DraftSummary[]>(workspacePath('/api/drafts', workspace)),
  });
  const close = async () => {
    if (composer.current && !(await composer.current.save())) {
      toast.error('Your draft could not be saved. Retry before closing.');
      return;
    }
    setSelected(null);
    await client.invalidateQueries({ queryKey: key });
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Drafts & replies</h1>
          <p>Reopen your saved replies, including replies to archived messages.</p>
        </div>
      </div>
      {demo && (
        <p className={styles.notice}>
          Demo drafts last for this tab session. Sending is simulated; no email is sent.
        </p>
      )}
      {drafts.isLoading ? (
        <Skeleton />
      ) : drafts.isError ? (
        <ErrorState retry={() => void drafts.refetch()} />
      ) : !drafts.data?.length ? (
        <EmptyState
          title="Your replies start in the inbox"
          message="Open an email and choose Reply. Your draft will save here as you type."
        />
      ) : (
        <div className={styles.list}>
          {drafts.data.map((draft) => (
            <button
              type="button"
              key={draft.id}
              className={styles.draftRow}
              onClick={() => setSelected(draft)}
            >
              <span>
                <strong>
                  <FilePenLine size={15} /> {draft.email.subject}
                </strong>
                <small>
                  {draft.account.email} · Reply to {draft.email.sender}
                </small>
              </span>
              <span>
                <strong>
                  {draft.status === 'accepted'
                    ? demo
                      ? 'Simulated'
                      : 'Accepted'
                    : draft.status === 'editing'
                      ? 'Draft'
                      : draft.status === 'unknown'
                        ? 'Check status'
                        : 'Sending'}
                </strong>
                <small>{new Date(draft.updatedAt).toLocaleString()}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) void close();
        }}
        title={selected?.email.subject ?? 'Reply draft'}
        description="Review your saved reply and send it when ready."
        wide
      >
        {selected && (
          <ReplyComposer
            key={`${workspace}:${selected.id}`}
            ref={composer}
            email={{
              id: selected.emailId,
              accountId: selected.accountId,
              subject: selected.email.subject,
              sender: selected.email.sender,
            }}
          />
        )}
      </Dialog>
    </>
  );
}
