'use client';
import { useEffect, useState } from 'react';
import {
  Search,
  RefreshCw,
  ChevronDown,
  ArrowUpRight,
  X,
  CheckCheck,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useInboxWorkspace, useAction } from '@/hooks/useFetch';
import { useDemo } from './providers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { TagBadge } from './ui/badge';
import { Skeleton } from './ui/loader';
import { EmailDetail } from './email-detail';
import { EmptyState, ErrorState } from './states';
import { relativeTime } from '@/lib/utils';
import { api } from '@/lib/api';
import { useWorkspaceSelection } from './workspace-selection';
import { workspacePath } from '@/lib/workspace-selection';
import type { Email, Tag, Filters } from '@/types';
export function EmailRow({
  email,
  onOpen,
  compact = false,
}: {
  email: Email;
  onOpen: (e: Email) => void;
  compact?: boolean;
}) {
  const tag = email.classifications
    .filter((c) => c.matched)
    .sort((a, b) => b.confidence - a.confidence)[0];
  return (
    <button
      className={`email-row ${email.handled ? 'email-handled' : ''} ${compact ? 'email-compact' : ''}`}
      onClick={() => onOpen(email)}
    >
      <span className="sender-avatar" aria-hidden="true">
        {(email.senderName || email.sender)
          .split(' ')
          .slice(0, 2)
          .map((s) => s[0])
          .join('')}
      </span>
      <span className="email-content">
        <span className="email-first-line">
          <span className="sender-name">{email.senderName || email.sender}</span>
          {!email.isRead && !email.handled && <span className="unread-dot" aria-label="Unread" />}
          <span className="row-time">{relativeTime(email.receivedAt)}</span>
        </span>
        <span className="email-subject">{email.subject}</span>
        <span className="email-snippet">{email.snippet.slice(0, 100)}</span>
      </span>
      <span className="email-row-end">
        {tag && <TagBadge tag={tag.tag} />}
        <span className="email-time">{relativeTime(email.receivedAt)}</span>
        <ChevronRight className="row-arrow" size={16} />
      </span>
    </button>
  );
}
export function InboxView() {
  const { workspace, select } = useWorkspaceSelection();
  const [now] = useState(() => Date.now());
  const [search, setSearch] = useState(''),
    [debounced, setDebounced] = useState(''),
    [filters, setFilters] = useState<Filters>({ range: 'all', page: 0 }),
    [selected, setSelected] = useState<Email | null>(null),
    [view, setView] = useState<'overview' | 'all'>('overview');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('[aria-label="Search emails"]')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  const query = useInboxWorkspace({
      ...filters,
      cursor: cursors[filters.page ?? 0],
      search: debounced,
    }),
    mutation = useAction(),
    demo = useDemo();
  const data = query.data;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('workspace');
    if (linked && linked !== workspace) return;
    const id = params.get('email');
    if (!id || !data) return;
    const found = data.emails.find((e) => e.id === id);
    if (found) setSelected(found);
    else if (!demo)
      void api
        .get<Email>(workspacePath(`/api/emails/${encodeURIComponent(id)}`, workspace))
        .then(setSelected)
        .catch(() => toast.error('This email is unavailable.'));
    select(workspace);
    window.history.replaceState(null, '', window.location.pathname);
  }, [data, demo, workspace, select]);
  const change = (key: keyof Filters, value: string) => {
    setCursors([undefined]);
    setFilters((f) => ({ ...f, [key]: value, page: 0 }));
  };
  const isFiltered = !!(search || filters.tag || filters.account || filters.range !== 'all');
  const emails = data?.emails ?? [];
  const needs =
    data?.needsYou ??
    emails
      .filter(
        (e) =>
          !e.handled &&
          !e.isRead &&
          e.classifications.some((c) => c.matched && c.tag.priority === 'HIGH'),
      )
      .sort(
        (a, b) =>
          Math.max(
            ...b.classifications
              .filter((c) => c.matched && c.tag.priority === 'HIGH')
              .map((c) => c.confidence),
          ) -
          Math.max(
            ...a.classifications
              .filter((c) => c.matched && c.tag.priority === 'HIGH')
              .map((c) => c.confidence),
          ),
      );
  const week = emails.filter((e) => new Date(e.receivedAt).getTime() >= now - 7 * 86400000);
  async function sync() {
    try {
      const r = await mutation.mutateAsync({ path: '/api/sync' });
      if (demo) toast.info('Sample inbox refreshed. No live provider was called.');
      else if (r.queued)
        toast.info(
          r.workerAvailable === false
            ? 'Sync queued. Background processing setup is pending.'
            : 'Sync queued. Your inbox will update automatically.',
        );
      else if (r.errors) toast.warning(`Synced ${r.synced} emails. Some operations need a retry.`);
      else
        toast.success(
          `Synced ${r.synced} emails${r.pending ? ' · more work remains; sync again' : ''}`,
        );
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Inbox</h1>
          <p>Your latest mail, sorted by priority.</p>
        </div>
        <Button
          variant="outline"
          onClick={sync}
          disabled={mutation.isPending || (query.metadataReady && !data?.accounts.length)}
        >
          <RefreshCw size={16} className={mutation.isPending ? 'spin' : ''} />
          {mutation.isPending ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>
      <div className="inbox-toolbar">
        <div
          className="view-tabs"
          role="tablist"
          aria-label="Inbox view"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 'overview'
                : event.key === 'End'
                  ? 'all'
                  : view === 'overview'
                    ? 'all'
                    : 'overview';
            setView(next);
            document.getElementById(`inbox-tab-${next}`)?.focus();
          }}
        >
          <button
            id="inbox-tab-overview"
            role="tab"
            aria-controls="inbox-panel"
            tabIndex={view === 'overview' ? 0 : -1}
            aria-selected={view === 'overview'}
            className={view === 'overview' ? 'selected' : ''}
            onClick={() => setView('overview')}
          >
            Overview
          </button>
          <button
            id="inbox-tab-all"
            role="tab"
            aria-controls="inbox-panel"
            tabIndex={view === 'all' ? 0 : -1}
            aria-selected={view === 'all'}
            className={view === 'all' ? 'selected' : ''}
            onClick={() => setView('all')}
          >
            All mail {query.countsReady && data && <span>{data.total}</span>}
          </button>
        </div>
        <div className="last-synced">
          <RefreshCw size={12} className={data?.user.workRequested ? 'spin' : ''} />
          {data?.user.workRequested
            ? 'Processing saved backlog…'
            : data?.accounts[0]?.lastSync
              ? `Synced ${relativeTime(data.accounts[0].lastSync)} ago`
              : 'Not synced yet'}
        </div>
      </div>
      <div className="filter-bar">
        <div className="search-box">
          <Search size={17} />
          <Input
            type="search"
            aria-label="Search emails"
            placeholder="Search your inbox"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursors([undefined]);
              setFilters((f) => ({ ...f, page: 0 }));
            }}
          />
          {search ? (
            <button
              className="search-clear icon-button"
              aria-label="Clear search"
              onClick={() => {
                setSearch('');
                setCursors([undefined]);
                setFilters((f) => ({ ...f, page: 0 }));
                document.querySelector<HTMLInputElement>('[aria-label="Search emails"]')?.focus();
              }}
            >
              <X size={15} />
            </button>
          ) : (
            <kbd aria-hidden="true">⌘ K</kbd>
          )}
        </div>
        <div className="filter-selects">
          <select
            aria-label="Filter by tag"
            value={filters.tag ?? ''}
            onChange={(e) => change('tag', e.target.value)}
          >
            <option value="">All tags</option>
            {data?.tags.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by account"
            value={filters.account ?? ''}
            onChange={(e) => change('account', e.target.value)}
          >
            <option value="">All accounts</option>
            {data?.accounts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.provider === 'GMAIL' ? 'Gmail' : 'Outlook'} · {a.email}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by date"
            value={filters.range}
            onChange={(e) => change('range', e.target.value)}
          >
            <option value="all">All time</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
          {isFiltered && (
            <button
              className="clear-filters"
              onClick={() => {
                setSearch('');
                setCursors([undefined]);
                setFilters({ range: 'all', page: 0 });
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div id="inbox-panel" role="tabpanel" aria-labelledby={`inbox-tab-${view}`} tabIndex={0}>
        {query.isLoading ? (
          <Skeleton />
        ) : query.isError && !data ? (
          <ErrorState retry={() => void query.refetch()} message={query.error.message} />
        ) : (
          data && (
            <>
              {(query.metadataError || query.countsError || query.isError) && (
                <p role="status" className="section-caption">
                  Some inbox details are unavailable. Your saved mail is still shown.{' '}
                  <button className="text-link" onClick={() => void query.refetch()}>
                    Retry
                  </button>
                </p>
              )}
              {query.metadataReady && !data.accounts.length ? (
                <EmptyState
                  title="One inbox starts here"
                  message="Connect Gmail or Outlook, then create a tag for what matters to you."
                  action={
                    <Button asChild>
                      <Link href="/accounts">
                        Connect an account
                        <ArrowRight size={16} />
                      </Link>
                    </Button>
                  }
                />
              ) : view === 'all' || isFiltered || !query.metadataReady ? (
                <section className="inbox-section">
                  <div className="section-heading">
                    <h2>
                      {isFiltered ? 'Matching emails' : 'All mail'}
                      <span className="count">
                        {query.countsReady ? data.total : emails.length}
                      </span>
                    </h2>
                  </div>
                  <div className="email-list">
                    {emails.length ? (
                      emails.map((e) => <EmailRow key={e.id} email={e} onOpen={setSelected} />)
                    ) : (
                      <EmptyState
                        title="No emails found"
                        message="Try another search or adjust your filters."
                      />
                    )}
                  </div>
                </section>
              ) : (
                <>
                  <section className="inbox-section needs-section">
                    <div className="section-heading">
                      <h2>
                        <span className="needs-indicator" />
                        Needs you<span className="count">{data.needsTotal ?? needs.length}</span>
                      </h2>
                      <span className="section-caption">
                        High priority · unread{(data.needsTotal ?? 0) > 50 ? ' · top 50' : ''}
                      </span>
                    </div>
                    {needs.length ? (
                      <div className="email-list priority-list">
                        {needs.map((e) => (
                          <EmailRow key={e.id} email={e} onOpen={setSelected} />
                        ))}
                      </div>
                    ) : (
                      <div className="all-clear">
                        <CheckCheck size={20} />
                        <div>
                          <strong>You’re all caught up.</strong>
                          <p>No high-priority emails need your attention.</p>
                        </div>
                      </div>
                    )}
                  </section>
                  <section className="inbox-section">
                    <div className="section-heading">
                      <h2>
                        By tag<span className="count">{data.tags.length}</span>
                      </h2>
                      <Link className="text-link" href="/tags">
                        Manage tags
                        <ArrowUpRight size={14} />
                      </Link>
                    </div>
                    <div className="tag-groups">
                      {data.tags.length ? (
                        data.tags.map((t) => (
                          <TagGroup
                            key={t.id}
                            tag={t}
                            count={data.tagCounts?.[t.id]}
                            emails={emails.filter((e) =>
                              e.classifications.some((c) => c.matched && c.tagId === t.id),
                            )}
                            onOpen={setSelected}
                          />
                        ))
                      ) : (
                        <EmptyState
                          title="Make this inbox yours"
                          message="Create a tag and tell evailbox what to look for."
                          action={
                            <Button asChild variant="outline">
                              <Link href="/tags">Create your first tag</Link>
                            </Button>
                          }
                        />
                      )}
                    </div>
                  </section>
                  <section className="inbox-section">
                    <div className="section-heading">
                      <h2>
                        This week<span className="count">{week.length}</span>
                      </h2>
                      <span className="section-caption">The last 7 days</span>
                    </div>
                    <div className="email-list">
                      {week.length ? (
                        week.map((e) => (
                          <EmailRow key={e.id} email={e} onOpen={setSelected} compact />
                        ))
                      ) : (
                        <EmptyState />
                      )}
                    </div>
                  </section>
                </>
              )}
              {(query.nextCursor || data.page > 0) && (
                <div className="pagination">
                  <span>
                    Page {data.page + 1}
                    {query.countsReady ? ` · ${data.total} matching emails` : ''}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!data.page}
                    onClick={() =>
                      setFilters((f) => ({ ...f, page: Math.max(0, (f.page ?? 0) - 1) }))
                    }
                  >
                    <ChevronLeft size={16} />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!query.nextCursor || query.isFetching || search !== debounced}
                    onClick={() => {
                      if (!query.nextCursor) return;
                      setCursors((current) => [
                        ...current.slice(0, data.page + 1),
                        query.nextCursor!,
                      ]);
                      setFilters((f) => ({ ...f, page: (f.page ?? 0) + 1 }));
                    }}
                  >
                    Next
                    <ChevronRight size={16} />
                  </Button>
                </div>
              )}
            </>
          )
        )}
      </div>
      <EmailDetail email={selected} onClose={() => setSelected(null)} />
    </>
  );
}
function TagGroup({
  tag,
  emails,
  onOpen,
  count,
}: {
  tag: Tag;
  emails: Email[];
  count?: number;
  onOpen: (e: Email) => void;
}) {
  return (
    <details className="tag-group">
      <summary>
        <TagBadge tag={tag} />
        <span className="tag-group-description">{tag.description}</span>
        <span className="tag-group-count">{count ?? emails.length}</span>
        <ChevronDown size={16} className="expand-icon" />
      </summary>
      <div className="tag-group-content">
        {emails.length ? (
          emails.map((e) => <EmailRow key={e.id} email={e} onOpen={onOpen} compact />)
        ) : (
          <p className="inline-empty">No matches on this page yet.</p>
        )}
        <Link className="tag-detail-link" href={`/tags/${tag.id}`}>
          View tag details
          <ArrowRight size={14} />
        </Link>
      </div>
    </details>
  );
}
