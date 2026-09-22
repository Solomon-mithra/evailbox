'use client';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useWorkspace } from './useFetch';
import { useWorkspaceSelection } from '@/components/workspace-selection';
import { useDemo } from '@/components/providers';

/** Notify only about newly observed matches after establishing a baseline. */
export function usePriorityToasts() {
  const { data } = useWorkspace();
  const { workspace } = useWorkspaceSelection();
  const previousWorkspace = useRef(workspace);
  const demo = useDemo();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (previousWorkspace.current !== workspace) {
      seen.current = null;
      previousWorkspace.current = workspace;
    }
    if (!data || demo) return;
    if (!data.preferences.browserPush) {
      seen.current = null;
      return;
    }
    const matches = (data.needsYou ?? []).flatMap((email) =>
      email.classifications
        .filter(
          (c) =>
            c.matched &&
            c.tag.priority === 'HIGH' &&
            c.confidence >= data.preferences.minConfidence,
        )
        .map((c) => ({ id: c.id, tag: c.tag.name, sender: email.senderName || email.sender })),
    );
    if (!seen.current) {
      seen.current = new Set(matches.map((m) => m.id));
      return;
    }
    for (const match of matches) {
      if (!seen.current.has(match.id) && document.visibilityState === 'visible') {
        toast(`New ${match.tag} email`, { description: `From ${match.sender}` });
      }
      seen.current.add(match.id);
    }
  }, [data, demo, workspace]);
}
