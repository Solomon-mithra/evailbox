import { redirect } from 'next/navigation';
import { WorkspaceShell } from '@/components/workspace-shell';
import { SessionIdentity } from '@/components/providers';
import { getShellUser } from '@/lib/auth';
import { currentModelVersion } from '@/lib/classification-version';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getShellUser();
  if (!user) redirect('/signin');
  return (
    <SessionIdentity user={user} cacheVersion={currentModelVersion()}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </SessionIdentity>
  );
}
