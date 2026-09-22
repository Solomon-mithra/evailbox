'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Sparkles, Pencil, Trash2 } from 'lucide-react';
import { useWorkspace, useAction } from '@/hooks/useFetch';
import { Button } from './ui/button';
import { TagBadge } from './ui/badge';
import { Skeleton } from './ui/loader';
import { TagForm } from './tag-form';
import { TagCard } from './tag-card';
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
          ? 'Demo emails checked against your tags.'
          : `Checked ${r.classified} tag matches${r.remaining ? ' · run again to continue' : ''}${r.errors ? ' · some checks failed; try again' : ''}`,
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
            {tagId ? tag?.description : 'Choose what matters. evailbox finds the emails that match.'}
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
              <h3>What evailbox looks for</h3>
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
                  {mutation.isPending ? 'Checking emails…' : 'Check for matches'}
                </Button>
              </div>
            </div>
            <div className="email-list">
              {query.data?.emails.length ? (
                query.data.emails.map((e) => <EmailRow key={e.id} email={e} onOpen={setSelected} />)
              ) : (
                <EmptyState
                  title="No matches yet"
                  message="Check for matches to find existing emails that fit this rule."
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
          <div className="section-heading tags-heading">
            <div>
              <h2>
                Your tags <span className="count">{query.data?.tags.length ?? 0}</span>
              </h2>
              <p>Open a tag to see its emails, or edit what it looks for.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={run}
              disabled={mutation.isPending || !query.data?.tags.length}
            >
              <Sparkles size={15} />
              {mutation.isPending ? 'Checking emails…' : 'Check for matches'}
            </Button>
          </div>
          <ul className="tag-card-grid" aria-label="Your tags">
            {query.data?.tags.map((t) => (
              <li key={t.id}>
                <TagCard
                  tag={t}
                  matchCount={query.data?.tagCounts ? (query.data.tagCounts[t.id] ?? 0) : undefined}
                  onEdit={() => {
                    setEditing(t);
                    setFormOpen(true);
                  }}
                  onDelete={() => setDeleting(t)}
                />
              </li>
            ))}
          </ul>
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
          {!!query.data?.tags.length && (
            <p className="tags-hint">
              <Sparkles size={15} aria-hidden="true" />
              Changed a rule? Check for matches to apply it to your emails.
            </p>
          )}
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
