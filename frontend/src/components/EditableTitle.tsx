'use client';
/* biome-ignore-all lint/a11y/noNoninteractiveElementToInteractiveRole: requested keyboard-accessible h1 trigger */
/* eslint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role */

import { useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface EditableTitleProps {
  title: string;
  isEditing: boolean;
  onStartEditing: () => void;
  onFinishEditing: () => void;
  onChange: (value: string) => void;
  onDelete?: () => void;
}

export const EditableTitle: React.FC<EditableTitleProps> = ({
  title,
  isEditing,
  onStartEditing,
  onFinishEditing,
  onChange,
  onDelete,
}) => {
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const startEditing = () => onStartEditing();

  const titleHeading = (
    // biome-ignore lint/a11y/useSemanticElements: requested heading remains semantic text while gaining keyboard activation
    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: requested keyboard-accessible h1 trigger
    <h1
      role="button"
      tabIndex={0}
      className="flex-1 cursor-pointer whitespace-pre-wrap rounded px-1 text-2xl font-bold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={startEditing}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startEditing();
        }
      }}
    >
      {title}
    </h1>
  );

  useEffect(() => {
    if (titleInputRef.current && isEditing) {
      titleInputRef.current.focus();
    }
  }, [isEditing]);

  // Auto-resize textarea height based on content
  useEffect(() => {
    void title;

    if (titleInputRef.current && isEditing) {
      titleInputRef.current.style.height = 'auto';
      titleInputRef.current.style.height = `${titleInputRef.current.scrollHeight}px`;
    }
  }, [title, isEditing]);

  return isEditing ? (
    <div className="flex-1">
      <textarea
        ref={titleInputRef}
        value={title}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onFinishEditing}
        onKeyDown={(e) => {
          // Allow Enter for new line only with Shift key
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onFinishEditing();
          }
        }}
        className="w-full resize-none overflow-hidden rounded border border-border bg-muted px-3 py-1 text-2xl font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        style={{ minWidth: '300px', minHeight: '40px' }}
        rows={1}
      />
    </div>
  ) : (
    <div className="group flex items-center space-x-2 flex-1">
      {titleHeading}
      <div className="flex space-x-1">
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={startEditing}
          className="rounded p-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-muted"
          title="Edit section title"
        >
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg" 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </Button>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={onDelete}
            className="rounded p-1 text-destructive opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-muted hover:text-destructive"
            title="Delete section"
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg" 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </Button>
        )}
      </div>
    </div>
  );
};
