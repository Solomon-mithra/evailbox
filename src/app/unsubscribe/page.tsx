'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
export default function Page() {
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <main className="auth-loading" id="main-content">
      <h1>Daily digest preferences</h1>
      <p>Stop receiving daily JevInbox summaries.</p>
      <Button
        disabled={busy || status === 'You’re unsubscribed.'}
        onClick={async () => {
          setBusy(true);
          try {
            const token = new URLSearchParams(window.location.search).get('token');
            await api.post('/api/unsubscribe', { token });
            setStatus('You’re unsubscribed.');
          } catch {
            setStatus('This link is invalid or the request failed. Please try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Unsubscribe
      </Button>
      <p role="status">{status}</p>
    </main>
  );
}
