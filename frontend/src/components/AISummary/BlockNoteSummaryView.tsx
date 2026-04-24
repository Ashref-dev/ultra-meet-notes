"use client";

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { Summary, SummaryDataResponse, SummaryFormat, BlockNoteBlock } from '@/types';
import { cn } from '@/lib/utils';
import { AISummary } from './index';
import { Block } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import { toast } from 'sonner';
import "@blocknote/shadcn/style.css";

// Dynamically import BlockNote Editor to avoid SSR issues
const Editor = dynamic(() => import('../BlockNoteEditor/Editor'), { ssr: false });

interface BlockNoteSummaryViewProps {
  summaryData: SummaryDataResponse | Summary | null;
  onSave?: (data: { markdown?: string; summary_json?: BlockNoteBlock[] }) => void;
  onSummaryChange?: (summary: Summary) => void;
  status?: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  error?: string | null;
  onRegenerateSummary?: () => void;
  meeting?: {
    id: string;
    title: string;
    created_at: string;
  };
  onDirtyChange?: (isDirty: boolean) => void;
}

export interface BlockNoteSummaryViewRef {
  saveSummary: () => Promise<void>;
  getMarkdown: () => Promise<string>;
  isDirty: boolean;
}

const EDITOR_FONT_SIZE_STORAGE_KEY = 'editor-font-size';

const FONT_SIZE_OPTIONS = [
  { value: 'small', label: 'Small', fontSize: '14px' },
  { value: 'normal', label: 'Normal', fontSize: '16px' },
  { value: 'large', label: 'Large', fontSize: '18px' },
  { value: 'x-large', label: 'XL', fontSize: '20px' },
] as const;

type EditorFontSize = (typeof FONT_SIZE_OPTIONS)[number]['value'];

const DEFAULT_FONT_SIZE: EditorFontSize = 'normal';

const fontSizeMap: Record<EditorFontSize, string> = FONT_SIZE_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.fontSize;
  return acc;
}, {} as Record<EditorFontSize, string>);

function isEditorFontSize(value: string): value is EditorFontSize {
  return FONT_SIZE_OPTIONS.some((option) => option.value === value);
}

function getStoredEditorFontSize(): EditorFontSize {
  if (typeof window === 'undefined') {
    return DEFAULT_FONT_SIZE;
  }

  const storedValue = window.localStorage.getItem(EDITOR_FONT_SIZE_STORAGE_KEY);
  return storedValue && isEditorFontSize(storedValue) ? storedValue : DEFAULT_FONT_SIZE;
}

// Format detection helper
function detectSummaryFormat(data: any): { format: SummaryFormat; data: any } {
  if (!data) {
    return { format: 'legacy', data: null };
  }

  // Priority 1: BlockNote format (has summary_json)
  if (data.summary_json && Array.isArray(data.summary_json)) {
    console.log('✅ FORMAT: BLOCKNOTE (summary_json exists)');
    return { format: 'blocknote', data };
  }

  // Priority 2: Markdown format
  if (data.markdown && typeof data.markdown === 'string') {
    console.log('✅ FORMAT: MARKDOWN (will parse to BlockNote)');
    return { format: 'markdown', data };
  }

  // Priority 3: Legacy JSON
  const hasLegacyStructure = data.MeetingName || Object.keys(data).some(key =>
    typeof data[key] === 'object' && data[key]?.title && data[key]?.blocks
  );

  if (hasLegacyStructure) {
    console.log('✅ FORMAT: LEGACY (custom JSON)');
    return { format: 'legacy', data };
  }

  return { format: 'legacy', data: null };
}

