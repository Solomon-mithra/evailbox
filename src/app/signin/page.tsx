'use client';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signIn } from '@/hooks/useAuth';
import { BrandMark } from '@/components/brand-mark';
/** Only reachable when APP_PASSWORD is set; otherwise the proxy sends visitors to the inbox. */
export default function Page() {
  const [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <main className="signin-page" id="main-content">
      <span className="brand">
        <span className="brand-mark">
          <BrandMark size={34} />
        </span>
        evailbox
      </span>
      <div className="signin-card">
        <span className="signin-symbol">
          <BrandMark size={48} />
        </span>
        <h1>Make room for what matters.</h1>
        <p>This inbox is password protected. Enter the password set in APP_PASSWORD.</p>
        <form
          className="signin-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              await signIn(password);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <label htmlFor="password" className="sr-only">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'signin-error' : undefined}
            autoFocus
            required
          />
          <Button type="submit" disabled={busy || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        {error && (
          <p className="field-error" id="signin-error" role="alert">
            {error}
          </p>
        )}
        <div className="signin-privacy">
          <ShieldCheck size={15} />
          Your mail and keys stay on this server.
        </div>
      </div>
      <footer>evailbox · Self-hosted email triage</footer>
    </main>
  );
}
