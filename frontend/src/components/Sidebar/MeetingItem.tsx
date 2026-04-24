'use client';

import { Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MeetingItemProps {
  title: string;
  dateLabel: string;
  durationLabel?: string;
  matchSnippet?: string | null;
  isActive: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function MeetingItem({
  title,
  dateLabel,
  durationLabel,
  matchSnippet,
  isActive,
  onSelect,
  onEdit,
  onDelete,
}: MeetingItemProps) {
  const metaParts = [dateLabel, durationLabel].filter(Boolean);
  const metaLabel = metaParts.join(' • ');

  return (
    // biome-ignore lint/a11y/useSemanticElements: requested non-button wrapper avoids invalid nested buttons while preserving keyboard access
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group relative block w-full overflow-hidden rounded-xl bg-card/60 px-2.5 py-2 text-left shadow-sm backdrop-blur-sm outline-none transition-[background-color,box-shadow] focus-visible:ring-1 focus-visible:ring-ring',
        isActive
          ? 'meeting-item-active-ring bg-gradient-to-r from-[#5B4DCC]/10 to-[#FFD166]/10 shadow-md'
          : 'hover:bg-card/80 hover:shadow-md'
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      <div className="relative z-10 flex min-w-0 flex-col gap-0.5">
        <div className="min-w-0">
          <p
            title={title}
            className="break-words [overflow-wrap:anywhere] pr-2 text-[12px] font-medium leading-[16px] text-foreground"
          >
            {title}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p
            className="min-w-0 truncate text-[11px] leading-4 text-muted-foreground"
            title={metaLabel || undefined}
          >
            {metaLabel}
          </p>

          <div className="ml-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
              className="size-5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Edit meeting title"
            >
              <Pencil className="size-3" />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="size-5 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete meeting"
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>

        {matchSnippet ? (
          <p
            className="line-clamp-1 text-[11px] leading-4 text-muted-foreground"
            title={matchSnippet}
          >
            {matchSnippet}
          </p>
        ) : null}
      </div>
    </div>
  );
}
