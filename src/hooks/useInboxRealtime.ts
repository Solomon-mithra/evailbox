'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { api } from '@/lib/api';
import type { WorkspaceId } from '@/lib/workspace-selection';

type RealtimeSession = {
  userId: string;
  accessToken: string;
  expiresAt: number;
  url: string;
  publishableKey: string;
};

/** Tokens stay in this effect's memory, outside QueryClient and IndexedDB persistence. */
export function useInboxRealtime(
  userId: string | undefined,
  workspace: WorkspaceId,
  enabled = true,
) {
  const queries = useQueryClient();
  useEffect(() => {
    if (!userId || !enabled) return;
    let stopped = false,
      client: SupabaseClient | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      if (stopped) return;
      clearTimeout(refresh);
      refresh = setTimeout(() => {
        if (!stopped) void queries.invalidateQueries({ queryKey: ['private', userId, workspace] });
      }, 200);
    };
    async function connect() {
      try {
        const session = await api.get<RealtimeSession>('/api/realtime/session');
        if (stopped || session.userId !== userId) return;
        if (client) await client.removeAllChannels();
        if (stopped) return;
        client = createClient(session.url, session.publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        await client.realtime.setAuth(session.accessToken);
        if (stopped) {
          await client.removeAllChannels();
          return;
        }
        client
          .channel(`inbox:${userId}:${workspace}`, { config: { private: true } })
          .on('broadcast', { event: 'processed' }, invalidate)
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') invalidate();
          });
        reconnect = setTimeout(
          () => void connect(),
          Math.max(30_000, Math.min(30 * 60_000, session.expiresAt - Date.now() - 60_000)),
        );
      } catch {
        // Focus refresh and periodic reads remain available if Realtime is not yet configured.
        if (!stopped) reconnect = setTimeout(() => void connect(), 60_000);
      }
    }
    void connect();
    return () => {
      stopped = true;
      clearTimeout(reconnect);
      clearTimeout(refresh);
      void client?.removeAllChannels();
    };
  }, [userId, workspace, enabled, queries]);
}
