'use client';

import { LoaderCircle, SearchIcon, X } from 'lucide-react';

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';

interface SidebarSearchProps {
  value: string;
  onChange: (value: string) => void;
  isSearching: boolean;
}

export function SidebarSearch({ value, onChange, isSearching }: SidebarSearchProps) {
  return (
    <div className="space-y-2">
      <label htmlFor="sidebar-search" className="text-xs font-medium text-muted-foreground">
        Search
      </label>

      <InputGroup className="rounded-xl border-border bg-card shadow-sm">
        <InputGroupAddon>
          {isSearching ? <LoaderCircle className="animate-spin" /> : <SearchIcon />}
        </InputGroupAddon>

        <InputGroupInput
          id="sidebar-search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search meeting content..."
          className="text-sm text-foreground"
        />

        {value ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={() => onChange('')} aria-label="Clear search">
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}
