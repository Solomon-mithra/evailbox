'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { readDemo, filterWorkspace, mutateDemo, demoInbox } from '@/lib/demo';
import { useDemo, usePrivateCache } from '@/components/providers';
import type {
  Filters,
  Workspace,
  WorkspaceMetadata,
  InboxPage,
  InboxCounts,
  AppPreferences,
} from '@/types';
import { useWorkspaceSelection } from '@/components/workspace-selection';
import { workspacePath } from '@/lib/workspace-selection';
import { clearPrivateCache, SUMMARY_MAX_AGE } from '@/lib/query-cache';

const defaultPreferences: AppPreferences = {
  refreshMinutes: 5,
};
function paramsFor(filters: Filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (key !== 'page' && value !== undefined && value !== '') params.set(key, String(value));
  });
  return params;
}
function usePrivateQuery<T>(kind: string, path: string, filters: Filters, sample: () => T) {
  const demo = useDemo();
  const { user, ready, cacheVersion } = usePrivateCache();
  const client = useQueryClient();
  const { workspace } = useWorkspaceSelection();
  const { page: _page, ...safeFilters } = filters;
  void _page;
  return useQuery({
    queryKey: [
      'private',
      user?.id,
      workspace,
      kind,
      kind === 'inbox' ? { ...safeFilters, cacheVersion } : safeFilters,
    ],
    gcTime: kind === 'inbox' ? SUMMARY_MAX_AGE : 5 * 60000,
    enabled: !!user && ready,
    queryFn: () =>
      demo
        ? Promise.resolve(sample())
        : api.get<T>(workspacePath(`${path}?${paramsFor(filters)}`, workspace)),
    refetchInterval: (query) => {
      const metadata = client.getQueryData<WorkspaceMetadata>([
        'private',
        user?.id,
        workspace,
        'metadata',
        {},
      ]);
      const progress =
        kind === 'counts' ? (query.state.data as InboxCounts | undefined)?.processing : undefined;
      const processing = progress && (progress.importing || progress.remaining > 0);
      if (!demo && kind !== 'settings' && (metadata?.user.workRequested || processing))
        return 2_000;
      return (
        (client.getQueryData<AppPreferences>(['private', user?.id, workspace, 'settings', {}])
          ?.refreshMinutes ?? 5) * 60000
      );
    },
  });
}
export function useWorkspaceMetadata() {
  const { workspace } = useWorkspaceSelection();
  return usePrivateQuery<WorkspaceMetadata>('metadata', '/api/workspace/metadata', {}, () => {
    const { user, tags, accounts } = readDemo(workspace);
    return { user, tags, accounts };
  });
}
export function useWorkspaceSettings() {
  const { workspace } = useWorkspaceSelection();
  return usePrivateQuery<AppPreferences>(
    'settings',
    '/api/workspace/settings',
    {},
    () => readDemo(workspace).preferences,
  );
}
export function useInbox(filters: Filters = {}) {
  const { workspace } = useWorkspaceSelection();
  return usePrivateQuery<InboxPage>('inbox', '/api/inbox', filters, () =>
    demoInbox(readDemo(workspace), filters),
  );
}
export function useInboxCounts(filters: Filters = {}) {
  const { workspace } = useWorkspaceSelection();
  const { cursor: _cursor, page: _page, ...countFilters } = filters;
  void _cursor;
  void _page;
  return usePrivateQuery<InboxCounts>('counts', '/api/workspace/counts', countFilters, () => {
    const data = filterWorkspace(readDemo(workspace), countFilters);
    return { total: data.total, needsTotal: data.needsTotal ?? 0, tagCounts: data.tagCounts ?? {} };
  });
}
/** Compatibility adapter for tags/accounts/settings; requests are independently cached. */
export function useInboxWorkspace(filters: Filters = {}) {
  const { user } = usePrivateCache();
  const inbox = useInbox(filters);
  const needs = useInbox({ needs: '1' });
  const metadata = useWorkspaceMetadata();
  const counts = useInboxCounts(filters);
  const settings = useWorkspaceSettings();
  const data: Workspace | undefined =
    inbox.data && user
      ? {
          ...inbox.data,
          user: metadata.data?.user ?? user,
          accounts: metadata.data?.accounts ?? [],
          tags: metadata.data?.tags ?? [],
          preferences: settings.data ?? defaultPreferences,
          total: counts.data?.total ?? inbox.data.emails.length,
          needsYou: needs.data?.emails,
          needsTotal: counts.data?.needsTotal,
          tagCounts: counts.data?.tagCounts,
          processing: counts.data?.processing,
          page: filters.page ?? 0,
        }
      : undefined;
  return {
    ...inbox,
    data,
    isLoading: inbox.isPending,
    nextCursor: inbox.data?.nextCursor,
    metadataReady: metadata.isSuccess,
    countsReady: counts.isSuccess,
    settingsReady: settings.isSuccess,
    metadataError: metadata.error,
    countsError: counts.error,
    settingsError: settings.error,
    refetch: async () => {
      await Promise.all([
        inbox.refetch(),
        needs.refetch(),
        metadata.refetch(),
        counts.refetch(),
        settings.refetch(),
      ]);
    },
  };
}
export function useWorkspace(filters: Filters = {}) {
  const query = useInboxWorkspace(filters);
  return {
    ...query,
    isLoading:
      query.isLoading ||
      (!query.metadataReady && !query.metadataError) ||
      (!query.settingsReady && !query.settingsError),
    isError: query.isError || !!query.metadataError || !!query.settingsError,
    error: query.error ?? query.metadataError ?? query.settingsError,
  };
}
export function useAction() {
  const { workspace } = useWorkspaceSelection();
  const { user } = usePrivateCache();
  const demo = useDemo(),
    client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      path,
      method = 'POST',
      body = {},
    }: {
      path: string;
      method?: 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
    }) => {
      if (demo) {
        mutateDemo(path, method, body, workspace);
        return { demo: true } as Record<string, unknown>;
      }
      // Deletion can partially succeed server-side; never retain deleted-user data on an error.
      if (method === 'DELETE' && path === '/api/user')
        await clearPrivateCache({ userId: user?.id, reason: 'delete' });
      const result =
        method === 'DELETE'
          ? await api.delete<Record<string, unknown>>(workspacePath(path, workspace), body)
          : method === 'PATCH'
            ? await api.patch<Record<string, unknown>>(workspacePath(path, workspace), body)
            : await api.post<Record<string, unknown>>(workspacePath(path, workspace), body);
      if (method === 'DELETE' && path.startsWith('/api/accounts/'))
        await clearPrivateCache({ userId: user?.id, workspace, reason: 'disconnect' });
      return result;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['private', user?.id] }),
  });
}
export function useFetch<T>(path: string) {
  const { user, ready } = usePrivateCache();
  const { workspace } = useWorkspaceSelection();
  return useQuery({
    queryKey: ['private', user?.id, workspace, 'detail', path],
    queryFn: () => api.get<T>(workspacePath(path, workspace)),
    enabled: !!user && ready,
  });
}
