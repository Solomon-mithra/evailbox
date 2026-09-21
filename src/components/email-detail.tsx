'use client';
import { ExternalLink, Check, Undo2, Sparkles, ChevronDown } from 'lucide-react';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { TagBadge } from './ui/badge';
import type { Email } from '@/types';
import { useAction } from '@/hooks/useFetch';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { useDemo } from './providers';
import { api } from '@/lib/api';
export function EmailDetail({
  email: selected,
  onClose,
}: {
  email: Email | null;
  onClose: () => void;
}) {
  const mutation = useAction(),
    demo = useDemo();
  const detail = useQuery({
    queryKey: ['email', selected?.id],
    queryFn: () => api.get<Email>(`/api/emails/${selected!.id}`),
    enabled: !!selected && !demo,
  });
  const email = detail.data ?? selected;
  return (
    <Dialog
      open={!!email}
      onOpenChange={(v) => !v && onClose()}
      title={email?.subject ?? 'Email'}
      description={email ? `From ${email.sender}` : undefined}
      wide
    >
      {email && (
        <>
          <div className="email-meta">
            <span>{email.senderName}</span>
            <time dateTime={email.receivedAt}>{new Date(email.receivedAt).toLocaleString()}</time>
          </div>
          <div className="email-body">
            {detail.isFetching && !demo ? 'Loading message…' : email.body || email.snippet}
            {detail.isError && (
              <p className="field-error">
                The full message couldn’t load. Close and reopen to retry.
              </p>
            )}
          </div>
          <details className="decision-trace" key={email.id}>
            <summary>
              <Sparkles size={16} />
              Why this was sorted here
              <ChevronDown size={16} className="expand-icon" />
            </summary>
            {email.classifications.length ? (
              email.classifications.map((c) => (
                <div className="trace-item" key={c.id}>
                  <div>
                    <TagBadge tag={c.tag} />
                    <span>
                      {Math.round(c.confidence)}% match probability · {c.decision.replace('_', ' ')}
                    </span>
                  </div>
                  <p>{c.reasoning}</p>
                </div>
              ))
            ) : (
              <p>
                No classifications yet. Run the classifier to evaluate this email against your tags.
              </p>
            )}
          </details>
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
                  onClose();
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
                Open & reply
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
                  onClose();
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