export const BlockNoteSummaryView = forwardRef<BlockNoteSummaryViewRef, BlockNoteSummaryViewProps>(({
  summaryData,
  onSave,
  onSummaryChange,
  status = 'idle',
  error = null,
  onRegenerateSummary,
  meeting,
  onDirtyChange
}, ref) => {
  const { format, data } = detectSummaryFormat(summaryData);
  const { resolvedTheme } = useTheme();
  const blockNoteTheme: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [isDirty, setIsDirty] = useState(false);
  const [currentBlocks, setCurrentBlocks] = useState<Block[]>([]);
  const [fontSize, setFontSize] = useState<EditorFontSize>(DEFAULT_FONT_SIZE);
  const isContentLoaded = useRef(false);

  // Create BlockNote editor for markdown parsing
  const editor = useCreateBlockNote({
    initialContent: undefined
  });

  // Parse markdown to blocks when format is markdown
  useEffect(() => {
    if (format === 'markdown' && data?.markdown && editor) {
      const loadMarkdown = async () => {
        try {
          console.log('📝 Parsing markdown to BlockNote blocks...');
          const blocks = await editor.tryParseMarkdownToBlocks(data.markdown);
          editor.replaceBlocks(editor.document, blocks);
          console.log('✅ Markdown parsed successfully');

          // Delay to ensure editor has finished rendering before allowing onChange
          setTimeout(() => {
            isContentLoaded.current = true;
          }, 100);
        } catch (err) {
          console.error('❌ Failed to parse markdown:', err);
        }
      };
      loadMarkdown();
    }
  }, [format, data?.markdown, editor]);

  // Set content loaded flag for blocknote format
  useEffect(() => {
    if (format === 'blocknote' && data?.summary_json) {
      // Delay to ensure editor has finished rendering
      setTimeout(() => {
        isContentLoaded.current = true;
      }, 100);
    }
  }, [format, data?.summary_json]);

  useEffect(() => {
    setFontSize(getStoredEditorFontSize());
  }, []);

  const handleEditorChange = useCallback((blocks: Block[]) => {
    // Only set dirty flag if content has finished loading
    if (isContentLoaded.current) {
      setCurrentBlocks(blocks);
      setIsDirty(true);
    }
  }, []);

  // Notify parent of dirty state changes
  useEffect(() => {
    if (onDirtyChange) {
      onDirtyChange(isDirty);
    }
  }, [isDirty, onDirtyChange]);

  const handleSave = useCallback(async () => {
    if (!onSave || !isDirty) return;

    try {
      console.log('💾 Saving BlockNote content...');

      // Generate markdown from current blocks
      const markdown = await editor.blocksToMarkdownLossy(currentBlocks);

      onSave({
        markdown: markdown,
        summary_json: currentBlocks as unknown as BlockNoteBlock[]
      });

      setIsDirty(false);
      console.log('✅ Save successful');
    } catch (err) {
      console.error('❌ Save failed:', err);
      toast.error('Failed to save changes', { description: 'Please try again' });
    }
  }, [onSave, isDirty, currentBlocks, editor]);

  const handleFontSizeChange = useCallback((size: EditorFontSize) => {
    setFontSize(size);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(EDITOR_FONT_SIZE_STORAGE_KEY, size);
    }
  }, []);

  const renderFontSizeControls = () => (
    <div className="mb-3 flex items-center justify-end gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Size
      </span>
      <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-card/60 p-0.5 shadow-sm backdrop-blur-sm">
        {FONT_SIZE_OPTIONS.map((option) => {
          const isActive = fontSize === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => handleFontSizeChange(option.value)}
              aria-label={`Set editor font size to ${option.label === 'XL' ? 'Extra Large' : option.label}`}
              className={cn(
                'relative rounded-lg px-3 py-1 text-xs font-medium transition-all duration-200 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                'motion-reduce:transition-none motion-safe:active:scale-[0.97]',
                isActive
                  ? 'bg-gradient-to-r from-[#5B4DCC] to-[#FFD166] text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const editorFontSize = fontSizeMap[fontSize];

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    saveSummary: handleSave,
    getMarkdown: async () => {
      try {
        console.log('🔍 getMarkdown called, format:', format);
        console.log('🔍 currentBlocks length:', currentBlocks.length);
        console.log('🔍 data:', data);

        // For markdown format - use the main editor
        if (format === 'markdown' && editor) {
          console.log('📝 Using markdown editor, blocks:', editor.document.length);
          const markdown = await editor.blocksToMarkdownLossy(editor.document);
          console.log('📝 Generated markdown length:', markdown.length);
          return markdown;
        }

        // For blocknote format - use currentBlocks state
        if (format === 'blocknote') {
          console.log('📝 BlockNote format, currentBlocks:', currentBlocks.length);
          if (currentBlocks.length > 0 && editor) {
            const markdown = await editor.blocksToMarkdownLossy(currentBlocks);
            console.log('📝 Generated markdown from blocks, length:', markdown.length);
            return markdown;
          }
          // Fallback: if we have the original data with markdown
          if (data?.markdown) {
            console.log('📝 Using fallback markdown from data');
            return data.markdown;
          }
        }

        // For legacy format - return empty (handled by parent)
        console.warn('⚠️ Cannot generate markdown for legacy format, returning empty');
        return '';
      } catch (err) {
        console.error('❌ Failed to generate markdown:', err);
        return '';
      }
    },
    isDirty
  }), [handleSave, isDirty, editor, format, currentBlocks, data]);

  // Render legacy format
  if (format === 'legacy') {
    console.log('🎨 Rendering LEGACY format');
    return (
      <AISummary
        summary={summaryData as Summary}
        status={status}
        error={error}
        onSummaryChange={onSummaryChange || (() => { })}
        onRegenerateSummary={onRegenerateSummary || (() => { })}
        meeting={meeting}
      />
    );
  }

  // Render BlockNote format (has summary_json)
  if (format === 'blocknote') {
    console.log('🎨 Rendering BLOCKNOTE format (direct)');
    return (
      <div className="flex w-full min-w-0 flex-col bg-background text-foreground">
        <div className="w-full min-w-0">
          {renderFontSizeControls()}
          <div
            className="blocknote-font-size-wrapper bg-background text-foreground"
            style={{ fontSize: editorFontSize }}
          >
            <Editor
              initialContent={data.summary_json}
              onChange={(blocks) => {
                console.log('📝 Editor blocks changed:', blocks.length);
                handleEditorChange(blocks);
              }}
              editable={true}
              fontSize={editorFontSize}
              theme={blockNoteTheme}
            />
          </div>
        </div>
      </div>
    );
  }

  // Render Markdown format (parse and display in BlockNote)
  if (format === 'markdown') {
    console.log('🎨 Rendering MARKDOWN format (parsed to BlockNote)');
    return (
      <div className="flex w-full min-w-0 flex-col bg-background text-foreground">
        <div className="w-full min-w-0">
          {renderFontSizeControls()}
          <div
            className="blocknote-font-size-wrapper w-full max-w-full min-w-0 break-words [overflow-wrap:anywhere] [word-break:break-word] bg-background text-foreground transition-all duration-200 ease-out motion-reduce:transition-none"
            style={{ fontSize: editorFontSize }}
          >
            <BlockNoteView
              editor={editor}
              editable={true}
              onChange={() => {
                if (isContentLoaded.current) {
                  handleEditorChange(editor.document);
                }
              }}
              theme={blockNoteTheme}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
});

BlockNoteSummaryView.displayName = 'BlockNoteSummaryView';
