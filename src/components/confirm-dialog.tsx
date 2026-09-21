'use client';
import { useState } from 'react';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Loader } from './ui/loader';
import { toast } from 'sonner';
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  label = 'Delete',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  label?: string;
  onConfirm: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
      title={title}
      description={description}
    >
      <div className="dialog-actions">
        <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onOpenChange(false);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not complete this action.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader />}
          {label}
        </Button>
      </div>
    </Dialog>
  );
}
