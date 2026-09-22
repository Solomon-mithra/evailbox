'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useDemo } from '@/components/providers';
import { signIn } from '@/hooks/useAuth';
import { BrandMark } from '@/components/brand-mark';
export default function Page() {
  const demo = useDemo(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('error'))
      setError('Google sign-in could not finish. Please try again.');
  }, []);
  return (
    <main className="signin-page" id="main-content">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <BrandMark size={34} />
        </span>
        evailbox
      </Link>
      <div className="signin-card">
        <span className="signin-symbol">
          <BrandMark size={48} />
        </span>
        <h1>Make room for what matters.</h1>
        <p>
          Bring Gmail and Outlook together.
          <br />
          Let your priorities lead the way.
        </p>
        {demo ? (
          <>
            <Button asChild>
              <Link href="/inbox">
                Open inbox
                <ArrowRight size={17} />
              </Link>
            </Button>
            <small>Sample emails. No account required.</small>
          </>
        ) : (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await signIn();
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? 'Connecting…' : 'Continue with Google'}
          </Button>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="signin-privacy">
          <ShieldCheck size={15} />
          Your email stays private and in your control.
        </div>
      </div>
      <footer>evailbox · Email, on your terms.</footer>
    </main>
  );
}
