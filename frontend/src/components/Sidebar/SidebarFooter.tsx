import { Globe, Home, Mic, Settings, Square, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface SidebarFooterProps {
  isRecording: boolean;
  onHomeClick: () => void;
  onImportClick?: () => void;
  onLanguageClick: () => void;
  onRecordClick: () => void;
  onSettingsClick: () => void;
  version: string;
}

export function SidebarFooter({
  isRecording,
  onHomeClick,
  onImportClick,
  onLanguageClick,
  onRecordClick,
  onSettingsClick,
  version,
}: SidebarFooterProps) {
  return (
    <div className="border-t border-border px-3 pb-3 pt-3">
      <div className="space-y-2">
        <Button
          type="button"
          variant={isRecording ? 'destructive' : 'brand'}
          onClick={onRecordClick}
          disabled={isRecording}
          className="h-11 w-full justify-center rounded-xl px-4 shadow-sm"
        >
          {isRecording ? <Square className="size-4" /> : <Mic className="size-4" />}
          <span className="truncate">{isRecording ? 'Recording...' : 'Start Recording'}</span>
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onHomeClick}
            className="h-10 w-full justify-center rounded-xl bg-muted/70 px-3 text-foreground shadow-sm hover:bg-muted/80"
            title="Home"
          >
            <Home className="size-4" />
            <span className="truncate text-[12px]">Home</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={onLanguageClick}
            className="h-10 w-full justify-center rounded-xl bg-muted/70 px-3 text-foreground shadow-sm hover:bg-muted/80"
            title="Language Settings"
          >
            <Globe className="size-4" />
            <span className="truncate text-[12px]">Language</span>
          </Button>

          {onImportClick ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onImportClick}
               className="h-10 w-full justify-center rounded-xl bg-muted/70 px-3 text-foreground shadow-sm hover:bg-muted/80"
              title="Import Audio"
            >
              <Upload className="size-4" />
              <span className="truncate text-[12px]">Import</span>
            </Button>
          ) : <div />}

          <Button
            type="button"
            variant="secondary"
            onClick={onSettingsClick}
            className="h-10 w-full justify-center rounded-xl bg-muted/70 px-3 text-foreground shadow-sm hover:bg-muted/80"
            title="Settings"
          >
            <Settings className="size-4" />
            <span className="truncate text-[12px]">Settings</span>
          </Button>
        </div>

        <div className="pt-0.5 text-right text-[10px] font-medium text-muted-foreground/70">
          {version}
        </div>
      </div>
    </div>
  );
}
