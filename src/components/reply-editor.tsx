'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle2, FilePenLine, RefreshCw, Reply, Send } from 'lucide-react';
import type { ReplyDraftDTO } from '@/lib/mail-actions';
import type { ReplyContext, ReplyMode } from '@/lib/providers/actions';
import { Button } from './ui/button';
import styles from './reply-composer.module.css';

export type ReplyEditorState = {
  emailId: string;
  body: string;
  mode: ReplyMode;
  draft: ReplyDraftDTO | null;
  accountEmail: string;
  context: ReplyContext | null;
  contextBusy: boolean;
  loaded: boolean;
  saveState: 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';
  busy: 'save' | 'send' | 'new' | 'reconcile' | null;
  error: string;
  notice: string | null;
  demo: boolean;
  staleDraft?: boolean;
};
type Actions = {
  changeBody: (body: string) => void;
  changeMode: (mode: ReplyMode) => void;
  send: () => void;
  save: () => void;
  newReply: () => void;
  reconcile: () => void;
  reload: () => void;
  loadRecipients: () => void;
};

export function ReplyEditor({ state, actions }: { state: ReplyEditorState; actions: Actions }) {
  const { draft, body, mode, loaded, busy, context, contextBusy, saveState, demo, error } = state;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const locked = !!state.staleDraft || (!!draft && draft.status !== 'editing');
  const loading = !loaded || saveState === 'loading';
  const editable = !loading && !locked;
  useEffect(() => {
    if (editable) textarea.current?.focus({ preventScroll: true });
  }, [editable]);

  if (draft?.status === 'accepted') {
    return (
      <section className={`${styles.composer} ${styles.sent}`} aria-label="Reply sent">
        <CheckCircle2 size={20} aria-hidden="true" />
        <div>
          <h3>{demo ? 'Reply simulated' : 'Reply sent'}</h3>
          <p>{demo ? 'No email was sent.' : 'You can send another reply in this conversation.'}</p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          disabled={!!busy || loading}
          onClick={error ? actions.reload : actions.newReply}
        >
          <Reply size={16} />
          {busy === 'new' || loading ? 'Opening…' : error ? 'Open current draft' : 'Reply again'}
        </Button>
      </section>
    );
  }

  return (
    <section className={styles.composer} aria-label="Reply composer">
      <div className={styles.heading}>
        <h3>
          {state.staleDraft ? 'Draft changed' : locked ? 'Confirming your reply' : 'Your reply'}
        </h3>
        <label>
          <span className="sr-only">Reply recipients</span>
          <select
            value={mode}
            disabled={!!busy || locked || loading}
            onChange={(e) => actions.changeMode(e.target.value as ReplyMode)}
          >
            <option value="reply">Reply</option>
            <option value="reply-all">Reply all</option>
          </select>
        </label>
      </div>
      <dl className={styles.recipients}>
        <dt>To</dt>
        <dd>
          {loading || contextBusy
            ? 'Loading recipients…'
            : context?.to.join(', ') || 'Recipients unavailable'}
        </dd>
        {!!context?.cc.length && (
          <>
            <dt>Cc</dt>
            <dd>{context.cc.join(', ')}</dd>
          </>
        )}
        <dt>From</dt>
        <dd>{state.accountEmail || 'Loading account…'}</dd>
      </dl>
      <label htmlFor={`reply-${state.emailId}`} className="sr-only">
        Reply message
      </label>
      <textarea
        ref={textarea}
        id={`reply-${state.emailId}`}
        className={styles.body}
        value={body}
        maxLength={16000}
        placeholder={loaded ? 'Write your reply…' : 'Opening saved draft…'}
        disabled={!!busy || loading}
        readOnly={locked}
        onChange={(e) => actions.changeBody(e.target.value)}
      />
      {error && (
        <p role="alert" className={`${styles.notice} ${styles.error}`}>
          {error}
        </p>
      )}
      {state.notice && !contextBusy && !locked && <p className={styles.notice}>{state.notice}</p>}
      {locked && !state.staleDraft && (
        <p role="status" className={styles.notice}>
          {draft?.lastError ||
            'Your send is being confirmed. Check its status before sending again.'}
        </p>
      )}
      <div className={styles.footer}>
        <div className={styles.buttons}>
          {locked ? (
            <Button
              variant="outline"
              disabled={!!busy || loading}
              onClick={state.staleDraft ? actions.reload : actions.reconcile}
            >
              <RefreshCw size={16} />
              {loading
                ? 'Opening…'
                : state.staleDraft
                  ? 'Open current draft'
                  : busy === 'reconcile'
                    ? 'Checking…'
                    : 'Check send status'}
            </Button>
          ) : (
            <>
              <Button
                data-action="send"
                disabled={
                  !!busy ||
                  loading ||
                  contextBusy ||
                  !context ||
                  !body.trim() ||
                  saveState === 'error'
                }
                onClick={actions.send}
              >
                <Send size={16} />
                {busy === 'send' ? 'Sending…' : demo ? 'Simulate send' : 'Send reply'}
              </Button>
              <Button
                data-action="save"
                variant="outline"
                disabled={!!busy || loading || (!body.trim() && !draft)}
                onClick={actions.save}
              >
                <FilePenLine size={16} />
                {busy === 'save' ? 'Saving…' : 'Save draft'}
              </Button>
            </>
          )}
          {!loaded && saveState === 'error' && (
            <Button variant="outline" onClick={actions.reload}>
              Try again
            </Button>
          )}
          {loaded && saveState === 'error' && !locked && (
            <Button variant="ghost" disabled={!!busy} onClick={actions.reload}>
              Reopen saved draft
            </Button>
          )}
          {loaded && !context && !contextBusy && !locked && (
            <Button variant="ghost" onClick={actions.loadRecipients}>
              Retry recipients
            </Button>
          )}
        </div>
        {!locked && (
          <span className={styles.status} role="status">
            {loading
              ? 'Opening draft…'
              : saveState === 'saving'
                ? 'Saving draft…'
                : saveState === 'unsaved'
                  ? 'Saving changes…'
                  : saveState === 'error'
                    ? 'Draft not saved'
                    : draft
                      ? 'Draft saved'
                      : 'Saves as you type'}
          </span>
        )}
      </div>
      {demo && !locked && (
        <p className={styles.notice}>Demo only. Drafts last for this tab; no email is sent.</p>
      )}
    </section>
  );
}
