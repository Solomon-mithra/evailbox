'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { readDemo, filterWorkspace, mutateDemo } from '@/lib/demo';
import { useDemo } from '@/components/providers';
import type { Filters, Workspace } from '@/types';
import { useWorkspaceSelection } from '@/components/workspace-selection';
import { workspacePath } from '@/lib/workspace-selection';
export function useWorkspace(filters: Filters = {}) {
  const demo = useDemo();
  const { workspace } = useWorkspaceSelection();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== '') params.set(k, String(v));
  });
  return useQuery({
    queryKey: ['workspace', workspace, filters],
    queryFn: () =>
      demo
        ? Promise.resolve(filterWorkspace(readDemo(workspace), filters))
        : api.get<Workspace>(workspacePath(`/api/workspace?${params}`, workspace)),
    refetchInterval: (query) => (query.state.data?.preferences.refreshMinutes ?? 5) * 60000,
  });
}
export function useAction() {
  const { workspace } = useWorkspaceSelection();
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
      return method === 'DELETE'
        ? api.delete<Record<string, unknown>>(workspacePath(path, workspace), body)
        : method === 'PATCH'
          ? api.patch<Record<string, unknown>>(workspacePath(path, workspace), body)
          : api.post<Record<string, unknown>>(workspacePath(path, workspace), body);
    },
    onSuccess: () => client.invalidateQueries(),
  });
}
export function useFetch<T>(path: string) {
  return useQuery({ queryKey: [path], queryFn: () => api.get<T>(path) });
}
