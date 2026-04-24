import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Check, Cloud, Eye, EyeOff, Globe, Lock, Unlock, X, Zap } from 'lucide-react';
import { ModelManager } from './WhisperModelManager';
import { ParakeetModelManager } from './ParakeetModelManager';
import { QwenAsrModelManager } from './QwenAsrModelManager';
import { getDefaultTranscriptionModel } from '@/constants/modelDefaults';


export interface TranscriptModelProps {
    provider: 'localWhisper' | 'parakeet' | 'qwenAsr' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai';
    model: string;
    apiKey?: string | null;
}

export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}

type LocalProvider = 'localWhisper' | 'parakeet' | 'qwenAsr';
type CloudProvider = Exclude<TranscriptModelProps['provider'], LocalProvider>;

type ProviderInsight = {
    label: string;
    triggerLabel: string;
    description: string;
    icon: typeof Globe;
    pros: string[];
    cons: string[];
};

const MODEL_OPTIONS: Record<TranscriptModelProps['provider'], string[]> = {
    localWhisper: [],
    parakeet: [],
    qwenAsr: [],
    deepgram: ['nova-2-phonecall'],
    elevenLabs: ['eleven_multilingual_v2'],
    groq: ['llama-3.3-70b-versatile'],
    openai: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
};

const PROVIDER_INSIGHTS: Partial<Record<TranscriptModelProps['provider'], ProviderInsight>> = {
    localWhisper: {
        label: 'Local Whisper (Recommended)',
        triggerLabel: 'Local Whisper (Recommended)',
        description: 'Multi-language support with translation. 100% private, runs on your device. Good balance of speed and accuracy.',
        icon: Globe,
        pros: [
            'Multi-language + translation',
            'Runs 100% on your device — fully private',
            'No API key needed',
        ],
        cons: ['Slightly slower than Parakeet'],
    },
    parakeet: {
        label: 'Parakeet (Fastest, English only)',
        triggerLabel: 'Parakeet',
        description: 'Fastest real-time English transcription. Runs locally. Best for English-only meetings.',
        icon: Zap,
        pros: [
            'Fastest real-time transcription',
            'Runs 100% on your device — fully private',
            'No API key needed',
        ],
        cons: ['English only'],
    },
    openai: {
        label: 'OpenAI (Cloud, most accurate)',
        triggerLabel: 'OpenAI',
        description: 'State-of-the-art accuracy via OpenAI API. Requires API key. Audio sent to OpenAI.',
        icon: Cloud,
        pros: ['State-of-the-art accuracy', 'Handles all languages'],
        cons: [
            'Requires API key ($$$)',
            'Audio sent to OpenAI (not private)',
            'Requires internet connection',
        ],
    },
    qwenAsr: {
        label: 'Qwen3 ASR',
        triggerLabel: 'Qwen ASR',
        description: 'Local multilingual transcription with larger model downloads and strong quality.',
        icon: Globe,
        pros: ['Multilingual local transcription', 'Runs on your device', 'No API key needed'],
        cons: ['Larger downloads than Whisper or Parakeet'],
    },
};

function isLocalProvider(provider: TranscriptModelProps['provider']): provider is LocalProvider {
    return provider === 'localWhisper' || provider === 'parakeet' || provider === 'qwenAsr';
}

