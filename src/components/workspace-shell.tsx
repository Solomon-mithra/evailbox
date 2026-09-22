'use client';
import { useWorkspaceSelection } from './workspace-selection';
import { usePriorityToasts } from '@/hooks/usePriorityToasts';
import { Navigation } from './navigation';
import { useDemo } from './providers';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from './ui/loader';
import { Button } from './ui/button';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronRight, LockKeyhole } from 'lucide-react';
export function WorkspaceShell({ children }: { children: ReactNode }) {
  usePriorityToasts();
  const { workspace, name } = useWorkspaceSelection();
  const pathname = usePathname();
  const section = pathname.startsWith('/tags')
    ? 'Tags'
    : pathname.startsWith('/accounts')
      ? 'Accounts'
      : pathname.startsWith('/settings')
        ? 'Settings'
        : 'Inbox';
  const demo = useDemo(),
    auth = useAuth();
  if (auth.isLoading)
    return (
      <main className="auth-loading">
        <Skeleton />
      </main>
    );
  if (auth.isError)
    return (
      <main className="auth-loading">
        <h1>Your session needs attention</h1>
        <p>Please sign in again to continue.</p>
        <Button asChild>
          <a href="/signin">Sign in</a>
        </Button>
      </main>
    );
  return (
    <div className="app-shell">
      <Navigation />
      <div className={pathname === '/inbox' ? 'main-shell inbox-shell' : 'main-shell'}>
        <div className="topbar">
          <span className="workspace-crumb">
            {name} <ChevronRight size={13} /> <strong>{section}</strong>
          </span>
          <span className="topbar-right">
            {demo ? (
              <>
                <span className="demo-pill">Demo workspace</span>
                <span className="hide-mobile">Sample emails & scores</span>
              </>
            ) : (
              <>
                <LockKeyhole size={13} />
                Private workspace
              </>
            )}
          </span>
        </div>
        <main key={workspace} id="main-content" className="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
