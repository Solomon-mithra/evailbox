'use client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Copy, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useDemo } from './providers';
import { ProviderLogo } from './provider-logo';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/loader';
import { ErrorState } from './states';

type AppSettings = {
  google: { clientId: string; hasSecret: boolean; redirectUri: string };
  microsoft: { clientId: string; hasSecret: boolean; tenantId: string; redirectUri: string };
  ai: { hasKey: boolean };
};
type Patch = Partial<Record<string, string | null>>;
const demoSettings: AppSettings = {
  google: { clientId: '', hasSecret: false, redirectUri: '' },
  microsoft: { clientId: '', hasSecret: false, tenantId: 'common', redirectUri: '' },
  ai: { hasKey: false },
};

/** Bring-your-own credentials. Secrets are write-only: the API only reports whether one is saved. */
export function KeySettings() {
  const demo = useDemo(),
    client = useQueryClient();
  const query = useQuery({
    queryKey: ['app-settings'],
    queryFn: () =>
      demo ? Promise.resolve(demoSettings) : api.get<AppSettings>('/api/app-settings'),
  });
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    // Connecting without keys (or the inbox AI hint) links here with ?setup=gmail|outlook|ai.
    const setup = new URLSearchParams(window.location.search).get('setup');
    if (setup === 'gmail' || setup === 'outlook' || setup === 'ai') setOpen(setup);
  }, []);
  async function save(patch: Patch, done: string) {
    if (demo) {
      toast.info('The demo uses sample mail. Run your own copy to add keys.');
      return false;
    }
    try {
      client.setQueryData(
        ['app-settings'],
        await api.patch<AppSettings>('/api/app-settings', patch),
      );
      toast.success(done);
      return true;
    } catch (error) {
      toast.error((error as Error).message);
      return false;
    }
  }
  const settings = query.data;
  return (
    <section className="settings-section" aria-labelledby="keys-heading">
      <h2 id="keys-heading">Mail and AI keys</h2>
      <p className="section-description">
        evailbox runs on your machine, so it uses your own app registrations. Keys are encrypted and
        stay in this server&apos;s database.
      </p>
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError || !settings ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <div className="settings-card">
          <KeyRow
            id="gmail"
            open={open === 'gmail'}
            onToggle={(next) => setOpen(next ? 'gmail' : null)}
            icon={<ProviderLogo provider="GMAIL" />}
            title="Google (Gmail)"
            ready={!!settings.google.clientId && settings.google.hasSecret}
          >
            <ol className="key-steps">
              <li>
                In{' '}
                <ExternalLink href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">
                  Google Cloud
                </ExternalLink>
                , enable the Gmail API for a project.
              </li>
              <li>
                Under{' '}
                <ExternalLink href="https://console.cloud.google.com/apis/credentials">
                  Credentials
                </ExternalLink>
                , create an OAuth client ID of type <em>Web application</em> and add this redirect
                URI:
                <CopyField value={settings.google.redirectUri} />
              </li>
              <li>
                On the OAuth consent screen, add the Google accounts you&apos;ll connect as test
                users.
              </li>
              <li>Paste the client ID and secret below.</li>
            </ol>
            <ClientForm
              idLabel="Client ID"
              clientId={settings.google.clientId}
              hasSecret={settings.google.hasSecret}
              onSave={(patch) =>
                save(
                  { googleClientId: patch.clientId, googleClientSecret: patch.secret },
                  'Google keys saved',
                )
              }
            />
          </KeyRow>
          <KeyRow
            id="outlook"
            open={open === 'outlook'}
            onToggle={(next) => setOpen(next ? 'outlook' : null)}
            icon={<ProviderLogo provider="OUTLOOK" />}
            title="Microsoft (Outlook)"
            ready={!!settings.microsoft.clientId && settings.microsoft.hasSecret}
          >
            <ol className="key-steps">
              <li>
                In{' '}
                <ExternalLink href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">
                  App registrations
                </ExternalLink>
                , create a registration for accounts in any organization and personal Microsoft
                accounts.
              </li>
              <li>
                Add a <em>Web</em> redirect URI:
                <CopyField value={settings.microsoft.redirectUri} />
              </li>
              <li>
                Under API permissions, add the Microsoft Graph delegated permissions Mail.ReadWrite,
                Mail.Send, User.Read and offline_access.
              </li>
              <li>
                Create a client secret, then paste its value and the application (client) ID below.
              </li>
            </ol>
            <ClientForm
              idLabel="Application (client) ID"
              clientId={settings.microsoft.clientId}
              hasSecret={settings.microsoft.hasSecret}
              tenantId={settings.microsoft.tenantId}
              onSave={(patch) =>
                save(
                  {
                    microsoftClientId: patch.clientId,
                    microsoftClientSecret: patch.secret,
                    microsoftTenantId: patch.tenantId,
                  },
                  'Microsoft keys saved',
                )
              }
            />
          </KeyRow>
          <KeyRow
            id="ai"
            open={open === 'ai'}
            onToggle={(next) => setOpen(next ? 'ai' : null)}
            icon={
              <span className="key-icon">
                <Sparkles size={16} />
              </span>
            }
            title="AI tagging"
            ready={settings.ai.hasKey}
            idle="Off until a key is added"
          >
            <p className="key-note">
              Tags are checked by the Jev model through{' '}
              <ExternalLink href="https://vercel.com/docs/ai-gateway">
                Vercel AI Gateway
              </ExternalLink>
              , billed to your Vercel account. Without a key, mail still syncs and you can read,
              reply and archive; tags just won&apos;t match anything.
            </p>
            <SecretForm
              label="AI Gateway API key"
              hasSecret={settings.ai.hasKey}
              onSave={(value) =>
                save({ jevApiKey: value }, value ? 'AI key saved' : 'AI key removed')
              }
            />
          </KeyRow>
        </div>
      )}
    </section>
  );
}

