'use client';
import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDemo, usePrivateCache } from '@/components/providers';
import { useWorkspaceSelection } from '@/components/workspace-selection';
import { createEmailIntent, preloadEmail } from '@/lib/email-preload';

export function useEmailPreload(id: string) {
  const client = useQueryClient();
  const { user, ready } = usePrivateCache();
  const { workspace } = useWorkspaceSelection();
  const demo = useDemo();
  const userId = user?.id;
  const intent = useMemo(
    () =>
      createEmailIntent(() => {
        if (userId && ready && !demo && document.visibilityState === 'visible')
          void preloadEmail(client, { userId, workspace }, id);
      }),
    [client, userId, workspace, id, ready, demo],
  );
  useEffect(() => {
    const cancel = () => {
      if (document.hidden) intent.cancel();
    };
    document.addEventListener('visibilitychange', cancel);
    return () => {
      intent.cancel();
      document.removeEventListener('visibilitychange', cancel);
    };
  }, [intent]);
  return intent;
}
