import React from 'react';

import { Button } from '@/components/ui/button';

interface ConfirmationModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  text: string;
  isOpen: boolean;
}

export function ConfirmationModal({ onConfirm, onCancel, text, isOpen }: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-xl font-semibold text-foreground">Confirm Delete</h2>
        <p className="mb-6 text-sm text-muted-foreground">{text}</p>
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            onClick={onCancel}
            variant="outline"
            className="border-border bg-background text-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            variant="destructive"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
