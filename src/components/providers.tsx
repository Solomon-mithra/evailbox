'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { WorkspaceSelection } from './workspace-selection';
const ModeContext = createContext(false);
export function useDemo() {
  return useContext(ModeContext);
}
export function Providers({ children, demo }: { children: ReactNode; demo: boolean }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15000, retry: 1, refetchOnWindowFocus: true } },
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
