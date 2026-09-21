'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useDemo } from '@/components/providers';
import type { User } from '@/types';
export function useAuth() {
  const demo = useDemo();
  return useQuery({
    queryKey: ['auth'],
    queryFn: () =>
      demo
        ? Promise.resolve({ id: 'demo-user', email: 'alex@example.com' })
        : api.get<User>('/api/auth/me'),
    retry: false,
  });
}
export async function signIn() {
  const { url } = await api.post<{ url: string }>('/api/auth/signin');
  window.location.assign(url);
}
export async function signOut() {
  await api.post('/api/auth/signout');
  window.location.assign(new URL('/signin', window.location.origin).href);
}
