'use client';
import { useState } from 'react';
import { Bell, Mail, LogOut, Trash2 } from 'lucide-react';
import { Switch } from 'radix-ui';
import { useWorkspace, useAction } from '@/hooks/useFetch';
import { signOut } from '@/hooks/useAuth';
import { useDemo } from './providers';
import { AccountsView } from './accounts-view';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ConfirmDialog } from './confirm-dialog';
import { Skeleton } from './ui/loader';
import { ErrorState } from './states';
import { api } from '@/lib/api';
import type { NotificationPref } from '@/types';
import { toast } from 'sonner';
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window))
    throw new Error('Push notifications are not supported in this browser.');
  if ((await Notification.requestPermission()) !== 'granted')
    throw new Error('Allow notifications in your browser settings first.');
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { key } = await api.get<{ key: string }>('/api/push/key');
  const binary = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  const applicationServerKey = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }));
  await api.post('/api/push/subscriptions', subscription.toJSON());
}
export function SettingsView() {
  const query = useWorkspace(),
    mutation = useAction(),
    demo = useDemo();
  const [deleting, setDeleting] = useState(false);
  async function save(patch: Partial<NotificationPref>) {
    try {
      if (patch.browserPush && !demo) await enablePush();
      if (patch.browserPush === false && !demo && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await api.delete('/api/push/subscriptions', { endpoint: subscription.endpoint });
          await subscription.unsubscribe();
        }
      }
      await mutation.mutateAsync({ path: '/api/settings', method: 'PATCH', body: patch });
      toast.success(
        demo ? 'Demo preference saved. No notification will be sent.' : 'Preferences saved',
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const prefs = query.data?.preferences;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>Notification preferences apply to both workspaces.</p>
        </div>
      </div>
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        prefs && (
          <>
            <section className="settings-section">
              <h2>Notifications</h2>
              <p className="section-description">Choose when your inbox gets your attention.</p>
              <div className="settings-card">
                <div className="setting-row">
                  <Bell size={20} />
                  <div>
                    <label htmlFor="browser-push">Browser notifications</label>
                    <p>Get a heads-up when a high-priority email matches your tags.</p>
                  </div>
                  <Switch.Root
                    className="switch"
                    id="browser-push"
                    checked={prefs.browserPush}
                    disabled={mutation.isPending}
                    onCheckedChange={(v) => void save({ browserPush: v })}
                  >
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </div>
                <div className="setting-row">
                  <Mail size={20} />
                  <div>
                    <label htmlFor="daily-digest">Daily email digest</label>
                    <p>A daily summary of new matches, grouped by tag.</p>
                  </div>
                  <Switch.Root
                    className="switch"
                    id="daily-digest"
                    checked={prefs.dailyDigest}
                    disabled={mutation.isPending}
                    onCheckedChange={(v) => void save({ dailyDigest: v })}
                  >
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </div>
                <div className="setting-row">
                  <div>
                    <label htmlFor="digest-time">Digest time</label>
                    <p>Scheduled for the next 15-minute delivery check.</p>
                  </div>
                  <Input
                    id="digest-time"
                    type="time"
                    className="time-input"
                    defaultValue={prefs.digestTime}
                    key={prefs.digestTime}
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== prefs.digestTime)
                        void save({ digestTime: e.target.value });
                    }}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <label htmlFor="timezone">Time zone</label>
                    <p>Used for your daily digest.</p>
                  </div>
                  <select
                    id="timezone"
                    className="input timezone-input"
                    value={prefs.timezone}
                    disabled={mutation.isPending}
                    onChange={(e) => void save({ timezone: e.target.value })}
                  >
                    {[...new Set([prefs.timezone, ...Intl.supportedValuesOf('timeZone'), 'UTC'])]
                      .sort()
                      .map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                  </select>
                </div>
                <ConfidenceControl
                  key={prefs.minConfidence}
                  value={prefs.minConfidence}
                  save={(v) => void save({ minConfidence: v })}
                />
              </div>
            </section>
            <section className="settings-section">
              <AccountsView embedded />
            </section>
            <section className="settings-section">
              <h2>General</h2>
              <div className="settings-card">
                <div className="setting-row">
                  <div>
                    <strong>Signed in as</strong>
                    <p>{query.data?.user.email}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      demo
                        ? toast.info('No account is signed in to this demo.')
                        : void signOut().catch((e) => toast.error(e.message))
                    }
                  >
                    <LogOut size={15} />
                    Sign out
                  </Button>
                </div>
                <div className="setting-row">
                  <div>
                    <label htmlFor="refresh">Inbox refresh</label>
                    <p>How often to check for newly synced email.</p>
                  </div>
                  <select
                    className="input time-input"
                    id="refresh"
                    value={prefs.refreshMinutes}
                    onChange={(e) => void save({ refreshMinutes: Number(e.target.value) })}
                  >
                    {[1, 5, 10, 15, 30, 60].map((n) => (
                      <option value={n} key={n}>
                        {n} min
                      </option>
                    ))}
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Delete account</strong>
                    <p>Remove both workspaces, connections, and saved emails.</p>
                  </div>
                  <Button
                    variant="ghost"
                    className="danger-text"
                    size="sm"
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 size={15} />
                    Delete account
                  </Button>
                </div>
              </div>
            </section>
          </>
        )
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={demo ? 'Reset demo data?' : 'Permanently delete your account?'}
        description={
          demo
            ? 'This resets both Personal and Work, removing your local demo changes and restoring the Personal sample data.'
            : 'Your JevInbox account and all stored data will be permanently removed. Your provider emails are unaffected.'
        }
        label={demo ? 'Reset demo' : 'Delete permanently'}
        onConfirm={async () => {
          await mutation.mutateAsync({
            path: '/api/user',
            method: 'DELETE',
            body: { confirm: 'DELETE' },
          });
          window.location.assign(demo ? '/' : '/signin');
        }}
      />
    </>
  );
}
function ConfidenceControl({ value, save }: { value: number; save: (value: number) => void }) {
  const [current, setCurrent] = useState(value);
  return (
    <div className="setting-row confidence-setting">
      <div>
        <label htmlFor="confidence">Minimum match probability</label>
        <p>Only notify you when a matched email reaches this level.</p>
      </div>
      <div className="range-control">
        <input
          id="confidence"
          type="range"
          min="0"
          max="100"
          value={current}
          onChange={(e) => setCurrent(Number(e.target.value))}
          onPointerUp={() => {
            if (current !== value) save(current);
          }}
          onKeyUp={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && current !== value)
              save(current);
          }}
        />
        <output htmlFor="confidence">{current}%</output>
      </div>
    </div>
  );
}
