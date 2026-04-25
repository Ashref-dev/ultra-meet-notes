import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertCircle, Download, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { UpdateInfo } from '@/services/updateService';

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateInfo | null;
}

export function UpdateDialog({ open, onOpenChange, updateInfo }: UpdateDialogProps) {
  const handleOpenRelease = async () => {
    if (!updateInfo?.downloadUrl) {
      return;
    }

    try {
      await invoke('open_external_url', { url: updateInfo.downloadUrl });
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to open release URL:', error);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  if (!updateInfo?.available) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-accent" />
            Update Available
          </DialogTitle>
          <DialogDescription>
            {`A new version (${updateInfo.version}) is available`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Current Version:</span>
              <span className="font-medium">{updateInfo.currentVersion}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">New Version:</span>
              <span className="font-medium text-accent">{updateInfo.version}</span>
            </div>
            {updateInfo.date && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Release Date:</span>
                <span className="font-medium">{formatDate(updateInfo.date)}</span>
              </div>
            )}
          </div>

          {updateInfo.body ? (
            <div className="max-h-40 overflow-y-auto rounded-lg bg-muted p-3">
              <p className="whitespace-pre-wrap text-sm text-foreground">{updateInfo.body}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>No release notes were included with this update.</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Later
          </Button>
          <Button onClick={handleOpenRelease} className="bg-accent text-accent-foreground hover:bg-accent/90">
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
