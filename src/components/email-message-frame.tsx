'use client';

import { useEffect, useRef, useState } from 'react';

const initialHeight = 320;
const minimumHeight = 48;
const maximumHeight = 24_000;

export function readEmailFrameHeight(
  event: Pick<MessageEvent<unknown>, 'source' | 'data'>,
  frameWindow: Window | null,
): number | null {
  // Sandboxed srcDoc has the opaque origin "null", so trust its window identity,
  // never a shared origin string or a message from a sibling email frame.
  if (!frameWindow || event.source !== frameWindow) return null;
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return null;
  const data = event.data as { type?: unknown; height?: unknown };
  if (
    data.type !== 'evailbox:email-height' ||
    typeof data.height !== 'number' ||
    !Number.isFinite(data.height) ||
    data.height <= 0
  ) {
    return null;
  }
  return Math.min(maximumHeight, Math.max(minimumHeight, Math.ceil(data.height)));
}

export function EmailMessageFrame({
  html,
  title = 'Email message',
}: {
  html: string;
  title?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [measurement, setMeasurement] = useState<{ html: string; height: number } | null>(null);
  const height = measurement?.html === html ? measurement.height : initialHeight;

  useEffect(() => {
    const resize = (event: MessageEvent<unknown>) => {
      const height = readEmailFrameHeight(event, frame.current?.contentWindow ?? null);
      if (height !== null) {
        setMeasurement((current) =>
          current?.html === html && current.height === height ? current : { html, height },
        );
      }
    };
    window.addEventListener('message', resize);
    frame.current?.contentWindow?.postMessage({ type: 'evailbox:measure-email' }, '*');
    return () => window.removeEventListener('message', resize);
  }, [html]);

  return (
    <iframe
      key={html}
      ref={frame}
      className="email-message-frame"
      title={title}
      srcDoc={html}
      style={{ height }}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      onLoad={() => {
        frame.current?.contentWindow?.postMessage({ type: 'evailbox:measure-email' }, '*');
      }}
    />
  );
}
