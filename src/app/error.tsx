'use client';
import { Button } from '@/components/ui/button';
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="auth-loading">
      <h1>Let’s try that again.</h1>
      <p>Your workspace couldn’t load.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
