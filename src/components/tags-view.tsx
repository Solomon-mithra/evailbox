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
import { TAG_HISTORY_LIMIT, TAG_CHECK_NOTICE } from '@/lib/tag-policy';
export function TagsView({ tagId }: { tagId?: string }) {
  return <TagsViewContent key={tagId ?? 'all'} tagId={tagId} />;
}
function TagsViewContent({ tagId }: { tagId?: string }) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const query = useWorkspace(tagId ? { tag: tagId, page, cursor: cursors[page] } : {}),
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
      if (r.demo) toast.success('Demo emails checked against your tags.');
      else if (r.queued && r.workerAvailable === false)
        toast.warning(
          'Your check is saved and will start when background processing is available.',
        );
      else if (r.queued)
        toast.info(
          `Checking up to ${TAG_HISTORY_LIMIT} unprocessed emails for matches. Results will appear automatically.`,
        );
      else toast.error('We couldn’t start this check. Please try again.');
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
            {tagId
              ? tag?.description
              : 'Choose what matters. evailbox finds the emails that match.'}
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
      {query.isLoading || (!query.metadataReady && !query.metadataError) ? (
        <Skeleton />
      ) : query.isError || query.metadataError ? (
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
              <p className="field-hint">{TAG_CHECK_NOTICE}</p>
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
                  message={`Check up to ${TAG_HISTORY_LIMIT} of the most recent emails still needing a check for this tag.`}
                />
              )}
            </div>
            {(query.nextCursor || page > 0) && (
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
                  disabled={!query.nextCursor || query.isFetching}
                  onClick={() => {
                    if (!query.nextCursor) return;
                    setCursors((current) => [...current.slice(0, page + 1), query.nextCursor!]);
                    setPage((p) => p + 1);
                  }}
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
              <p>{TAG_CHECK_NOTICE}</p>
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
