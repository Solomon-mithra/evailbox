'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Inbox, Tags, Layers2, Settings2, LogOut, Menu, X, Plus, ArrowUpRight } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useFetch';
import { useDemo } from './providers';
import { signOut } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { WorkspaceSwitcher } from './workspace-switcher';

const links = [
  { href: '/', label: 'Inbox', icon: Inbox },
  { href: '/tags', label: 'Tags', icon: Tags },
  { href: '/accounts', label: 'Accounts', icon: Layers2 },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

function NavigationContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const demo = useDemo();
  const { data } = useWorkspace();
  const needs =
    data?.needsTotal ??
    data?.emails.filter(
      (email) =>
        !email.handled &&
        !email.isRead &&
        email.classifications.some((c) => c.matched && c.tag.priority === 'HIGH'),
    ).length ??
    0;

  return (
    <>
      <Link href="/" className="brand" onClick={onNavigate}>
        <span className="brand-mark">
          <Layers2 size={21} strokeWidth={1.7} />
        </span>
        JevInbox
      </Link>
      <WorkspaceSwitcher onSwitch={onNavigate} />
      <div className="sidebar-scroll">
        <nav aria-label="Main navigation">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`nav-link ${active ? 'active' : ''}`}
              >
                <Icon size={19} strokeWidth={1.7} />
                <span>{label}</span>
                {href === '/' && needs > 0 && <span className="nav-count">{needs}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-section-label">
          Your tags
          <Link href="/tags" className="icon-button" aria-label="Manage tags" onClick={onNavigate}>
            <Plus size={16} />
          </Link>
        </div>
        <nav aria-label="Tags">
          {data?.tags.map((tag) => (
            <Link
              href={`/tags/${tag.id}`}
              key={tag.id}
              aria-current={pathname === `/tags/${tag.id}` ? 'page' : undefined}
              className={`nav-tag ${pathname === `/tags/${tag.id}` ? 'active' : ''}`}
              onClick={onNavigate}
            >
              <span className={`tag-dot dot-${tag.priority.toLowerCase()}`} />
              <span>{tag.name}</span>
            </Link>
          ))}
          {!data?.tags.length && <p className="sidebar-hint">Your tags will appear here.</p>}
        </nav>
      </div>
      <div className="sidebar-bottom">
        <a
          className="sidebar-help"
          href="https://vercel.com/i/what-is-jev"
          target="_blank"
          rel="noreferrer"
        >
          About Jev
          <ArrowUpRight size={14} />
        </a>
        <div className="profile">
          <span className="profile-avatar">
            {data?.user.email.slice(0, 1).toUpperCase() ?? 'J'}
          </span>
          <div>
            <strong>
              {demo ? 'Alex Morgan' : (data?.user.email.split('@')[0] ?? 'Your account')}
            </strong>
            <small>{data?.user.email ?? 'Loading account…'}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() =>
              demo
                ? toast.info('This is a demo workspace. No account is signed in.')
                : void signOut().catch((e) => toast.error(e.message))
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </>
  );
}

export function Navigation() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 801px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <>
      <aside className="sidebar desktop-sidebar">
        <NavigationContent />
      </aside>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <header className="mobile-bar">
          <Link href="/" className="brand">
            <span className="brand-mark">
              <Layers2 size={20} strokeWidth={1.7} />
            </span>
            JevInbox
          </Link>
          <Dialog.Trigger className="icon-button" aria-label="Open navigation">
            <Menu size={21} />
          </Dialog.Trigger>
        </header>
        <Dialog.Portal>
          <Dialog.Overlay className="sidebar-backdrop" />
          <Dialog.Content className="sidebar mobile-sidebar" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Workspace navigation</Dialog.Title>
            <Dialog.Close className="icon-button sidebar-close" aria-label="Close navigation">
              <X size={20} />
            </Dialog.Close>
            <NavigationContent onNavigate={() => setOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
