"use client";

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, Save, Loader2 } from 'lucide-react';

interface SummaryUpdaterButtonGroupProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  hasSummary: boolean;
}

export function SummaryUpdaterButtonGroup({
  isSaving,
  isDirty,
  onSave,
  onCopy,
  hasSummary
}: SummaryUpdaterButtonGroupProps) {
  return (
    <ButtonGroup className="rounded-xl bg-card/60 p-1 shadow-sm backdrop-blur-sm">
      {/* Save button */}
      <Button
        variant={isDirty ? 'brand' : 'secondary'}
        size="sm"
        className={isDirty ? '' : 'bg-transparent shadow-none hover:bg-muted/80'}
        title={isSaving ? "Saving" : "Save Changes"}
        onClick={() => {
          onSave();
        }}
        disabled={isSaving}
      >
        {isSaving ? (
          <>
            <Loader2 className="animate-spin" />
            <span className="hidden lg:inline">Saving...</span>
          </>
        ) : (
          <>
            <Save />
            <span className="hidden lg:inline">Save</span>
          </>
        )}
      </Button>

      {/* Copy button */}
      <Button
        variant="secondary"
        size="sm"
        title="Copy Summary"
        onClick={() => {
          onCopy();
        }}
        disabled={!hasSummary}
        className="cursor-pointer bg-transparent shadow-none hover:bg-muted/80"
      >
        <Copy />
        <span className="hidden lg:inline">Copy</span>
      </Button>

    </ButtonGroup>
  );
}
