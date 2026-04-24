'use client'

import './globals.css'
import { Inter, JetBrains_Mono, Share_Tech } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import Sidebar from '@/components/Sidebar'
import { SidebarProvider } from '@/components/Sidebar/SidebarProvider'
import MainContent from '@/components/MainContent'
import { Toaster, toast } from 'sonner'
import "sonner/dist/styles.css"
import { useState, useEffect, useCallback } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RecordingStateProvider } from '@/contexts/RecordingStateContext'
import { OllamaDownloadProvider } from '@/contexts/OllamaDownloadContext'
import { TranscriptProvider } from '@/contexts/TranscriptContext'
import { ConfigProvider } from '@/contexts/ConfigContext'
import { OnboardingProvider } from '@/contexts/OnboardingContext'
import { OnboardingFlow } from '@/components/onboarding'
import { DownloadProgressToastProvider } from '@/components/shared/DownloadProgressToast'
import { UpdateCheckProvider } from '@/components/UpdateCheckProvider'
import { RecordingPostProcessingProvider } from '@/contexts/RecordingPostProcessingProvider'
import { usePathname } from 'next/navigation'
import { ImportAudioDialog, ImportDropOverlay } from '@/components/ImportAudio'
import { ImportDialogProvider } from '@/contexts/ImportDialogContext'
import { isAudioExtension, getAudioFormatsDisplayList } from '@/constants/audioFormats'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useMeetingAppDetector } from '@/hooks/useMeetingAppDetector'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const shareTech = Share_Tech({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-share-tech',
  preload: false,
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jetbrains-mono',
})

// Module-level component — stable reference across RootLayout re-renders.
// Defined here (not inside RootLayout) so React never sees a new function type
// on re-render, which would cause unmount/remount and break initialization logic.
function ConditionalImportDialog({
  showImportDialog,
  handleImportDialogClose,
  importFilePath,
}: {
  showImportDialog: boolean;
  handleImportDialogClose: (open: boolean) => void;
  importFilePath: string | null;
}) {
  return (
    <ImportAudioDialog
      open={showImportDialog}
      onOpenChange={handleImportDialogClose}
      preselectedFile={importFilePath}
    />
  );
}

