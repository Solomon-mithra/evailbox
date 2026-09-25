import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { workspaceIds } from './workspace-selection';
import { isConfigured, isDemo } from './env';

export async function signalInboxChange(userId: string) {
  if (
    isDemo() ||
    !isConfigured(process.env.SUPABASE_URL) ||
    !isConfigured(process.env.SUPABASE_SECRET_KEY)
  )
    return;
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await Promise.all(
    workspaceIds.map(async (workspace) => {
      const channel = client.channel(`inbox:${userId}:${workspace}`, { config: { private: true } });
      try {
        const result = await channel.httpSend('processed', { workspace }, { timeout: 2000 });
        if (!result.success) console.warn(JSON.stringify({ event: 'inbox_signal_deferred' }));
      } catch {
        console.warn(JSON.stringify({ event: 'inbox_signal_deferred' }));
      } finally {
        await client.removeChannel(channel);
      }
    }),
  );
}
