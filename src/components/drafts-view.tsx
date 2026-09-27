'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FilePenLine } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { workspacePath } from '@/lib/workspace-selection';
import { listDemoReplyDrafts } from '@/lib/reply-demo';
import { useWorkspaceSelection } from './workspace-selection';
import { useDemo, useTrustedUser } from './providers';
import { ReplyComposer, type ReplyComposerHandle } from './reply-composer';
import { Button } from './ui/button';
import { useReaderNavigation } from './reader-navigation';
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
  const origin = useRef<{ id: string; scroll: number } | null>(null);
  const { register } = useReaderNavigation();
  const key = useMemo(
    () => (demo ? ['demo', workspace, 'drafts'] : ['private', user?.id, workspace, 'drafts']),
    [demo, workspace, user?.id],
  );
  const drafts = useQuery({
    queryKey: key,
    enabled: demo || !!user,
    queryFn: () =>
      demo
        ? Promise.resolve(listDemoReplyDrafts(workspace))
        : api.get<DraftSummary[]>(workspacePath('/api/drafts', workspace)),
  });
  const dismiss = useCallback(() => {
    setSelected(null);
    void client.invalidateQueries({ queryKey: key });
  }, [client, key]);
  const close = useCallback(async () => {
    if (composer.current && !(await composer.current.save())) {
      toast.error('Your draft could not be saved. Retry before closing.');
      return false;
    }
    dismiss();
    return true;
  }, [dismiss]);
  useEffect(() => (selected ? register(close) : undefined), [selected, register, close]);
  useLayoutEffect(() => {
    if (selected) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.getElementById('draft-reader-title')?.focus({ preventScroll: true });
    } else if (origin.current) {
      const { id, scroll } = origin.current;
      origin.current = null;
      (document.getElementById(`draft-${id}`) ?? document.getElementById('drafts-title'))?.focus({
        preventScroll: true,
      });
      window.scrollTo({ top: scroll, behavior: 'instant' });
    }
  }, [selected]);
  if (selected)
    return (
      <section className="email-reader" aria-label="Saved reply">
        <div className="email-reader-actions">
          <Button variant="ghost" onClick={() => void close()}>
            <ArrowLeft size={18} /> Back to drafts
          </Button>
        </div>
        <div className="email-reader-content">
          <h1 id="draft-reader-title" className="email-reader-title" tabIndex={-1}>
            {selected.email.subject}
          </h1>
          <ReplyComposer
            key={`${workspace}:${selected.id}`}
            ref={composer}
            email={{
              id: selected.emailId,
              accountId: selected.accountId,
              subject: selected.email.subject,
              sender: selected.email.sender,
            }}
            onSaved={dismiss}
            onSent={dismiss}
          />
        </div>
      </section>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 id="drafts-title" tabIndex={-1}>
            Drafts
          </h1>
          <p>Pick up where you left off. Sent replies leave this list.</p>
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
              id={`draft-${draft.id}`}
              className={styles.draftRow}
              onClick={() => {
                origin.current = { id: draft.id, scroll: window.scrollY };
                setSelected(draft);
              }}
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
                  {draft.status === 'editing'
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
    </>
  );
}
