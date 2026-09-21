'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader } from '@/components/ui/loader';
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return (
    <main className="auth-loading">
      <Loader />
      <p>Opening your workspace…</p>
    </main>
  );
}
