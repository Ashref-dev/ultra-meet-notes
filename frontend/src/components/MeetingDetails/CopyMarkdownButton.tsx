"use client";

import { Copy, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface CopyMarkdownButtonProps {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  title?: string;
}

export function CopyMarkdownButton({
  onClick,
  disabled = false,
  isLoading = false,
  title,
}: CopyMarkdownButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        void onClick();
      }}
      disabled={disabled || isLoading}
      title={title}
      className="h-9 rounded-lg bg-card/60 backdrop-blur-sm shadow-sm px-4 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-card/80 transition-colors"
    >
      {isLoading ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Copy className="mr-1.5 h-3.5 w-3.5" />
      )}
      {isLoading ? 'Copying…' : 'Copy as Markdown'}
    </Button>
  );
}
