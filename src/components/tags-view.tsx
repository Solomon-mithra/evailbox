'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, MoreHorizontal, ArrowUpRight, Tags, Sparkles, Pencil, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useWorkspace, useAction } from '@/hooks/useFetch';
import { Button } from './ui/button';
import { TagBadge } from './ui/badge';
import { Skeleton } from './ui/loader';
import { TagForm } from './tag-form';
import { ConfirmDialog } from './confirm-dialog';
import { EmailDetail } from './email-detail';
import { EmailRow } from './inbox';
import { EmptyState, ErrorState } from './states';
import type { Tag, Email } from '@/types';
import { toast } from 'sonner';
export function TagsView({ tagId }: { tagId?: string }) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const query = useWorkspace(tagId ? { tag: tagId, page } : {}),
    mutation = useAction();
  const [editing, setEditing] = useState<Tag | undefined>(),
    [formOpen, setFormOpen] = useState(false),
    [deleting, setDeleting] = useState<Tag | null>(null),
    [selected, setSelected] = useState<Email | null>(null);
  const tag = query.data?.tags.find((t) => t.id === tagId);
  async function run() {
    try {
      const r = await mutation.mutateAsync({
        path: '/api/classify/batch',
        body: tagId ? { tagId } : {},
      });
      toast[r.errors ? 'warning' : 'success'](
        r.demo
          ? 'Demo rules evaluated. No live Jev call was made.'
          : `Evaluated ${r.classified} decisions${r.remaining ? ' · run again to continue' : ''}${r.errors ? ' · some failed; retry' : ''}`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <>
      {tagId && (
        <Link href="/tags" className="back-link">
          ← All tags
        </Link>
      )}
      <div className="page-heading">
        <div>
          <h1>{tagId ? (tag?.name ?? 'Tag details') : 'Tags'}</h1>
          <p>
            {tagId ? tag?.description : 'Choose what matters. Jev finds the emails that match.'}
          </p>
        </div>
        <div className="heading-actions">
          {tagId && tag ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(tag);
                  setFormOpen(true);
                }}
              >
                <Pencil size={15} />
                Edit tag
              </Button>
              <Button variant="ghost" aria-label="Delete tag" onClick={() => setDeleting(tag)}>
                <Trash2 size={17} />
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              <Plus size={17} />
              Create tag
            </Button>
          )}
        </div>
      </div>
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : tagId ? (
        tag ? (
          <>
            <div className="tag-rule-card">
              <div>
                <TagBadge tag={tag} />
                <span className="priority-label">{tag.priority.toLowerCase()} priority</span>
              </div>
              <h3>What Jev looks for</h3>
              <p>{tag.prompt}</p>
              <div className="keyword-list">
                {[...tag.keywords, ...tag.senders].map((k) => (
                  <span key={k}>{k}</span>
                ))}
              </div>
              <div className="rule-footer">
                <span>{query.data?.total ?? 0} matching emails</span>
                <Button variant="outline" size="sm" onClick={run} disabled={mutation.isPending}>
                  <Sparkles size={15} />
                  {mutation.isPending ? 'Classifying…' : 'Run classifier'}
                </Button>
              </div>
            </div>
            <div className="email-list">
              {query.data?.emails.length ? (
                query.data.emails.map((e) => <EmailRow key={e.id} email={e} onOpen={setSelected} />)
              ) : (
                <EmptyState
                  title="No matches yet"
                  message="Run the classifier to check existing emails against this tag."
                />
              )}
            </div>
            {(query.data?.total ?? 0) > 50 && (
              <div className="pagination">
                <Button
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span>Page {page + 1}</span>
                <Button
                  variant="outline"
                  disabled={(page + 1) * 50 >= (query.data?.total ?? 0)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState title="Tag not found" message="It may have been deleted." />
        )
      ) : (
        <>
          <div className="section-heading">
            <h2>
              Your tags <span className="count">{query.data?.tags.length ?? 0}</span>
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={run}
              disabled={mutation.isPending || !query.data?.tags.length}
            >
              <Sparkles size={15} />
              {mutation.isPending ? 'Classifying…' : 'Run classifier'}
            </Button>
          </div>
          <div className="tag-card-grid">
            {query.data?.tags.map((t) => (
              <article className="tag-card" key={t.id}>
                <div className="tag-card-top">
                  <span className={`tag-card-icon tag-${t.priority.toLowerCase()}`}>
                    <Tags size={20} />
                  </span>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      className="icon-button"
                      aria-label={`Actions for ${t.name}`}
                    >
                      <MoreHorizontal size={20} />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content className="dropdown-content" align="end">
                        <DropdownMenu.Item
                          onSelect={() => {
                            setEditing(t);
                            setFormOpen(true);
                          }}
                        >
                          Edit tag
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => setDeleting(t)}>
                          Delete tag
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
                <Link className="tag-card-title" href={`/tags/${t.id}`}>
                  <h2>{t.name}</h2>
                  <ArrowUpRight size={17} />
                </Link>
                <p>{t.description || 'A custom rule for your inbox.'}</p>
                <div className="keyword-list">
                  {t.keywords.slice(0, 4).map((k) => (
                    <span key={k}>{k}</span>
                  ))}
                </div>
                <div className="tag-card-footer">
                  <span className={`priority-text priority-${t.priority.toLowerCase()}`}>
                    {t.priority.toLowerCase()} priority
                  </span>
                  <Link href={`/tags/${t.id}`}>
                    View emails
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
          {!query.data?.tags.length && (
            <EmptyState
              title="Your priorities start with a tag"
              message="Try a tag for urgent work, immigration updates, or your next opportunity."
              action={
                <Button onClick={() => setFormOpen(true)}>
                  <Plus size={16} />
                  Create a tag
                </Button>
              }
            />
          )}
          <div className="info-note">
            <Sparkles size={19} />
            <div>
              <strong>A little context goes a long way.</strong>
              <p>
                Specific criteria help Jev make better decisions. Every match includes a
                probability, so uncertainty stays visible.
              </p>
            </div>
          </div>
        </>
      )}
      <TagForm tag={editing} open={formOpen} onOpenChange={setFormOpen} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'tag'}?`}
        description="This removes the tag and its classifications. Your emails stay in your inbox."
        onConfirm={async () => {
          await mutation.mutateAsync({ path: `/api/tags/${deleting!.id}`, method: 'DELETE' });
          toast.success('Tag deleted');
          if (tagId) router.push('/tags');
        }}
      />
      <EmailDetail email={selected} onClose={() => setSelected(null)} />
    </>
  );
}
