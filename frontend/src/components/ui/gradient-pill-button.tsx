"use client";

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface GradientPillButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  loading?: boolean;
  variant?: 'pill' | 'square';
}

export const GradientPillButton = React.forwardRef<HTMLButtonElement, GradientPillButtonProps>(
  (
    {
      className,
      icon,
      loading = false,
      variant = 'pill',
      disabled,
      type = 'button',
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden bg-gradient-to-r from-[#5B4DCC] via-[#F06A8B] to-[#FFD166] font-medium text-white shadow-lg shadow-[#5B4DCC]/25 transition-[transform,box-shadow,background-color] duration-200 hover:from-[#6A5ACF] hover:via-[#F47AAC] hover:to-[#FFE08A] hover:shadow-[0_0_24px_rgba(91,77,204,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none motion-safe:active:scale-[0.98]',
          variant === 'pill'
            ? 'h-12 min-w-[180px] rounded-lg px-5 text-sm'
            : 'h-12 w-12 rounded-lg',
          className
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : variant === 'pill' && icon ? (
          <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        ) : null}

        {variant === 'pill' ? (
          <span className="truncate">{children}</span>
        ) : (
          children ?? icon
        )}
      </button>
    );
  }
);

GradientPillButton.displayName = 'GradientPillButton';
