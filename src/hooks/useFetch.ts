'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { readDemo, filterWorkspace, mutateDemo } from '@/lib/demo';
import { useDemo } from '@/components/providers';
import type { Filters, Workspace } from '@/types';
export function useWorkspace(filters: Filters = {}) {
  const demo = useDemo();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== '') params.set(k, String(v));
  });
  return useQuery({
    queryKey: ['workspace', filters],
    queryFn: () =>
      demo
        ? Promise.resolve(filterWorkspace(readDemo(), filters))
        : api.get<Workspace>(`/api/workspace?${params}`),
    refetchInterval: (query) => (query.state.data?.preferences.refreshMinutes ?? 5) * 60000,
  });
}
export function useAction() {
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
        mutateDemo(path, method, body);
        return { demo: true } as Record<string, unknown>;
      }
      return method === 'DELETE'
        ? api.delete<Record<string, unknown>>(path, body)
        : method === 'PATCH'
          ? api.patch<Record<string, unknown>>(path, body)
          : api.post<Record<string, unknown>>(path, body);
    },
    onSuccess: () => client.invalidateQueries(),
  });
}
export function useFetch<T>(path: string) {
  return useQuery({ queryKey: [path], queryFn: () => api.get<T>(path) });
}