function KeyRow({
  id,
  open,
  onToggle,
  icon,
  title,
  ready,
  idle = 'Needs keys',
  children,
}: {
  id: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  icon: ReactNode;
  title: string;
  ready: boolean;
  idle?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (open && new URLSearchParams(window.location.search).get('setup') === id)
      ref.current?.scrollIntoView({ block: 'start' });
  }, [open, id]);
  return (
    <details
      ref={ref}
      className="key-row"
      id={`keys-${id}`}
      open={open}
      onToggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        {icon}
        <strong>{title}</strong>
        <span className={ready ? 'key-status key-status-ready' : 'key-status'}>
          {ready && <Check size={13} aria-hidden />}
          {ready ? 'Ready' : idle}
        </span>
        <ChevronDown className="key-chevron" size={16} aria-hidden />
      </summary>
      <div className="key-body">{children}</div>
    </details>
  );
}

function ClientForm({
  idLabel,
  clientId,
  hasSecret,
  tenantId,
  onSave,
}: {
  idLabel: string;
  clientId: string;
  hasSecret: boolean;
  tenantId?: string;
  onSave: (patch: { clientId: string; secret?: string; tenantId?: string }) => Promise<boolean>;
}) {
  const [id, setId] = useState(clientId),
    [secret, setSecret] = useState(''),
    [tenant, setTenant] = useState(tenantId ?? ''),
    [busy, setBusy] = useState(false);
  const changed =
    id.trim() !== clientId || !!secret.trim() || (tenantId !== undefined && tenant !== tenantId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const saved = await onSave({
      clientId: id.trim(),
      ...(secret.trim() ? { secret: secret.trim() } : {}),
      ...(tenantId !== undefined ? { tenantId: tenant.trim() || 'common' } : {}),
    });
    setBusy(false);
    if (saved) setSecret('');
  }
  return (
    <form className="key-form" onSubmit={submit}>
      <label>
        {idLabel}
        <Input
          value={id}
          onChange={(event) => setId(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <label>
        Client secret
        <Input
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder={hasSecret ? 'Saved. Enter a new secret to replace it.' : ''}
          autoComplete="new-password"
          required={!hasSecret}
        />
      </label>
      {tenantId !== undefined && (
        <label>
          Tenant
          <Input
            value={tenant}
            onChange={(event) => setTenant(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <small className="field-hint">
            Keep <em>common</em> for personal and work accounts, or enter your organization&apos;s
            tenant ID.
          </small>
        </label>
      )}
      <Button type="submit" size="sm" disabled={busy || !changed}>
        {busy ? 'Saving…' : 'Save keys'}
      </Button>
    </form>
  );
}

function SecretForm({
  label,
  hasSecret,
  onSave,
}: {
  label: string;
  hasSecret: boolean;
  onSave: (value: string | null) => Promise<boolean>;
}) {
  const [value, setValue] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(next: string | null) {
    setBusy(true);
    if (await onSave(next)) setValue('');
    setBusy(false);
  }
  return (
    <form
      className="key-form"
      onSubmit={(event) => {
        event.preventDefault();
        void run(value.trim());
      }}
    >
      <label>
        {label}
        <Input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={hasSecret ? 'Saved. Enter a new key to replace it.' : ''}
          autoComplete="new-password"
          required
        />
      </label>
      <div className="key-actions">
        <Button type="submit" size="sm" disabled={busy || !value.trim()}>
          {busy ? 'Saving…' : 'Save key'}
        </Button>
        {hasSecret && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run(null)}
          >
            Remove key
          </Button>
        )}
      </div>
    </form>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-field">
      <code>{value || 'Shown when running your own copy'}</code>
      <button
        type="button"
        className="icon-button"
        aria-label={copied ? 'Copied' : 'Copy redirect URI'}
        title={copied ? 'Copied' : 'Copy'}
        disabled={!value}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </span>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="text-link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
