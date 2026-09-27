'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  ListChecks,
  ListTodo,
  Sparkles,
  Reply,
  ReplyAll,
  Mail,
  Archive,
  MoreHorizontal,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Button } from './ui/button';
import type { Email } from '@/types';
import { useAction } from '@/hooks/useFetch';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDemo, usePrivateCache } from './providers';
import {
  emailContentQuery,
  emailDetailQuery,
  emailThreadQuery,
  emailThreadNeedsRefresh,
  preloadReplyDraft,
} from '@/lib/email-preload';
import { ReplyComposer, type ReplyComposerHandle } from './reply-composer';
import { EmailMessageFrame } from './email-message-frame';
import { useReaderNavigation } from './reader-navigation';
import type { ReplyMode } from '@/lib/providers/actions';
import { useWorkspaceSelection } from './workspace-selection';
import type { WorkspaceId } from '@/lib/workspace-selection';

function MessageHeader({
  message,
}: {
  message: Pick<Email, 'sender' | 'senderName' | 'receivedAt'>;
}) {
  return (
    <header className="email-thread-header">
      <span className="sender-avatar" aria-hidden="true">
        {(message.senderName || message.sender)
          .split(' ')
          .slice(0, 2)
          .map((name) => name[0])
          .join('')}
      </span>
      <div className="email-thread-sender">
        <strong>{message.senderName || message.sender}</strong>
        {message.senderName && <span>{message.sender}</span>}
      </div>
      <time dateTime={message.receivedAt}>
        {new Date(message.receivedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
      </time>
    </header>
  );
}

function MessageBody({
  email,
  workspace,
  images,
}: {
  email: Email;
  workspace: WorkspaceId;
  images: boolean;
}) {
  const { user, ready } = usePrivateCache();
  const content = useQuery({
    ...emailContentQuery({ userId: user?.id ?? '', workspace }, email.id, images),
    enabled: !!user && ready,
  });
  return content.data ? (
    <EmailMessageFrame html={content.data.html} />
  ) : (
    <div className="email-message-placeholder" role="status">
      {content.isError ? (
        <>
          <p>This message couldn’t load.</p>
          <Button variant="outline" onClick={() => void content.refetch()}>
            Try again
          </Button>
        </>
      ) : (
        'Loading message…'
      )}
    </div>
  );
}

export function EmailDetail({
  email: selected,
  onClose,
  backLabel = 'Back to inbox',
}: {
  email: Email;
  onClose: () => void;
  backLabel?: string;
}) {
  const { workspace } = useWorkspaceSelection();
  const { register } = useReaderNavigation();
  const client = useQueryClient();
  const mutation = useAction(),
    demo = useDemo();
  const { user, ready } = usePrivateCache();
  const [images, setImages] = useState(true);
  const detail = useQuery({
    ...emailDetailQuery({ userId: user?.id ?? '', workspace }, selected.id),
    enabled: !!user && ready && !demo,
  });
  const thread = useQuery({
    ...emailThreadQuery({ userId: user?.id ?? '', workspace }, selected.id, images),
    enabled: !!user && ready && !demo,
  });
  const refreshThread = thread.refetch;
  useEffect(() => {
    if (!user?.id || !ready || demo) return;
    const scope = { userId: user.id, workspace };
    const state = client.getQueryState(emailThreadQuery(scope, selected.id, images).queryKey);
    if (emailThreadNeedsRefresh(state?.data, state?.dataUpdatedAt ?? 0))
      void refreshThread({ cancelRefetch: false });
    void preloadReplyDraft(client, scope, selected.id);
  }, [client, refreshThread, user?.id, ready, demo, workspace, selected.id, images]);
  const source = detail.data ?? selected;
  const [readState, setReadState] = useState<{ id: string; isRead: boolean } | null>(null);
  const email = readState?.id === source.id ? { ...source, isRead: readState.isRead } : source;
  const [reply, setReply] = useState<ReplyMode | null>(null);
  const composer = useRef<ReplyComposerHandle>(null);
  const close = useCallback(async () => {
    if (composer.current && !(await composer.current.save())) {
      toast.error('Your draft could not be saved. Please retry before leaving.');
      return false;
    }
    onClose();
    return true;
  }, [onClose]);

  useEffect(() => register(close), [register, close]);

  async function changeMessage(action: 'read' | 'unread' | 'archive') {
    if (composer.current && !(await composer.current.save())) return;
    try {
      await mutation.mutateAsync({ path: `/api/emails/${email.id}/actions`, body: { action } });
      if (action !== 'archive') setReadState({ id: email.id, isRead: action === 'read' });
      toast.success(
        demo
          ? 'Demo mailbox updated. No provider was contacted.'
          : action === 'archive'
            ? 'Archived in your mailbox'
            : action === 'read'
              ? 'Marked as read in your mailbox'
              : 'Marked as unread in your mailbox',
      );
      if (action === 'archive') await close();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  async function markHandled() {
    if (composer.current && !(await composer.current.save())) return;
    try {
      await mutation.mutateAsync({
        path: `/api/emails/${email.id}`,
        method: 'PATCH',
        body: { handled: !email.handled },
      });
      toast.success(email.handled ? 'Moved back to your inbox' : 'Marked as handled');
      await close();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  async function classify() {
    if (composer.current && !(await composer.current.save())) return;
    try {
      const result = await mutation.mutateAsync({
        path: '/api/classify',
        body: { emailId: email.id },
      });
      if (result.errors) toast.error('Some classifications failed. Try again.');
      else toast.success('Classification complete');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  const messages = thread.data?.messages;
  const replyControls = reply ? (
    <ReplyComposer
      key={`${workspace}:${email.id}`}
      ref={composer}
      email={email}
      initialMode={reply}
      onSaved={() => {
        setReply(null);
        requestAnimationFrame(() =>
          document.querySelector<HTMLButtonElement>('.email-reply-actions button')?.focus(),
        );
      }}
      onSent={() => {
        if (!demo) void refreshThread();
      }}
    />
  ) : (
    <div className="email-reply-actions">
      <Button
        variant="outline"
        aria-label={`Reply to ${email.senderName || email.sender}`}
        onClick={() => setReply('reply')}
      >
        <Reply size={16} />
        Reply
      </Button>
      <Button
        variant="ghost"
        aria-label={`Reply all to message from ${email.senderName || email.sender}`}
        onClick={() => setReply('reply-all')}
      >
        <ReplyAll size={16} />
        Reply all
      </Button>
    </div>
  );
  return (
    <section className="email-reader" aria-labelledby="email-reader-title">
      <div className="email-reader-actions">
        <Button
          className="email-reader-back"
          variant="ghost"
          aria-label={backLabel}
          onClick={() => void close()}
        >
          <ArrowLeft size={18} />
          <span>Back</span>
        </Button>
        <div className="email-reader-mail-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Archive"
            title="Archive"
            disabled={mutation.isPending}
            onClick={() => void changeMessage('archive')}
          >
            <Archive size={18} />
          </Button>
          <Button
            variant="outline"
            className="email-handled-action"
            aria-label={email.handled ? 'Reopen email' : 'Mark handled'}
            title={
              email.handled
                ? 'Mark this email as needing attention again'
                : 'Mark this email as handled'
            }
            disabled={mutation.isPending}
            onClick={() => void markHandled()}
          >
            {email.handled ? <ListTodo size={18} /> : <ListChecks size={18} />}
            {email.handled ? 'Reopen' : 'Mark handled'}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="icon-button" aria-label="More email actions">
              <MoreHorizontal size={19} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="dropdown-content" align="end">
                <DropdownMenu.Item
                  disabled={mutation.isPending}
                  onSelect={() => void changeMessage(email.isRead ? 'unread' : 'read')}
                >
                  <Mail size={16} />
                  {email.isRead ? 'Mark unread' : 'Mark read'}
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild>
                  <a href={email.webUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} />
                    Open in provider
                  </a>
                </DropdownMenu.Item>
                <DropdownMenu.Item disabled={mutation.isPending} onSelect={() => void classify()}>
                  <Sparkles size={16} />
                  Classify
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      <div className="email-reader-content">
        <h1 id="email-reader-title" className="email-reader-title" tabIndex={-1}>
          {email.subject || '(No subject)'}
        </h1>
        <div className="email-conversation-meta">
          <span>
            {messages && messages.length > 1 ? `${messages.length} messages` : 'Conversation'}
          </span>
          {!demo && (
            <button
              type="button"
              className="email-image-toggle"
              onClick={() => setImages((value) => !value)}
            >
              {images ? 'Hide images' : 'Load images'}
            </button>
          )}
        </div>
        <div className="email-conversation" aria-label="Email conversation">
          {messages?.length ? (
            messages.map((message) => (
              <article
                key={message.current ? `selected:${email.id}` : `thread:${message.id}`}
                className="email-thread-message"
              >
                <MessageHeader message={message} />
                {message.current && message.fallback ? (
                  <MessageBody email={email} workspace={workspace} images={images} />
                ) : (
                  <EmailMessageFrame
                    html={message.html}
                    title={`Message from ${message.senderName || message.sender}`}
                  />
                )}
                {message.current && replyControls}
              </article>
            ))
          ) : (
            <article key={`selected:${email.id}`} className="email-thread-message">
              <MessageHeader message={email} />
              {demo ? (
                <div className="email-body">{email.body || email.snippet}</div>
              ) : (
                <MessageBody email={email} workspace={workspace} images={images} />
              )}
              {replyControls}
            </article>
          )}
        </div>
        {!demo && !thread.data && (
          <p className="email-thread-status" role="status">
            {thread.isError ? (
              <>
                Earlier replies couldn’t load.{' '}
                <button className="text-link" onClick={() => void thread.refetch()}>
                  Try again
                </button>
              </>
            ) : (
              'Loading conversation…'
            )}
          </p>
        )}
        {thread.data?.partial && (
          <p className="email-thread-status" role="status">
            Some messages are unavailable.{' '}
            <button className="text-link" onClick={() => void thread.refetch()}>
              Try again
            </button>
            <a href={email.webUrl} target="_blank" rel="noreferrer">
              View the full conversation in your mailbox
            </a>
            .
          </p>
        )}
      </div>
    </section>
  );
}
