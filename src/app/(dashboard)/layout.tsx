import { redirect } from 'next/navigation';
import { WorkspaceShell } from '@/components/workspace-shell';
import { SessionIdentity } from '@/components/providers';
import { getShellUser } from '@/lib/auth';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getShellUser();
  if (!user) redirect('/signin');
  return (
    <SessionIdentity user={user}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </SessionIdentity>
  );
}
