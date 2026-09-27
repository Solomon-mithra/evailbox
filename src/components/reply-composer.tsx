'use client';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { Send, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { useDemo, useTrustedUser } from './providers';
import { useWorkspaceSelection } from './workspace-selection';
import { api, RequestError } from '@/lib/api';
import { workspacePath } from '@/lib/workspace-selection';
import { readDemo } from '@/lib/demo';
import { getDemoReplyDraft, saveDemoReplyDraft, sendDemoReplyDraft } from '@/lib/reply-demo';
import type { ReplyDraftDTO, ReplyDraftResult } from '@/lib/mail-actions';
import type { ReplyMode } from '@/lib/providers/actions';
import type { Email } from '@/types';
import styles from './reply-composer.module.css';
export interface ReplyComposerHandle {
  save(): Promise<boolean>;
}
export function ReplyComposer({
  email,
  initialMode = 'reply',
  onSent,
  ref,
}: {
  email: Pick<Email, 'id' | 'accountId' | 'subject' | 'sender'>;
  initialMode?: ReplyMode;
  onSent?: () => void;
  ref?: Ref<ReplyComposerHandle>;
}) {
  const demo = useDemo(),
    user = useTrustedUser(),
    client = useQueryClient();
  const { workspace } = useWorkspaceSelection();
  const [result, setResult] = useState<ReplyDraftResult | null>(null);
  const [draft, setDraft] = useState<ReplyDraftDTO | null>(null);
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<ReplyMode>(initialMode);
  const [saveState, setSaveState] = useState<'loading' | 'saved' | 'unsaved' | 'saving' | 'error'>(
    'loading',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const draftRef = useRef<ReplyDraftDTO | null>(null),
    bodyRef = useRef(''),
    modeRef = useRef<ReplyMode>(initialMode);
  const inflight = useRef<Promise<ReplyDraftDTO | null> | null>(null),
    mounted = useRef(true);
  const demoFrom = useMemo(
    () =>
      demo
        ? (readDemo(workspace).accounts.find((a) => a.id === email.accountId)?.email ??
          'alex@example.com')
        : '',
    [demo, workspace, email.accountId],
  );
  const demoProvider = useMemo(
    () =>
      demo
        ? (readDemo(workspace).accounts.find((a) => a.id === email.accountId)?.provider ?? 'GMAIL')
        : 'GMAIL',
    [demo, workspace, email.accountId],
  );
  const message = useMemo(
    () => ({
      id: email.id,
      accountId: email.accountId,
      subject: email.subject,
      sender: email.sender,
    }),
    [email.id, email.accountId, email.subject, email.sender],
  );
  const base = `/api/emails/${encodeURIComponent(email.id)}`;
  const updateDraft = useCallback((value: ReplyDraftDTO | null) => {
    draftRef.current = value;
    if (mounted.current) setDraft(value);
  }, []);
  const read = useCallback(
    (requestedMode?: ReplyMode) =>
      demo
        ? Promise.resolve(
            getDemoReplyDraft(workspace, message, demoFrom, requestedMode, demoProvider),
          )
        : api.get<ReplyDraftResult>(
            workspacePath(
              `${base}/draft${requestedMode ? `?mode=${requestedMode}` : ''}`,
              workspace,
            ),
          ),
    [demo, workspace, message, demoFrom, demoProvider, base],
  );
  const load = useCallback(async () => {
    setSaveState('loading');
    setError('');
    try {
      let value = await read();
      const selectedMode = value.draft?.mode ?? initialMode;
      if (selectedMode !== (value.draft?.mode ?? 'reply')) value = await read(selectedMode);
      if (!mounted.current) return;
      setResult(value);
      updateDraft(value.draft);
      setBody(value.draft?.body ?? '');
      bodyRef.current = value.draft?.body ?? '';
      setMode(selectedMode);
      modeRef.current = selectedMode;
      setSaveState('saved');
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setSaveState('error');
      }
    }
  }, [read, initialMode, updateDraft]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  const save = useCallback(async (): Promise<ReplyDraftDTO | null> => {
    while (inflight.current) await inflight.current;
    const current = draftRef.current;
    if (current && current.status !== 'editing') return current;
    if (
      (!current && !bodyRef.current) ||
      (current?.body === bodyRef.current && current.mode === modeRef.current)
    )
      return current;
    const nextBody = bodyRef.current,
      nextMode = modeRef.current;
    if (mounted.current) {
      setSaveState('saving');
      setError('');
    }
    const request = demo
      ? Promise.resolve(
          saveDemoReplyDraft(
            workspace,
            message,
            demoFrom,
            { body: nextBody, mode: nextMode },
            demoProvider,
          ),
        )
      : api.patch<ReplyDraftDTO>(workspacePath(`${base}/draft`, workspace), {
          body: nextBody,
          mode: nextMode,
          revision: current?.revision ?? null,
        });
    inflight.current = request;
    try {
      const saved = await request;
      updateDraft(saved);
      if (mounted.current)
        setSaveState(
          bodyRef.current === saved.body && modeRef.current === saved.mode ? 'saved' : 'unsaved',
        );
      return saved;
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setSaveState('error');
      }
      throw e;
    } finally {
      if (inflight.current === request) inflight.current = null;
    }
  }, [demo, workspace, message, demoFrom, demoProvider, base, updateDraft]);
  const flush = useCallback(async () => {
    try {
      await save();
      while (
        draftRef.current?.status === 'editing' &&
        (draftRef.current.body !== bodyRef.current || draftRef.current.mode !== modeRef.current)
      )
        await save();
      return true;
    } catch {
      return false;
    }
  }, [save]);
  useImperativeHandle(
    ref,
    () => ({
      save: async () => {
        // Freeze editing while a parent closes/archives so the last typed characters cannot be lost.
        setBusy(true);
        try {
          return await flush();
        } finally {
          if (mounted.current) setBusy(false);
        }
      },
    }),
    [flush],
  );
  useEffect(() => {
    if (saveState !== 'unsaved') return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 650);
    return () => clearTimeout(timer);
  }, [body, mode, saveState, save]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (['unsaved', 'saving', 'error'].includes(saveState) && bodyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);
  const changeMode = async (next: ReplyMode) => {
    modeRef.current = next;
    setMode(next);
    setSaveState('unsaved');
    setContextBusy(true);
    try {
      const value = await read(next);
      if (mounted.current) setResult(value);
    } catch (e) {
      setError((e as Error).message);
      setResult((value) => (value ? { ...value, context: null } : value));
    } finally {
      setContextBusy(false);
    }
  };
  const send = async () => {
    setBusy(true);
    setError('');
    try {
      if (!(await flush())) return;
      const saved = draftRef.current;
      if (!saved) throw new Error('Write a reply before sending.');
      const sent = demo
        ? sendDemoReplyDraft(workspace, email.id)
        : await api.post<ReplyDraftDTO>(workspacePath(`${base}/reply`, workspace), {
            intent: 'send',
            draftId: saved.id,
            revision: saved.revision,
          });
      updateDraft(sent);
      if (sent.status === 'accepted') {
        toast.success(
          demo ? 'Demo complete — no email sent.' : 'Your provider accepted the reply.',
        );
        onSent?.();
      }
      await client.invalidateQueries({ queryKey: ['private', user?.id, workspace] });
    } catch (e) {
      setError((e as Error).message);
      // A lost browser response cannot imply a failed send. Re-read before enabling any further action.
      if (!demo) {
        try {
          const value = await read();
          setResult(value);
          updateDraft(value.draft);
          if (value.draft?.status === 'accepted') onSent?.();
        } catch {
          if (draftRef.current) updateDraft({ ...draftRef.current, status: 'unknown' });
        }
      }
      if (e instanceof RequestError && e.code === 'RECONNECT_REQUIRED') setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const reconcile = async () => {
    setBusy(true);
    setError('');
    try {
      const reconciled = await api.post<ReplyDraftDTO>(workspacePath(`${base}/reply`, workspace), {
        intent: 'reconcile',
      });
      updateDraft(reconciled);
      if (reconciled.status === 'accepted') onSent?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const locked = !!draft && draft.status !== 'editing';
  const context = result?.context;
  return (
    <section className={styles.composer} aria-label="Reply composer">
      <div className={styles.heading}>
        <h3>{draft?.status === 'accepted' ? 'Reply accepted' : 'Your reply'}</h3>
        <label>
          <span className="sr-only">Reply recipients</span>
          <select
            value={mode}
            disabled={busy || locked || contextBusy || saveState === 'loading'}
            onChange={(e) => void changeMode(e.target.value as ReplyMode)}
          >
            <option value="reply">Reply</option>
            <option value="reply-all">Reply all</option>
          </select>
        </label>
      </div>
      {result && (
        <dl className={styles.recipients}>
          <dt>From</dt>
          <dd>
            {result.account.email} · connected{' '}
            {result.account.provider === 'GMAIL' ? 'Gmail' : 'Outlook'} account
          </dd>
          <dt>To</dt>
          <dd>
            {contextBusy
              ? 'Loading recipients…'
              : (context?.to.join(', ') ?? 'Recipients unavailable')}
          </dd>
          {!!context?.cc.length && (
            <>
              <dt>Cc</dt>
              <dd>{context.cc.join(', ')}</dd>
            </>
          )}
        </dl>
      )}
      {result?.notice && <p className={styles.notice}>{result.notice}</p>}
      <label htmlFor={`reply-${email.id}`} className="sr-only">
        Reply message
      </label>
      <textarea
        id={`reply-${email.id}`}
        className={styles.body}
        value={body}
        maxLength={16000}
        placeholder="Write your reply…"
        disabled={busy || locked || saveState === 'loading' || !result}
        onChange={(e) => {
          bodyRef.current = e.target.value;
          setBody(e.target.value);
          setSaveState('unsaved');
        }}
      />
      {error && (
        <p role="alert" className={`${styles.notice} ${styles.error}`}>
          {error} <a href="/accounts">Manage or reconnect account</a>
        </p>
      )}
      {draft?.lastError && (
        <p role="status" className={styles.notice}>
          {draft.lastError}
        </p>
      )}
      {draft?.status === 'accepted' && (
        <p role="status" className={styles.notice}>
          {demo
            ? 'Demo complete. No email was sent.'
            : 'Your email provider accepted this reply for sending. Recipient delivery is not confirmed.'}
        </p>
      )}
      <div className={styles.footer}>
        <span className={styles.status} role="status">
          {saveState === 'loading'
            ? 'Opening draft…'
            : saveState === 'saving'
              ? 'Saving draft…'
              : saveState === 'unsaved'
                ? 'Unsaved changes'
                : saveState === 'error'
                  ? 'Draft could not be saved'
                  : demo
                    ? 'Demo draft · this tab only'
                    : draft
                      ? 'Draft saved'
                      : 'Draft saves as you type'}
        </span>
        <div className={styles.buttons}>
          {saveState === 'error' && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void flush()}>
                Retry save
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
                Reopen saved draft
              </Button>
            </>
          )}
          {result && !context && !locked && (
            <Button
              size="sm"
              variant="outline"
              disabled={contextBusy}
              onClick={() => void changeMode(mode)}
            >
              <RefreshCw size={14} />
              Load recipients
            </Button>
          )}
          {locked && draft.status !== 'accepted' && !demo ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void reconcile()}>
              <RefreshCw size={14} />
              Check send status
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={
                busy ||
                locked ||
                contextBusy ||
                !context ||
                !body.trim() ||
                saveState === 'loading' ||
                saveState === 'error'
              }
              onClick={() => void send()}
            >
              <Send size={14} />
              {busy ? 'Sending…' : demo ? 'Simulate send' : 'Send reply'}
            </Button>
          )}
        </div>
      </div>
      {!locked && (
        <p className={styles.notice}>
          Plain text reply. Attachments are not supported yet.
          {demo ? ' No email will be sent.' : ''}
        </p>
      )}
    </section>
  );
}