// export { metadata } from './metadata'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isBannerWindow = pathname === '/meeting-banner'
  const isDictationWidget = pathname === '/dictation-widget'
  const isOverlayWindow = isBannerWindow || isDictationWidget

  useMeetingAppDetector({ disabled: isOverlayWindow })

  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingCheckDone, setOnboardingCheckDone] = useState(false)

  // Import audio state
  const [showDropOverlay, setShowDropOverlay] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importFilePath, setImportFilePath] = useState<string | null>(null)

  useEffect(() => {
    if (isOverlayWindow) {
      setOnboardingCheckDone(true)
      return
    }

    let cancelled = false

    const checkOnboarding = async () => {
      // Try invoke with a timeout — in dev mode, Tauri IPC may not be ready yet
      const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
        Promise.race([
          promise,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
        ])

      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return
        try {
          const status = await withTimeout(
            invoke<{ completed: boolean } | null>('get_onboarding_status'),
            3000
          )
          if (cancelled) return
          const isComplete = status?.completed ?? false
          if (!isComplete) {
            console.log('[Layout] Onboarding not completed, showing onboarding flow')
            setShowOnboarding(true)
          } else {
            console.log('[Layout] Onboarding completed, showing main app')
          }
          setOnboardingCheckDone(true)
          return
        } catch (error) {
          console.warn(`[Layout] Onboarding check attempt ${attempt + 1}/3 failed:`, error)
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 500))
          }
        }
      }

      // All retries failed — show onboarding as fallback
        if (!cancelled) {
          console.error('[Layout] All retries exhausted, showing onboarding as fallback')
          setShowOnboarding(true)
          setOnboardingCheckDone(true)
        }
    }

    checkOnboarding()
    return () => { cancelled = true }
  }, [isOverlayWindow])

  // Sync saved dictation hotkey to backend listener at startup
  useEffect(() => {
    if (isOverlayWindow) return;

    const syncDictationHotkey = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const savedHotkey = await store.get<string>('dictation_hotkey');

        if (savedHotkey && savedHotkey.trim()) {
          await invoke('dictation_set_hotkey', { hotkey: savedHotkey });
        }
      } catch (error) {
        console.error('[Layout] Failed to sync dictation hotkey:', error);
      }
    };

    syncDictationHotkey();
  }, [isOverlayWindow]);

  // Disable context menu in production
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      const handleContextMenu = (e: MouseEvent) => e.preventDefault();
      document.addEventListener('contextmenu', handleContextMenu);
      return () => document.removeEventListener('contextmenu', handleContextMenu);
    }
  }, []);
  useEffect(() => {
    // Listen for tray recording toggle request
    const unlisten = listen('request-recording-toggle', () => {
      console.log('[Layout] Received request-recording-toggle from tray');

      if (showOnboarding) {
        toast.error("Please complete setup first", {
          description: "You need to finish onboarding before you can start recording."
        });
      } else {
        // If in main app, forward to useRecordingStart via window event
        console.log('[Layout] Forwarding to start-recording-from-sidebar');
        window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [showOnboarding]);

  // Handle file drop for audio import
  const handleFileDrop = useCallback((paths: string[]) => {
    // Find the first audio file
    const audioFile = paths.find(p => {
      const ext = p.split('.').pop()?.toLowerCase();
      return !!ext && isAudioExtension(ext);
    });

    if (audioFile) {
      console.log('[Layout] Audio file dropped:', audioFile);
      setImportFilePath(audioFile);
      setShowImportDialog(true);
    } else if (paths.length > 0) {
      toast.error('Please drop an audio file', {
        description: `Supported formats: ${getAudioFormatsDisplayList()}`
      });
    }
  }, []);

  useEffect(() => {
    if (showOnboarding) return;

    const internalDragRef = { current: false };

    const isInternalEditorTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest('.bn-container, .ProseMirror, [data-content-type], [data-node-view-wrapper], .blocknote-font-size-wrapper')
      );
    };

    const handleDragStart = (event: DragEvent) => {
      if (isInternalEditorTarget(event.target)) {
        internalDragRef.current = true;
      }
    };

    const clearInternal = () => {
      internalDragRef.current = false;
    };

    document.addEventListener('dragstart', handleDragStart, true);
    document.addEventListener('dragend', clearInternal, true);
    document.addEventListener('drop', clearInternal, true);

    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const setupListeners = async () => {
      const unlistenDragEnter = await listen('tauri://drag-enter', () => {
        if (internalDragRef.current) return;
        setShowDropOverlay(true);
      });
      if (cleanedUpRef.current) {
        unlistenDragEnter();
        return;
      }
      unlisteners.push(unlistenDragEnter);

      const unlistenDragLeave = await listen('tauri://drag-leave', () => {
        setShowDropOverlay(false);
      });
      if (cleanedUpRef.current) {
        unlistenDragLeave();
        unlisteners.forEach((u) => {
          u();
        });
        return;
      }
      unlisteners.push(unlistenDragLeave);

      const unlistenDrop = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        setShowDropOverlay(false);
        if (internalDragRef.current) {
          internalDragRef.current = false;
          return;
        }
        handleFileDrop(event.payload.paths);
      });
      if (cleanedUpRef.current) {
        unlistenDrop();
        unlisteners.forEach((u) => {
          u();
        });
        return;
      }
      unlisteners.push(unlistenDrop);
    };

    setupListeners();

    return () => {
      cleanedUpRef.current = true;
      document.removeEventListener('dragstart', handleDragStart, true);
      document.removeEventListener('dragend', clearInternal, true);
      document.removeEventListener('drop', clearInternal, true);
      unlisteners.forEach((unlisten) => {
        unlisten();
      });
    };
  }, [showOnboarding, handleFileDrop]);

  // Handle import dialog close
  const handleImportDialogClose = useCallback((open: boolean) => {
    setShowImportDialog(open);
    if (!open) {
      setImportFilePath(null);
    }
  }, []);

  // Handler for ImportDialogProvider - opens import dialog from any child component
  const handleOpenImportDialog = useCallback((filePath?: string | null) => {
    setImportFilePath(filePath ?? null);
    setShowImportDialog(true);
  }, []);

  const handleOnboardingComplete = () => {
    console.log('[Layout] Onboarding completed, reloading app')
    setShowOnboarding(false)
    // Optionally reload the window to ensure all state is fresh
    window.location.reload()
  }

  // Banner popup window: render children directly without providers/sidebar
  if (isOverlayWindow) {
    return (
      <html
        lang="en"
        className={`${inter.className} ${inter.variable} ${shareTech.variable} ${jetbrainsMono.variable}`}
        style={{ background: 'transparent' }}
      >
        <body className="font-sans antialiased" style={{ background: 'transparent' }}>
          {children}
        </body>
      </html>
    )
  }

  return (
    <html lang="en" className={`${inter.className} ${inter.variable} ${shareTech.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <RecordingStateProvider>
            <TranscriptProvider>
              <ConfigProvider>
                <OllamaDownloadProvider>
                  <OnboardingProvider>
                    <UpdateCheckProvider>
                      <SidebarProvider>
                        <TooltipProvider>
                          <RecordingPostProcessingProvider>
                            <ImportDialogProvider onOpen={handleOpenImportDialog}>
                              {/* Download progress toast provider - listens for background downloads */}
                              <DownloadProgressToastProvider />

                              {/* Show loading, onboarding, or main app */}
                              {!onboardingCheckDone ? (
                                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
                                  <div className="text-center space-y-3">
                                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
                                    <p className="text-sm text-muted-foreground">Loading...</p>
                                  </div>
                                </div>
                              ) : showOnboarding ? (
                                <ErrorBoundary fallbackMessage="Setup encountered an error. Please restart the app.">
                                  <OnboardingFlow onComplete={handleOnboardingComplete} />
                                </ErrorBoundary>
                              ) : (
                                <div className="flex">
                                  <ErrorBoundary fallbackMessage="Sidebar encountered an error">
                                    <Sidebar />
                                  </ErrorBoundary>
                                  <ErrorBoundary>
                                    <MainContent>{children}</MainContent>
                                  </ErrorBoundary>
                                </div>
                              )}
                              {/* Import audio overlay and dialog */}
                              <ErrorBoundary fallbackMessage="Import dialog encountered an error">
                                <ImportDropOverlay visible={showDropOverlay} />
                                <ConditionalImportDialog
                                  showImportDialog={showImportDialog}
                                  handleImportDialogClose={handleImportDialogClose}
                                  importFilePath={importFilePath}
                                />
                              </ErrorBoundary>
                            </ImportDialogProvider>
                          </RecordingPostProcessingProvider>
                        </TooltipProvider>
                      </SidebarProvider>
                    </UpdateCheckProvider>
                  </OnboardingProvider>
                </OllamaDownloadProvider>
              </ConfigProvider>
            </TranscriptProvider>
          </RecordingStateProvider>
        </ThemeProvider>

        <Toaster position="bottom-center" richColors closeButton />
      </body>
    </html>
  )
}
