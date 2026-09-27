'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Email } from '@/types';

/** Keep the list mounted so returning to it preserves filters, scroll and focus. */
export function useEmailReader() {
  const [selected, setSelected] = useState<Email | null>(null);
  const origin = useRef<{ scrollY: number; element: HTMLElement | null } | null>(null);
  const open = useCallback((email: Email) => {
    origin.current = {
      scrollY: window.scrollY,
      element: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    setSelected(email);
  }, []);
  const close = useCallback(() => setSelected(null), []);

  useLayoutEffect(() => {
    if (selected) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.querySelector<HTMLElement>('.email-reader-title')?.focus({ preventScroll: true });
    } else if (origin.current) {
      const { element, scrollY } = origin.current;
      origin.current = null;
      if (element?.isConnected && element !== document.body) element.focus({ preventScroll: true });
      else document.getElementById('main-content')?.focus({ preventScroll: true });
      window.scrollTo({ top: scrollY, behavior: 'instant' });
    }
  }, [selected]);

  return { selected, open, close };
}
