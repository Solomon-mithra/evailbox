'use client';
import { useRef, useState } from 'react';
import { ExternalLink, Check, Undo2, Sparkles, Reply, ReplyAll, Mail, Archive } from 'lucide-react';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import type { Email } from '@/types';
import { useAction } from '@/hooks/useFetch';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { useDemo, usePrivateCache } from './providers';
import { emailContentQuery, emailDetailQuery } from '@/lib/email-preload';
import { ReplyComposer, type ReplyComposerHandle } from './reply-composer';
import type { ReplyMode } from '@/lib/providers/actions';
import { useWorkspaceSelection } from './workspace-selection';
import type { WorkspaceId } from '@/lib/workspace-selection';

function MessageBody({ email, workspace }: { email: Email; workspace: WorkspaceId }) {
  const { user, ready } = usePrivateCache();
  const [images, setImages] = useState(true);
  const content = useQuery({
    ...emailContentQuery({ userId: user?.id ?? '', workspace }, email.id, images),
    enabled: !!user && ready,
  });
  return (
    <section className="email-message" aria-label="Message content">
      <div className="email-reader-toolbar">
        <span>
          {content.isError && !content.data
            ? 'Message unavailable.'
            : !content.data
              ? 'Loading message…'
              : images
                ? 'Images enabled'
                : 'Images hidden'}
        </span>
        <button type="button" className="email-image-toggle" onClick={() => setImages(!images)}>
          {images ? 'Hide images' : 'Load images'}
        </button>
      </div>
      {content.data ? (
        <iframe
          key={String(images)}
          className="email-message-frame"
          title="Email message"
          srcDoc={content.data.html}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="email-message-placeholder" role="status">
          {content.isError ? (
            <Button variant="outline" onClick={() => void content.refetch()}>
              Try again
            </Button>
          ) : (
            'Loading message…'
          )}
        </div>
      )}
    </section>
  );
}
export function EmailDetail({
  email: selected,
  onClose,
}: {
  email: Email | null;
  onClose: () => void;
}) {
  const { workspace } = useWorkspaceSelection();
  const mutation = useAction(),
    demo = useDemo();
  const { user, ready } = usePrivateCache();
  const detail = useQuery({
    ...emailDetailQuery({ userId: user?.id ?? '', workspace }, selected?.id ?? ''),
    enabled: !!user && ready && !!selected && !demo,
  });
  const source = detail.data ?? selected;
  const [readState, setReadState] = useState<{ id: string; isRead: boolean } | null>(null);
  const email =
    source && readState?.id === source.id ? { ...source, isRead: readState.isRead } : source;
  const [reply, setReply] = useState<{ emailId: string; mode: ReplyMode } | null>(null);
  const composer = useRef<ReplyComposerHandle>(null);
  const close = async () => {
    if (composer.current && !(await composer.current.save())) {
      toast.error('Your draft could not be saved. Keep this window open and retry.');
      return;
    }
    setReply(null);
    setReadState(null);
    onClose();
  };
  const changeMessage = async (action: 'read' | 'unread' | 'archive') => {
    if (composer.current && !(await composer.current.save())) return;
    try {
      await mutation.mutateAsync({ path: `/api/emails/${email!.id}/actions`, body: { action } });
      if (action !== 'archive') setReadState({ id: email!.id, isRead: action === 'read' });
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
  };
  return (
    <Dialog
      open={!!email}
      onOpenChange={(v) => {
        if (!v) void close();
      }}
      title={email?.subject ?? 'Email'}
      description={email ? `From ${email.sender}` : undefined}
      wide
      className="email-reader"
    >
      {email && (
        <>
          <div className="email-meta">
            <span>{email.senderName}</span>
            <time dateTime={email.receivedAt}>{new Date(email.receivedAt).toLocaleString()}</time>
          </div>
          {demo ? (
            <div className="email-body">{email.body || email.snippet}</div>
          ) : (
            <MessageBody key={`${workspace}:${email.id}`} email={email} workspace={workspace} />
          )}
          <div className="dialog-actions wrap">
            <Button
              variant="outline"
              disabled={reply?.emailId === email.id}
              onClick={() => setReply({ emailId: email.id, mode: 'reply' })}
            >
              <Reply size={15} />
              Reply
            </Button>
            <Button
              variant="ghost"
              disabled={reply?.emailId === email.id}
              onClick={() => setReply({ emailId: email.id, mode: 'reply-all' })}
            >
              <ReplyAll size={15} />
              Reply all
            </Button>
            <Button
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => void changeMessage(email.isRead ? 'unread' : 'read')}
            >
              <Mail size={15} />
              {email.isRead ? 'Mark unread' : 'Mark read'}
            </Button>
            <Button
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => void changeMessage('archive')}
            >
              <Archive size={15} />
              Archive
            </Button>
          </div>
          {reply?.emailId === email.id && (
            <ReplyComposer
              key={`${workspace}:${email.id}`}
              ref={composer}
              email={email}
              initialMode={reply.mode}
            />
          )}
          <div className="dialog-actions wrap">
            <Button
              variant="ghost"
              disabled={mutation.isPending}
              onClick={async () => {
                try {
                  const result = await mutation.mutateAsync({
                    path: '/api/classify',
                    body: { emailId: email.id },
                  });
                  if (result.errors) toast.error('Some classifications failed. Try again.');
                  else toast.success('Classification complete');
                  await close();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <Sparkles size={16} />
              Classify
            </Button>
            <Button variant="outline" asChild>
              <a href={email.webUrl} target="_blank" rel="noreferrer">
                Open in provider
                <ExternalLink size={15} />
              </a>
            </Button>
            <Button
              disabled={mutation.isPending}
              onClick={async () => {
                try {
                  await mutation.mutateAsync({
                    path: `/api/emails/${email.id}`,
                    method: 'PATCH',
                    body: { handled: !email.handled },
                  });
                  toast.success(email.handled ? 'Moved back to your inbox' : 'Marked as handled');
                  await close();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              {email.handled ? <Undo2 size={16} /> : <Check size={16} />}{' '}
              {email.handled ? 'Mark unhandled' : 'Mark as handled'}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
