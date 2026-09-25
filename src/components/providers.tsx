'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
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
        <WorkspaceSelection>{children}</WorkspaceSelection>
        <Toaster position="bottom-right" richColors closeButton />
      </QueryClientProvider>
    </ModeContext.Provider>
  );
}

const SessionContext = createContext<User | undefined>(undefined);
export const useSessionIdentity = () => useContext(SessionContext);
export function SessionIdentity({ user, children }: { user: User; children: ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}
const PrivateContext = createContext<{ user?: User; ready: boolean }>({ ready: false });
export const usePrivateCache = () => useContext(PrivateContext);
export const useTrustedUser = () => usePrivateCache().user;
export function PrivateWorkspace({ user, children }: { user: User; children: ReactNode }) {
  const client = useQueryClient();
  const demo = useDemo();
  const { workspace } = useWorkspaceSelection();
  const [readyScope, setReadyScope] = useState('');
  const [revision, setRevision] = useState(0);
  const [signedOut, setSignedOut] = useState(false);
  const scope = `${user.id}:${workspace}:${revision}`;
  useEffect(() => {
    if (demo || signedOut) return;
    const cache = attachSummaryCache(client, { userId: user.id, workspace }, (event) => {
      if (event.reason === 'disconnect') setRevision((value) => value + 1);
      else setSignedOut(true);
    });
    let mounted = true;
    void cache.ready.then(() => {
      if (mounted) setReadyScope(scope);
    });
    return () => {
      mounted = false;
      cache.stop();
    };
  }, [client, demo, user.id, workspace, scope, signedOut]);
  if (signedOut)
    return (
      <main className="auth-loading">
        <p>Your session has ended.</p>
        <a href="/signin">Sign in</a>
      </main>
    );
  return (
    <PrivateContext.Provider value={{ user, ready: demo || readyScope === scope }}>
      <div key={scope} style={{ display: 'contents' }}>
        {children}
      </div>
    </PrivateContext.Provider>
  );
}
