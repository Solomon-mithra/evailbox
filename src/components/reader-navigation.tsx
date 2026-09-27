'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactNode,
} from 'react';

type NavigationGuard = () => Promise<boolean>;
const Context = createContext<{
  register: (handler: NavigationGuard) => () => void;
  beforeNavigate: NavigationGuard;
}>({ register: () => () => {}, beforeNavigate: async () => true });

export function ReaderNavigationProvider({ children }: { children: ReactNode }) {
  const handler = useRef<NavigationGuard | null>(null);
  const register = useCallback((next: NavigationGuard) => {
    handler.current = next;
    return () => {
      if (handler.current === next) handler.current = null;
    };
  }, []);
  const beforeNavigate = useCallback(async () => (await handler.current?.()) ?? true, []);
  const value = useMemo(() => ({ register, beforeNavigate }), [register, beforeNavigate]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useReaderNavigation = () => useContext(Context);

export function ReaderLink({
  href,
  onNavigate,
  replace,
  scroll,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & {
  href: string;
  onNavigate?: () => void;
}) {
  const { beforeNavigate } = useReaderNavigation();
  const router = useRouter();
  return (
    <Link
      {...props}
      href={href}
      replace={replace}
      scroll={scroll}
      onNavigate={async (event) => {
        // Next invokes this only for same-tab navigation, preserving modified
        // clicks and normal Link prefetching. Cancel before awaiting the save.
        event.preventDefault();
        if (!(await beforeNavigate())) return;
        onNavigate?.();
        if (replace) router.replace(href, { scroll });
        else router.push(href, { scroll });
      }}
    />
  );
}
