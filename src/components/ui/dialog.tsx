'use client';
import { Dialog as Primitive } from 'radix-ui';
import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  className = '',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content
          className={`dialog-content ${wide ? 'dialog-wide' : ''} ${className}`}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            // These controlled dialogs open from lists and menus, without a Dialog.Trigger.
            event.preventDefault();
            const target = returnFocus.current;
            if (target?.isConnected && target !== document.body) target.focus();
            else document.getElementById('main-content')?.focus();
          }}
        >
          <div className="dialog-heading">
            <div>
              <Primitive.Title>{title}</Primitive.Title>
              <Primitive.Description>
                {description ?? 'Review and update this item.'}
              </Primitive.Description>
            </div>
            <Primitive.Close className="icon-button" aria-label="Close dialog">
              <X size={20} />
            </Primitive.Close>
          </div>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
