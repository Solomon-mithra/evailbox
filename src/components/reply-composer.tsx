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
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDemo, useTrustedUser } from './providers';
import { useWorkspaceSelection } from './workspace-selection';
import { api, RequestError } from '@/lib/api';
import { workspacePath } from '@/lib/workspace-selection';
import { readDemo } from '@/lib/demo';
import {
  beginDemoReplyDraft,
  getDemoReplyDraft,
  saveDemoReplyDraft,
  sendDemoReplyDraft,
} from '@/lib/reply-demo';
import { replyDraftQuery } from '@/lib/email-preload';
import { ReplyEditor, type ReplyEditorState } from './reply-editor';
import type { ReplyDraftDTO, ReplyDraftResult } from '@/lib/mail-actions';
import type { ReplyMode } from '@/lib/providers/actions';
import type { Email } from '@/types';
export interface ReplyComposerHandle {
  save(): Promise<boolean>;
}
export function ReplyComposer({
  email,
  initialMode = 'reply',
  onSent,
  onSaved,
  ref,
}: {
  email: Pick<Email, 'id' | 'accountId' | 'subject' | 'sender'>;
  initialMode?: ReplyMode;
  onSent?: () => void;
  onSaved?: () => void;
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
  const [staleDraft, setStaleDraft] = useState(false);
  const [busy, setBusy] = useState<ReplyEditorState['busy']>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [recipients, setRecipients] = useState<Pick<ReplyDraftResult, 'context' | 'notice'>>({
    context: null,
    notice: null,
  });
  const contextRequest = useRef(0);
  const loadRequest = useRef(0);
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
  const userId = user?.id ?? '';
  const updateDraft = useCallback(
    (value: ReplyDraftDTO | null, previousId?: string) => {
      draftRef.current = value;
      if (mounted.current) setDraft(value);
      if (!demo)
        client.setQueryData(replyDraftQuery({ userId, workspace }, email.id).queryKey, (cached) => {
          if (!cached) return undefined;
          // Late send responses cannot replace a newer reply identity.
          if (
            cached.draft &&
            value &&
            cached.draft.id !== value.id &&
            cached.draft.id !== previousId
          )
            return cached;
          return { ...cached, draft: value };
        });
      if (value?.status === 'accepted') {
        const key = demo ? ['demo', workspace, 'drafts'] : ['private', userId, workspace, 'drafts'];
        client.setQueryData<Array<{ id: string }>>(key, (rows) =>
          rows?.filter((row) => row.id !== value.id),
        );
      }
    },
    [client, demo, email.id, userId, workspace],
  );
  const refreshDrafts = useCallback(() => {
    void client.invalidateQueries({
      queryKey: demo ? ['demo', workspace, 'drafts'] : ['private', userId, workspace, 'drafts'],
    });
  }, [client, demo, workspace, userId]);
  const read = useCallback(
    (force = false) => {
      if (demo)
        return Promise.resolve(
          getDemoReplyDraft(workspace, message, demoFrom, undefined, demoProvider),
        );
      const options = replyDraftQuery({ userId, workspace }, email.id);
      return client.fetchQuery({ ...options, ...(force ? { staleTime: 0 } : {}) });
    },
    [client, demo, workspace, userId, email.id, message, demoFrom, demoProvider],
  );
  const loadRecipients = useCallback(
    async (requestedMode: ReplyMode) => {
      const request = ++contextRequest.current;
      setContextBusy(true);
      setRecipients({ context: null, notice: null });
      try {
        const value = demo
          ? getDemoReplyDraft(workspace, message, demoFrom, requestedMode, demoProvider)
          : await api.get<Pick<ReplyDraftResult, 'context' | 'notice'>>(
              workspacePath(`${base}/draft?context=1&mode=${requestedMode}`, workspace),
            );
        if (mounted.current && request === contextRequest.current) setRecipients(value);
      } catch (error) {
        if (mounted.current && request === contextRequest.current)
          setRecipients({ context: null, notice: (error as Error).message });
      } finally {
        if (mounted.current && request === contextRequest.current) setContextBusy(false);
      }
    },
    [demo, workspace, message, demoFrom, demoProvider, base],
  );
  const load = useCallback(
    async (force = false) => {
      const request = ++loadRequest.current;
      setSaveState('loading');
      setError('');
      try {
        if (force && inflight.current) {
          await inflight.current.catch(() => {});
          if (!mounted.current || request !== loadRequest.current) return;
          setSaveState('loading');
        }
        const value = await read(force);
        if (!mounted.current || request !== loadRequest.current) return;
        const selectedMode = value.draft?.mode ?? initialMode;
        setResult(value);
        setStaleDraft(false);
        updateDraft(value.draft);
        setBody(value.draft?.body ?? '');
        bodyRef.current = value.draft?.body ?? '';
        setMode(selectedMode);
        modeRef.current = selectedMode;
        setSaveState('saved');
        if (!value.draft || value.draft.status === 'editing') void loadRecipients(selectedMode);
      } catch (e) {
        if (mounted.current && request === loadRequest.current) {
          setError((e as Error).message);
          setSaveState('error');
        }
      }
    },
    [read, initialMode, updateDraft, loadRecipients],
  );
  useEffect(() => {
    mounted.current = true;
    void load();
    const requests = { load: loadRequest, context: contextRequest };
    return () => {
      mounted.current = false;
      ++requests.load.current;
      ++requests.context.current;
    };
  }, [load]);
  const save = useCallback(async (): Promise<ReplyDraftDTO | null> => {
    while (inflight.current) await inflight.current;
    const current = draftRef.current;
    if (current && current.status !== 'editing') return current;
    if (
      (!current && !bodyRef.current.trim()) ||
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
      ? Promise.resolve().then(() =>
          saveDemoReplyDraft(
            workspace,
            message,
            demoFrom,
            {
              body: nextBody,
              mode: nextMode,
              revision: current?.revision ?? null,
              ...(current ? { draftId: current.id } : {}),
            },
            demoProvider,
          ),
        )
      : api.patch<ReplyDraftDTO>(workspacePath(`${base}/draft`, workspace), {
          body: nextBody,
          mode: nextMode,
          revision: current?.revision ?? null,
          ...(current ? { draftId: current.id } : {}),
        });
    inflight.current = request;
    try {
      const saved = await request;
      updateDraft(saved);
      refreshDrafts();
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
  }, [demo, workspace, message, demoFrom, demoProvider, base, updateDraft, refreshDrafts]);
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
        setBusy('save');
        try {
          return await flush();
        } finally {
          if (mounted.current) setBusy(null);
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
  const changeMode = (next: ReplyMode) => {
    modeRef.current = next;
    setMode(next);
    setSaveState('unsaved');
    void loadRecipients(next);
  };
  const saveAndClose = async () => {
    if (busy || !result) return;
    setBusy('save');
    try {
      if (!(await flush())) return;
      refreshDrafts();
      if (mounted.current) {
        toast.success(demo ? 'Demo draft saved for this tab.' : 'Draft saved');
        onSaved?.();
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  };
  const newReply = async () => {
    const previous = draftRef.current;
    if (busy || previous?.status !== 'accepted') return;
    setBusy('new');
    setError('');
    try {
      const input = { draftId: previous.id, revision: previous.revision, mode: modeRef.current };
      const next = demo
        ? beginDemoReplyDraft(workspace, email.id, input)
        : await api.post<ReplyDraftDTO>(workspacePath(`${base}/draft`, workspace), {
            intent: 'new',
            ...input,
          });
      updateDraft(next, previous.id);
      refreshDrafts();
      if (!mounted.current) return;
      bodyRef.current = next.body;
      setBody(next.body);
      modeRef.current = next.mode;
      setMode(next.mode);
      setSaveState('saved');
      void loadRecipients(next.mode);
    } catch (error) {
      if (mounted.current) setError((error as Error).message);
    } finally {
      if (mounted.current) setBusy(null);
    }
  };
  const send = async () => {
    if (
      busy ||
      !result ||
      contextBusy ||
      !recipients.context ||
      (draftRef.current?.status && draftRef.current.status !== 'editing')
    )
      return;
    setBusy('send');
    setError('');
    let attempted: ReplyDraftDTO | null = null;
    try {
      if (!(await flush())) return;
      const saved = draftRef.current;
      if (!saved) throw new Error('Write a reply before sending.');
      attempted = saved;
      updateDraft({ ...saved, status: 'sending' });
      const sent = demo
        ? sendDemoReplyDraft(workspace, email.id, { draftId: saved.id, revision: saved.revision })
        : await api.post<ReplyDraftDTO>(workspacePath(`${base}/reply`, workspace), {
            intent: 'send',
            draftId: saved.id,
            revision: saved.revision,
          });
      updateDraft(sent);
      if (sent.status === 'accepted' && mounted.current) {
        toast.success(demo ? 'Demo complete — no email sent.' : 'Reply sent');
        onSent?.();
      }
      refreshDrafts();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      // A lost browser response cannot imply a failed send. Re-read before enabling any further action.
      if (!demo) {
        try {
          const value = await read(true);
          if (
            attempted &&
            (!value.draft ||
              value.draft.id !== attempted.id ||
              (value.draft.status === 'editing' &&
                (value.draft.body !== attempted.body || value.draft.mode !== attempted.mode)))
          ) {
            if (mounted.current) {
              draftRef.current = { ...attempted, status: 'unknown' };
              setDraft(draftRef.current);
              setStaleDraft(true);
              setError('This conversation has a newer draft. Open the current draft to continue.');
            }
            return;
          }
          if (mounted.current) setResult(value);
          updateDraft(value.draft);
          if (value.draft?.status === 'accepted' && mounted.current) {
            setError('');
            onSent?.();
          }
          refreshDrafts();
        } catch {
          if (draftRef.current) updateDraft({ ...draftRef.current, status: 'unknown' });
        }
      }
      if (mounted.current && e instanceof RequestError && e.code === 'RECONNECT_REQUIRED')
        setError(e.message);
    } finally {
      if (mounted.current) setBusy(null);
    }
  };
  const reconcile = async () => {
    const expected = draftRef.current;
    if (busy || !expected) return;
    setBusy('reconcile');
    setError('');
    try {
      const reconciled = await api.post<ReplyDraftDTO>(workspacePath(`${base}/reply`, workspace), {
        intent: 'reconcile',
        draftId: expected.id,
      });
      if (
        reconciled.id !== expected.id ||
        (reconciled.status === 'editing' &&
          (reconciled.body !== expected.body || reconciled.mode !== expected.mode))
      ) {
        if (mounted.current) {
          setStaleDraft(true);
          setError('This conversation has a newer draft. Open the current draft to continue.');
        }
        return;
      }
      updateDraft(reconciled);
      if (reconciled.status === 'accepted' && mounted.current) onSent?.();
      refreshDrafts();
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        if (e instanceof RequestError && ['DRAFT_CONFLICT', 'NOT_FOUND'].includes(e.code))
          setStaleDraft(true);
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  };
  return (
    <ReplyEditor
      state={{
        emailId: email.id,
        body,
        mode,
        draft,
        accountEmail: result?.account.email ?? '',
        context: recipients.context,
        contextBusy,
        loaded: !!result,
        saveState,
        busy,
        error,
        notice: recipients.notice,
        demo,
        staleDraft,
      }}
      actions={{
        changeBody: (value) => {
          bodyRef.current = value;
          setBody(value);
          setSaveState('unsaved');
        },
        changeMode,
        save: () => void saveAndClose(),
        send: () => void send(),
        newReply: () => void newReply(),
        reconcile: () => void reconcile(),
        reload: () => void load(true),
        loadRecipients: () => void loadRecipients(modeRef.current),
      }}
    />
  );
}