export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    const [apiKey, setApiKey] = useState<string | null>(transcriptModelConfig.apiKey || null);
    const [showApiKey, setShowApiKey] = useState<boolean>(false);
    const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(true);
    const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
    const [uiProvider, setUiProvider] = useState<TranscriptModelProps['provider']>(transcriptModelConfig.provider);

    // Sync uiProvider when backend config changes (e.g., after model selection or initial load)
    useEffect(() => {
        setUiProvider(transcriptModelConfig.provider);
    }, [transcriptModelConfig.provider]);

    useEffect(() => {
        if (isLocalProvider(uiProvider)) {
            setApiKey(null);
            return;
        }
        if (transcriptModelConfig.provider === uiProvider) {
            setApiKey(transcriptModelConfig.apiKey || null);
        }
    }, [transcriptModelConfig.provider, transcriptModelConfig.apiKey, uiProvider]);

    const fetchApiKey = async (provider: CloudProvider): Promise<string | null> => {
        try {
            const data = await invoke('api_get_transcript_api_key', { provider }) as string;
            const normalized = data?.trim() ? data.trim() : null;
            setApiKey(normalized);
            return normalized;
        } catch (err) {
            console.error('Error fetching API key:', err);
            setApiKey(null);
            return null;
        }
    };

    const persistCloudConfig = async (provider: CloudProvider, model: string, key: string | null) => {
        const normalizedKey = key?.trim() ? key.trim() : null;
        await invoke('api_save_transcript_config', {
            provider,
            model,
            apiKey: normalizedKey,
        });
        setTranscriptModelConfig({
            provider,
            model,
            apiKey: normalizedKey,
        });
    };

    const requiresApiKey = !isLocalProvider(uiProvider);
    const cloudModelOptions = isLocalProvider(uiProvider) ? [] : MODEL_OPTIONS[uiProvider];
    const providerInsight = PROVIDER_INSIGHTS[uiProvider];
    const ProviderInsightIcon = providerInsight?.icon;
    const selectedProvider = PROVIDER_INSIGHTS[uiProvider];
    const selectedCloudModel = transcriptModelConfig.provider === uiProvider
        ? transcriptModelConfig.model
        : (cloudModelOptions[0] || '');

    const handleInputClick = () => {
        if (isApiKeyLocked) {
            setIsLockButtonVibrating(true);
            setTimeout(() => setIsLockButtonVibrating(false), 500);
        }
    };

    const handleWhisperModelSelect = (modelName: string) => {
        // Always update config when model is selected, regardless of current provider
        // This ensures the model is set when user switches back
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'localWhisper', // Ensure provider is set correctly
            model: modelName
        });
        // Close modal after selection
        if (onModelSelect) {
            onModelSelect();
        }
    };

    const handleParakeetModelSelect = (modelName: string) => {
        // Always update config when model is selected, regardless of current provider
        // This ensures the model is set when user switches back
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'parakeet', // Ensure provider is set correctly
            model: modelName
        });
        // Close modal after selection
        if (onModelSelect) {
            onModelSelect();
        }
    };

    const handleQwenAsrModelSelect = (modelName: string) => {
        // Always update config when model is selected, regardless of current provider
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'qwenAsr',
            model: modelName
        });
        if (onModelSelect) {
            onModelSelect();
        }
    };

    return (
        <div>
            <div>
                {/* <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Transcript Settings</h3>
                </div> */}
                <div className="space-y-4 pb-6">
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-foreground">
                            Transcript Model
                        </Label>
                        <div className="space-y-6">
                            <div className="mx-1 flex space-x-2">
                                <Select
                                    value={uiProvider}
                                    onValueChange={(value) => {
                                        const provider = value as TranscriptModelProps['provider'];
                                        setUiProvider(provider);

                                        if (isLocalProvider(provider)) {
                                            const nextModel = transcriptModelConfig.provider === provider
                                                ? transcriptModelConfig.model
                                                : getDefaultTranscriptionModel(provider);
                                            setTranscriptModelConfig({
                                                provider,
                                                model: nextModel,
                                                apiKey: null,
                                            });
                                            return;
                                        }

                                        const initialModel =
                                            transcriptModelConfig.provider === provider && transcriptModelConfig.model
                                                ? transcriptModelConfig.model
                                                : (MODEL_OPTIONS[provider][0] || '');

                                        void (async () => {
                                            try {
                                                const existingApiKey = await fetchApiKey(provider);
                                                await persistCloudConfig(provider, initialModel, existingApiKey);
                                            } catch (err) {
                                                console.error('Failed to persist transcript provider config:', err);
                                            }
                                        })();
                                    }}
                                >
                                    <SelectTrigger className="h-auto min-h-11 border-border bg-background text-foreground focus:border-ring focus:ring-1 focus:ring-ring [&>span]:line-clamp-3">
                                        <SelectValue placeholder="Select provider">
                                            <span className="block min-w-0 whitespace-normal pr-4 text-left">
                                                {selectedProvider?.triggerLabel ?? 'Select provider'}
                                            </span>
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent className="sm:min-w-[28rem]">
                                        <SelectItem value="localWhisper">
                                            <div className="flex min-w-0 flex-col">
                                                <span>Local Whisper (Recommended)</span>
                                                <span className="line-clamp-3 min-w-0 text-xs text-muted-foreground">Private on-device multilingual transcription with translation.</span>
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="parakeet">
                                            <div className="flex min-w-0 flex-col">
                                                <span>Parakeet (Fastest, English only)</span>
                                                <span className="line-clamp-3 min-w-0 text-xs text-muted-foreground">Best for English-only meetings when speed matters most.</span>
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="qwenAsr">
                                            <div className="flex min-w-0 flex-col">
                                                <span>Qwen3 ASR (Local multilingual)</span>
                                                <span className="line-clamp-3 min-w-0 text-xs text-muted-foreground">Larger local multilingual models with strong quality.</span>
                                            </div>
                                        </SelectItem>
                                        {/* <SelectItem value="deepgram">Deepgram (Backup)</SelectItem>
                                        <SelectItem value="elevenLabs">ElevenLabs</SelectItem>
                                        <SelectItem value="groq">Groq</SelectItem>
                                        */}
                                        <SelectItem value="openai">
                                            <div className="flex min-w-0 flex-col">
                                                <span>OpenAI (Cloud, most accurate)</span>
                                                <span className="line-clamp-3 min-w-0 text-xs text-muted-foreground">Highest accuracy, but requires API key and sends audio to OpenAI.</span>
                                            </div>
                                        </SelectItem>
                                    </SelectContent>
                                </Select>

                                {!isLocalProvider(uiProvider) && (
                                    <Select
                                        value={selectedCloudModel}
                                        onValueChange={(value) => {
                                            const model = value as string;
                                            const provider = uiProvider as CloudProvider;
                                            setTranscriptModelConfig({ provider, model, apiKey });
                                            void persistCloudConfig(provider, model, apiKey).catch((err) => {
                                                console.error('Failed to save transcript model config:', err);
                                            });
                                        }}
                                    >
                                        <SelectTrigger className="border-border bg-background text-foreground focus:border-ring focus:ring-1 focus:ring-ring">
                                            <SelectValue placeholder="Select model" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {cloudModelOptions.map((model) => (
                                                <SelectItem key={model} value={model}>{model}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>

                            {providerInsight && ProviderInsightIcon && (
                            <div className="mx-1 mt-4 rounded-xl bg-card/60 p-5 shadow-sm backdrop-blur-sm">
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 rounded-md bg-background p-2 text-muted-foreground">
                                        <ProviderInsightIcon className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-3">
                                        <div className="space-y-2">
                                            <p className="text-sm font-medium text-foreground">{providerInsight.label}</p>
                                            <p className="text-xs leading-relaxed text-muted-foreground">{providerInsight.description}</p>
                                        </div>
                                        <div className="space-y-3">
                                            {providerInsight.pros.map((pro) => (
                                                <div key={pro} className="flex items-start gap-2 text-xs text-success">
                                                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                                                    <span>{pro}</span>
                                                </div>
                                            ))}
                                            {providerInsight.cons.map((con) => (
                                                <div key={con} className="flex items-start gap-2 text-xs text-muted-foreground">
                                                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                    <span>{con}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            )}
                        </div>
                    </div>

                    {uiProvider === 'localWhisper' && (
                        <div className="mt-6">
                            <ModelManager
                                selectedModel={transcriptModelConfig.provider === 'localWhisper' ? transcriptModelConfig.model : undefined}
                                onModelSelect={handleWhisperModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {uiProvider === 'parakeet' && (
                        <div className="mt-6">
                            <ParakeetModelManager
                                selectedModel={transcriptModelConfig.provider === 'parakeet' ? transcriptModelConfig.model : undefined}
                                onModelSelect={handleParakeetModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {uiProvider === 'qwenAsr' && (
                        <div className="mt-6">
                            <QwenAsrModelManager
                                selectedModel={transcriptModelConfig.provider === 'qwenAsr' ? transcriptModelConfig.model : undefined}
                                onModelSelect={handleQwenAsrModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {requiresApiKey && (
                        <div>
                            <Label className="mb-1 block text-sm font-medium text-foreground">
                                API Key
                            </Label>
                            <div className="relative mx-1">
                                <Input
                                    type={showApiKey ? "text" : "password"}
                                    className={`border-border bg-background pr-24 text-foreground focus:ring-1 focus:ring-ring focus:border-ring ${isApiKeyLocked ? 'bg-muted cursor-not-allowed text-muted-foreground' : ''
                                         }`}
                                    value={apiKey || ''}
                                    onChange={(e) => {
                                        const nextApiKey = e.target.value;
                                        setApiKey(nextApiKey);
                                        if (!isLocalProvider(uiProvider)) {
                                            setTranscriptModelConfig({
                                                provider: uiProvider,
                                                model: selectedCloudModel,
                                                apiKey: nextApiKey,
                                            });
                                        }
                                    }}
                                    onBlur={() => {
                                        if (!isLocalProvider(uiProvider)) {
                                            void persistCloudConfig(uiProvider, selectedCloudModel, apiKey).catch((err) => {
                                                console.error('Failed to save transcript API key:', err);
                                            });
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !isLocalProvider(uiProvider)) {
                                            void persistCloudConfig(uiProvider, selectedCloudModel, apiKey).catch((err) => {
                                                console.error('Failed to save transcript API key:', err);
                                            });
                                        }
                                    }}
                                    disabled={isApiKeyLocked}
                                    onClick={handleInputClick}
                                    placeholder="Enter your API key"
                                />
                                {isApiKeyLocked && (
                                    <button
                                        type="button"
                                        onClick={handleInputClick}
                                        className="absolute inset-0 flex cursor-not-allowed items-center justify-center rounded-md bg-muted/50"
                                        aria-label="Unlock API key field to edit"
                                    />
                                )}
                                <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                                        className={`text-muted-foreground transition-colors duration-200 hover:text-foreground ${isLockButtonVibrating ? 'animate-vibrate text-destructive' : ''
                                            }`}
                                        title={isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"}
                                    >
                                        {isApiKeyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                        className="text-muted-foreground transition-colors duration-200 hover:text-foreground"
                                    >
                                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    )
}
