'use client';

import { PanelLeft } from 'lucide-react';

import Logo from '@/components/Logo';
import { Wordmark } from '@/components/Wordmark';

import { useSidebar } from './SidebarProvider';

export function SidebarHeader() {
  const { isCollapsed, toggleCollapse: toggleSidebar } = useSidebar();

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
        className="flex items-center justify-center w-full p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
      >
        <PanelLeft className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="flex min-h-11 items-center gap-2.5 rounded-xl bg-card/60 px-3 py-2 shadow-sm backdrop-blur-sm">
      <Logo size={28} />
      <Wordmark height={28} className="text-foreground" />
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Collapse sidebar"
        className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <PanelLeft className="h-5 w-5" />
      </button>
    </div>
  );
}
