'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { RetireNotificationWorker } from './retire-notification-worker';
import { Toaster } from 'sonner';
import { WorkspaceSelection, useWorkspaceSelection } from './workspace-selection';
import { attachSummaryCache } from '@/lib/query-cache';
import type { User } from '@/types';
const ModeContext = createContext(false);
export function useDemo() {
  return useContext(ModeContext);
}
export function Providers({ children, demo }: { children: ReactNode; demo: boolean }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return (
    <ModeContext.Provider value={demo}>
      <QueryClientProvider client={queryClient}>
        <RetireNotificationWorker />
        <WorkspaceSelection>{children}</WorkspaceSelection>
        <Toaster position="bottom-right" richColors closeButton />
      </QueryClientProvider>
    </ModeContext.Provider>
  );
}

const SessionContext = createContext<User | undefined>(undefined);
export const useSessionIdentity = () => useContext(SessionContext);
const CacheVersionContext = createContext<string | undefined>(undefined);
export function SessionIdentity({
  user,
  cacheVersion,
  children,
}: {
  user: User;
  cacheVersion?: string;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={user}>
      <CacheVersionContext.Provider value={cacheVersion}>{children}</CacheVersionContext.Provider>
    </SessionContext.Provider>
  );
}
const PrivateContext = createContext<{ user?: User; ready: boolean; cacheVersion?: string }>({
  ready: false,
});
export const usePrivateCache = () => useContext(PrivateContext);
export const useTrustedUser = () => usePrivateCache().user;
export function PrivateWorkspace({ user, children }: { user: User; children: ReactNode }) {
  const client = useQueryClient();
  const cacheVersion = useContext(CacheVersionContext);
  const demo = useDemo();
  const { workspace } = useWorkspaceSelection();
  const [readyScope, setReadyScope] = useState('');
  const [revision, setRevision] = useState(0);
  const [signedOut, setSignedOut] = useState(false);
  const scope = `${user.id}:${workspace}:${cacheVersion}:${revision}`;
  useEffect(() => {
    if (demo || signedOut) return;
    const cache = attachSummaryCache(
      client,
      { userId: user.id, workspace, cacheVersion },
      (event) => {
        if (event.reason === 'disconnect') setRevision((value) => value + 1);
        else setSignedOut(true);
      },
    );
    let mounted = true;
    void cache.ready.then(() => {
      if (mounted) setReadyScope(scope);
    });
    return () => {
      mounted = false;
      cache.stop();
    };
  }, [client, demo, user.id, workspace, scope, signedOut, cacheVersion]);
  if (signedOut)
    return (
      <main className="auth-loading">
        <p>Your session has ended.</p>
        <a href="/signin">Sign in</a>
      </main>
    );
  return (
    <PrivateContext.Provider value={{ user, ready: demo || readyScope === scope, cacheVersion }}>
      <div key={scope} style={{ display: 'contents' }}>
        {children}
      </div>
    </PrivateContext.Provider>
  );
}
