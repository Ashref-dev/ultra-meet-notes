'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Database, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HomebrewDatabaseDetectorProps {
  onImportSuccess: () => void;
  onDecline: () => void;
}

// Homebrew paths differ between Intel and Apple Silicon Macs
const HOMEBREW_PATHS = [
  '/opt/homebrew/var/meetily/meeting_minutes.db',  // Apple Silicon (M1/M2/M3)
  '/usr/local/var/meetily/meeting_minutes.db',      // Intel Macs
];

export function HomebrewDatabaseDetector({ onImportSuccess, onDecline }: HomebrewDatabaseDetectorProps) {
  const [isChecking, setIsChecking] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [homebrewDbExists, setHomebrewDbExists] = useState(false);
  const [dbSize, setDbSize] = useState<number>(0);
  const [detectedPath, setDetectedPath] = useState<string>('');
  const [isDismissed, setIsDismissed] = useState(false);

  const checkHomebrewDatabase = useCallback(async () => {
    try {
      setIsChecking(true);

      // Check all possible Homebrew locations
      for (const path of HOMEBREW_PATHS) {
        const result = await invoke<{ exists: boolean; size: number } | null>('check_homebrew_database', {
          path,
        });

        if (result && result.exists && result.size > 0) {
          setHomebrewDbExists(true);
          setDbSize(result.size);
          setDetectedPath(path);
          break; // Stop checking once we find a valid database
        }
      }
    } catch (error) {
      console.error('Error checking homebrew database:', error);
      // Silently fail - this is just auto-detection
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkHomebrewDatabase();
  }, [checkHomebrewDatabase]);

  const handleYes = async () => {
    try {
      setIsImporting(true);

      await invoke('import_and_initialize_database', {
        legacyDbPath: detectedPath,
      });

      toast.success('Database imported successfully! Reloading...');

      // Wait 1 second for user to see success, then reload window to refresh all data
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Error importing database:', error);
      toast.error(`Import failed: ${error}`);
      setIsImporting(false);
    }
  };

  const handleNo = () => {
    setIsDismissed(true);
    onDecline();
  };

  if (isChecking || !homebrewDbExists || isDismissed) {
    return null;
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="mb-4 rounded-lg border-2 border-[#8A6FD1]/20 bg-[#8A6FD1]/5 p-4">
      <div className="flex items-start gap-3">
        <Database className="mt-0.5 h-6 w-6 flex-shrink-0 text-[#8A6FD1]" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="h-4 w-4 text-[#8A6FD1]" />
            <h3 className="text-sm font-semibold text-foreground">
               Previous Installation Detected!
            </h3>
          </div>
          <p className="mb-2 text-sm text-muted-foreground">
            We found an existing database from a previous installation (Python backend version).
          </p>
          <div className="bg-white/50 rounded p-2 mb-3">
            <p className="break-all font-mono text-xs text-[#8A6FD1]">
              {detectedPath}
            </p>
            <p className="mt-1 text-xs text-[#8A6FD1]">
              Size: {formatFileSize(dbSize)}
            </p>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Would you like to import your previous meetings, transcripts, and summaries?
          </p>
          
          {/* Yes/No Buttons */}
          <div className="flex gap-2">
            <Button
              variant="brand"
              type="button"
              onClick={handleYes}
              disabled={isImporting}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Importing...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Yes, Import</span>
                </>
              )}
            </Button>
            
            <Button
              variant="outline"
              type="button"
              onClick={handleNo}
              disabled={isImporting}
              className="flex-1 rounded-lg border-2 border-[#8A6FD1]/40 px-4 py-2 text-[#8A6FD1] transition-colors hover:bg-[#8A6FD1]/10 disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              No, Browse Manually
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
