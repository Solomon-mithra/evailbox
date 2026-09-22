'use client';
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { workspaceNames, type WorkspaceId } from '@/lib/workspace-selection';
const key = 'jevinbox-selected-workspace';
const eventName = 'jevinbox-workspace-change';
let current: WorkspaceId | undefined;
function snapshot(): WorkspaceId {
  const linked = new URLSearchParams(window.location.search).get('workspace');
  if (linked === 'PERSONAL' || linked === 'WORK') return linked;
  if (current) return current;
  if (new URLSearchParams(window.location.search).has('email')) return 'PERSONAL';
  try {
    return localStorage.getItem(key) === 'WORK' ? 'WORK' : 'PERSONAL';
  } catch {
    return 'PERSONAL';
  }
}
function subscribe(callback: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key) {
      current = undefined;
      callback();
    }
  };
  window.addEventListener(eventName, callback);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener('storage', storage);
  };
}
function select(workspace: WorkspaceId) {
  current = workspace;
  const url = new URL(window.location.href);
  url.searchParams.delete('workspace');
  window.history.replaceState(null, '', url.pathname + url.search);
  try {
    localStorage.setItem(key, workspace);
  } catch {}
  window.dispatchEvent(new Event(eventName));
}
const Context = createContext({ workspace: 'PERSONAL' as WorkspaceId, name: 'Personal', select });
export function WorkspaceSelection({ children }: { children: ReactNode }) {
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get('workspace');
    if (linked === 'WORK' || linked === 'PERSONAL') select(linked);
    else if (new URLSearchParams(window.location.search).has('email')) select('PERSONAL');
  }, []);
  const workspace = useSyncExternalStore(subscribe, snapshot, () => 'PERSONAL' as WorkspaceId);
  return (
    <Context.Provider value={{ workspace, name: workspaceNames[workspace], select }}>
      {children}
    </Context.Provider>
  );
}
export const useWorkspaceSelection = () => useContext(Context);
