import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReaderLink,
  ReaderNavigationProvider,
  useReaderNavigation,
} from '@/components/reader-navigation';
import { Navigation } from '@/components/navigation';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';

type LinkProps = {
  href: string;
  children: ReactNode;
  onNavigate?: (event: { preventDefault: () => void }) => Promise<void>;
};
type SwitchProps = { children: ReactNode; onValueChange: (value: string) => Promise<void> };
const state = vi.hoisted(() => ({
  links: [] as LinkProps[],
  switches: [] as SwitchProps[],
  pathname: '/inbox',
  demo: false,
  push: vi.fn(),
  replace: vi.fn(),
  select: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  info: vi.fn(),
  error: vi.fn(),
  signOutClick: undefined as (() => Promise<void>) | undefined,
}));

vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react/jsx-dev-runtime')>();
  const jsxDEV: typeof actual.jsxDEV = (...args) => {
    const [type, props] = args;
    if (
      type === 'button' &&
      props &&
      typeof props === 'object' &&
      'aria-label' in props &&
      props['aria-label'] === 'Sign out' &&
      'onClick' in props &&
      typeof props.onClick === 'function'
    ) {
      state.signOutClick = props.onClick as () => Promise<void>;
    }
    return actual.jsxDEV(...args);
  };
  return { ...actual, jsxDEV };
});

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: state.push, replace: state.replace }),
}));
vi.mock('next/link', () => ({
  default: (props: LinkProps) => {
    state.links.push(props);
    return React.createElement('a', { href: props.href }, props.children);
  },
}));
vi.mock('@/components/providers', () => ({
  useDemo: () => state.demo,
  useSessionIdentity: () => ({ id: 'u', email: 'owner@localhost', canSignOut: true }),
}));
vi.mock('@/hooks/useFetch', () => ({
  useWorkspaceMetadata: () => ({
    data: {
      user: { email: 'reader@example.com' },
      tags: [{ id: 'bank', name: 'Banking', priority: 'HIGH' }],
    },
  }),
  useInboxCounts: () => ({ data: { needsTotal: 0 } }),
}));
vi.mock('@/hooks/useAuth', () => ({ signOut: () => state.signOut() }));
vi.mock('sonner', () => ({ toast: { info: state.info, error: state.error } }));
vi.mock('@/components/workspace-selection', () => ({
  useWorkspaceSelection: () => ({ workspace: 'PERSONAL', name: 'Personal', select: state.select }),
}));
vi.mock('radix-ui', () => {
  const children = ({ children }: { children?: ReactNode }) => children;
  return {
    Dialog: Object.fromEntries(
      ['Root', 'Trigger', 'Portal', 'Overlay', 'Content', 'Title', 'Close'].map((key) => [
        key,
        children,
      ]),
    ),
    DropdownMenu: {
      ...Object.fromEntries(
        ['Root', 'Trigger', 'Portal', 'Content', 'Label', 'RadioItem', 'ItemIndicator'].map(
          (key) => [key, children],
        ),
      ),
      RadioGroup: (props: SwitchProps) => {
        state.switches.push(props);
        return props.children;
      },
    },
  };
});

let guard: ReturnType<typeof useReaderNavigation>;
const replaceState = vi.fn();
const captureGuard = (value: typeof guard) => {
  guard = value;
};

