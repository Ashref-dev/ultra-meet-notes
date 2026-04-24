import { ReactNode } from 'react';

interface MeetingGroupProps {
  label: string;
  children: ReactNode;
}

export function MeetingGroup({ label, children }: MeetingGroupProps) {
  return (
    <section className="space-y-2">
      <div className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
