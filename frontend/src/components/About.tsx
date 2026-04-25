import React, { useState, useEffect, useCallback } from "react";
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { updateService, UpdateInfo } from '@/services/updateService';
import { Button } from './ui/button';
import { Loader2, CheckCircle2, Globe, Github, Mail, ExternalLink, Heart } from 'lucide-react';
import { toast } from 'sonner';
import { LogoGlyph } from './Logo';
import { Wordmark } from './Wordmark';


export function About() {
    const [currentVersion, setCurrentVersion] = useState<string>('1.0.0');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [isChecking, setIsChecking] = useState(false);

    const cardClassName = 'rounded-xl bg-card/60 p-5 shadow-sm backdrop-blur-sm';
    const featureCardClassName = 'rounded-xl bg-card/60 p-3 shadow-sm backdrop-blur-sm transition-[background-color,transform] duration-200 hover:bg-card/80 motion-reduce:transition-none motion-safe:active:scale-[0.98]';

    useEffect(() => {
        getVersion().then(setCurrentVersion).catch(() => setCurrentVersion('unavailable'));
    }, []);

    const handleOpenLink = useCallback(async (url: string) => {
        try {
            await invoke('open_external_url', { url });
        } catch (error) {
            console.error('Failed to open link:', error);
        }
    }, []);

    const handleCheckForUpdates = async () => {
        setIsChecking(true);
        try {
            const info = await updateService.checkForUpdates(true);
            setUpdateInfo(info);
            if (info.available) {
                toast.success(`Update available: v${info.version}`, {
                    description: 'Visit GitHub to download the latest release.',
                    action: info.downloadUrl ? {
                        label: 'Download',
                        onClick: () => void invoke('open_external_url', { url: info.downloadUrl }),
                    } : undefined,
                    duration: 10000,
                });
            } else {
                toast.success('You are on the latest version');
            }
        } catch (error: unknown) {
            console.error('Failed to check for updates:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            toast.error(`Failed to check for updates: ${errorMessage}`);
        } finally {
            setIsChecking(false);
        }
    };

    return (
        <div className="space-y-4 p-4">
            <div className="brand-grain relative overflow-hidden rounded-xl brand-gradient-warm-linear p-6 text-center shadow-lg">
                <div className="relative z-10">
                    <div className="mb-4">
                        <LogoGlyph size={56} mono className="text-white drop-shadow-lg" />
                    </div>
                    <div className="mb-1 flex items-center justify-center">
                        <Wordmark height={26} className="!text-white" title="Ultra" />
                    </div>
                    <p className="mt-1 text-xs text-white/80">v{currentVersion}</p>
                    <p className="mt-2 text-sm text-white/90">
                        Real-time notes and summaries that never leave your machine.
                    </p>
                    <div className="mt-4">
                        <Button
                            onClick={handleCheckForUpdates}
                            disabled={isChecking}
                            variant="outline"
                            size="sm"
                            className="border-white/30 bg-white/10 text-white backdrop-blur-sm text-xs hover:bg-white/20 hover:text-white"
                        >
                            {isChecking ? (
                                <>
                                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                    Checking...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="h-3 w-3 mr-2" />
                                    Check for Updates
                                </>
                            )}
                        </Button>
                        {updateInfo?.available && (
                            <div className="mt-2 text-xs text-white">
                                Update available: v{updateInfo.version}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className={`${cardClassName} space-y-3`}>
                <h2 className="text-base font-semibold text-foreground">
                    <span>What makes </span>
                    <span className="font-display tracking-[0.08em]">Ultra</span>
                    <span> different</span>
                </h2>
                <div className="grid grid-cols-2 gap-2">
                    <div className={featureCardClassName}>
                        <h3 className="mb-1 text-sm font-bold text-foreground">Privacy-first</h3>
                        <p className="text-xs leading-relaxed text-muted-foreground">Your data & AI processing stay on your machine. No cloud, no leaks.</p>
                    </div>
                    <div className={featureCardClassName}>
                        <h3 className="mb-1 text-sm font-bold text-foreground">Use Any Model</h3>
                        <p className="text-xs leading-relaxed text-muted-foreground">Local open-source or external API — your choice. No lock-in.</p>
                    </div>
                    <div className={featureCardClassName}>
                        <h3 className="mb-1 text-sm font-bold text-foreground">Cost-Smart</h3>
                        <p className="text-xs leading-relaxed text-muted-foreground">Avoid pay-per-minute bills by running models locally.</p>
                    </div>
                    <div className={featureCardClassName}>
                        <h3 className="mb-1 text-sm font-bold text-foreground">Works everywhere</h3>
                        <p className="text-xs leading-relaxed text-muted-foreground">Google Meet, Zoom, Teams — online or offline.</p>
                    </div>
                </div>
            </div>

            <div className={`${cardClassName} space-y-3`}>
                <h2 className="text-base font-semibold text-foreground">Links</h2>
                <div className="grid gap-1.5">
                    <Button
                        variant="link"
                        onClick={() => void handleOpenLink('https://ultra.ashref.tn')}
                        className="h-auto justify-start p-0 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <span className="flex items-center gap-3">
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4DCC] via-[#F06A8B] to-[#FFD166] text-white">
                                <Globe className="h-4 w-4" />
                            </span>
                            <span className="flex flex-col items-start">
                                <span className="font-medium">Website</span>
                                <span className="text-xs text-muted-foreground">ultra.ashref.tn</span>
                            </span>
                        </span>
                        <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </Button>

                    <Button
                        variant="link"
                        onClick={() => void handleOpenLink('https://github.com/Ashref-dev/ultra-meet-notes')}
                        className="h-auto justify-start p-0 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <span className="flex items-center gap-3">
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                                <Github className="h-4 w-4" />
                            </span>
                            <span className="flex flex-col items-start">
                                <span className="font-medium">Open source on GitHub</span>
                                <span className="text-xs text-muted-foreground">Ashref-dev/ultra-meet-notes</span>
                            </span>
                        </span>
                        <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </Button>

                    <Button
                        variant="link"
                        onClick={() => void handleOpenLink('https://ashref.tn')}
                        className="h-auto justify-start p-0 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <span className="flex items-center gap-3">
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                                <Mail className="h-4 w-4" />
                            </span>
                            <span className="flex flex-col items-start">
                                <span className="font-medium">Made by Ashref</span>
                                <span className="text-xs text-muted-foreground">ashref.tn</span>
                            </span>
                        </span>
                        <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </Button>
                </div>

                <p className="pt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    Crafted with
                    <Heart className="h-3 w-3 text-[#8A6FD1]" fill="currentColor" />
                    in Tunis.
                </p>
            </div>

        </div>

    )
}