function CaptureGuard({ capture }: { capture: typeof captureGuard }) {
  capture(useReaderNavigation());
  return null;
}
function render(children?: ReactNode) {
  return renderToStaticMarkup(
    React.createElement(
      ReaderNavigationProvider,
      null,
      React.createElement(CaptureGuard, { capture: captureGuard }),
      children,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.links = [];
  state.switches = [];
  state.pathname = '/inbox';
  state.demo = false;
  state.signOutClick = undefined;
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', {
    location: { href: 'https://evailbox.com/inbox?email=mail' },
    history: { replaceState },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reader navigation registration', () => {
  it('allows navigation without a provider or registered reader', async () => {
    renderToStaticMarkup(React.createElement(CaptureGuard, { capture: captureGuard }));
    expect(await guard.beforeNavigate()).toBe(true);
    render();
    expect(await guard.beforeNavigate()).toBe(true);
  });

  it('does not let old registration cleanup clear the current reader guard', async () => {
    render();
    const removeOld = guard.register(async () => true);
    const current = vi.fn().mockResolvedValue(false);
    const removeCurrent = guard.register(current);
    removeOld();
    expect(await guard.beforeNavigate()).toBe(false);
    expect(current).toHaveBeenCalledOnce();
    removeCurrent();
    expect(await guard.beforeNavigate()).toBe(true);
  });
});

describe('guarded links', () => {
  it('prevents every desktop and mobile navigation link when the reader save fails', async () => {
    render(React.createElement(Navigation));
    guard.register(async () => false);
    expect(state.links.map(({ href }) => href)).toEqual(
      expect.arrayContaining([
        '/inbox',
        '/tags',
        '/drafts',
        '/accounts',
        '/settings',
        '/tags/bank',
      ]),
    );
    expect(state.links.length).toBeGreaterThan(12);
    for (const link of state.links) {
      const preventDefault = vi.fn();
      expect(link.onNavigate).toBeTypeOf('function');
      await link.onNavigate!({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    }
    expect(state.push).not.toHaveBeenCalled();
  });

  it('waits for saving before same-URL navigation and mobile menu dismissal', async () => {
    const onNavigate = vi.fn();
    render(React.createElement(ReaderLink, { href: '/inbox', onNavigate }, 'Inbox'));
    let finishSave!: (saved: boolean) => void;
    const saved = new Promise<boolean>((resolve) => {
      finishSave = resolve;
    });
    guard.register(() => saved);
    const preventDefault = vi.fn();
    const navigating = state.links[0].onNavigate!({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(state.push).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    finishSave(true);
    await navigating;
    expect(state.push).toHaveBeenCalledWith('/inbox', { scroll: undefined });
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});

describe('workspace switching', () => {
  it('preserves the URL, selected workspace, and menu when saving fails', async () => {
    const onSwitch = vi.fn();
    render(React.createElement(WorkspaceSwitcher, { onSwitch }));
    guard.register(async () => false);
    await state.switches[0].onValueChange('WORK');
    expect(replaceState).not.toHaveBeenCalled();
    expect(state.select).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('waits for saving before changing the URL, workspace, tag route, or menu', async () => {
    state.pathname = '/tags/bank';
    const onSwitch = vi.fn();
    render(React.createElement(WorkspaceSwitcher, { onSwitch }));
    let finishSave!: (saved: boolean) => void;
    guard.register(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve;
        }),
    );
    const switching = state.switches[0].onValueChange('WORK');
    expect(replaceState).not.toHaveBeenCalled();
    expect(state.select).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
    finishSave(true);
    await switching;
    expect(replaceState).toHaveBeenCalledWith(null, '', '/inbox');
    expect(state.select).toHaveBeenCalledWith('WORK');
    expect(state.push).toHaveBeenCalledWith('/tags');
    expect(onSwitch).toHaveBeenCalledOnce();
  });
});

it('keeps the session signed in when the reader cannot save', async () => {
  render(React.createElement(Navigation));
  guard.register(async () => false);
  expect(state.signOutClick).toBeTypeOf('function');
  await state.signOutClick!();
  expect(state.signOut).not.toHaveBeenCalled();
});

it('keeps demo sign-out informational after a successful guard', async () => {
  state.demo = true;
  render(React.createElement(Navigation));
  guard.register(async () => true);
  await state.signOutClick!();
  expect(state.signOut).not.toHaveBeenCalled();
  expect(state.info).toHaveBeenCalledOnce();
});
