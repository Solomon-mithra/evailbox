'use client';
import { DropdownMenu } from 'radix-ui';
import { BriefcaseBusiness, UserRound, ChevronsUpDown, Check } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useWorkspaceSelection } from './workspace-selection';
import { workspaceIds, workspaceNames, type WorkspaceId } from '@/lib/workspace-selection';

export function WorkspaceSwitcher({ onSwitch }: { onSwitch?: () => void }) {
  const { workspace, name, select } = useWorkspaceSelection();
  const router = useRouter();
  const pathname = usePathname();
  const Icon = workspace === 'WORK' ? BriefcaseBusiness : UserRound;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="workspace-switcher"
        aria-label={'Change workspace, current workspace: ' + name}
      >
        <span className="workspace-switcher-icon">
          <Icon size={17} />
        </span>
        <span>
          <strong>{name}</strong>
          <small>Workspace</small>
        </span>
        <ChevronsUpDown size={15} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="dropdown-content workspace-menu"
          align="start"
          sideOffset={6}
        >
          <DropdownMenu.Label>Switch workspace</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={workspace}
            onValueChange={(value) => {
              if (value !== workspace) {
                const url = new URL(window.location.href);
                url.searchParams.delete('email');
                window.history.replaceState(null, '', url.pathname + url.search);
                select(value as WorkspaceId);
                if (pathname.startsWith('/tags/')) router.push('/tags');
              }
              onSwitch?.();
            }}
          >
            {workspaceIds.map((id) => {
              const WorkspaceIcon = id === 'WORK' ? BriefcaseBusiness : UserRound;
              return (
                <DropdownMenu.RadioItem key={id} value={id}>
                  <WorkspaceIcon size={17} />
                  <span>{workspaceNames[id]}</span>
                  <DropdownMenu.ItemIndicator>
                    <Check size={16} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
          <p>Separate accounts, emails, and tags.</p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
