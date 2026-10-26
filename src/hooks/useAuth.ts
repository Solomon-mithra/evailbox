'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useDemo, useSessionIdentity } from '@/components/providers';
import { clearPrivateCache } from '@/lib/query-cache';
import type { User } from '@/types';
export function useAuth() {
  const demo = useDemo();
  const initialUser = useSessionIdentity();
  return useQuery({
    queryKey: ['auth', initialUser?.id ?? 'unidentified'],
    initialData: initialUser,
    staleTime: 60000,
    queryFn: () =>
      demo
        ? Promise.resolve({ id: 'demo-user', email: 'alex@example.com' })
        : api.get<User>('/api/auth/me'),
    retry: false,
  });
}
export async function signIn(password: string) {
  await api.post('/api/auth/signin', { password });
  window.location.assign('/inbox');
}
export async function signOut() {
  await api.post('/api/auth/signout');
  await clearPrivateCache({ reason: 'signout' });
  window.location.assign(new URL('/signin', window.location.origin).href);
}
