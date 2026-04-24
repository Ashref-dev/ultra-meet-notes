'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeftCircle,
  ChevronRightCircle,
  Globe,
  Home,
  Mic,
  NotebookPen,
  PanelLeft,
  Settings,
  Square,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import Info from '../Info';
import { SidebarFooter } from './SidebarFooter';
import { SidebarHeader } from './SidebarHeader';
import { SidebarSearch } from './SidebarSearch';
import { MeetingGroup } from './MeetingGroup';
import { MeetingItem } from './MeetingItem';
import { LanguageSelection } from '@/components/LanguageSelection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { useConfig } from '@/contexts/ConfigContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { formatDuration, formatMeetingDate, formatRelativeDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

import { useSidebar } from './SidebarProvider';

const EXPANDED_WIDTH = '16rem';
const COLLAPSED_WIDTH = '4rem';
const APP_VERSION = 'v2.0.0';

type SearchResult = {
  id: string;
  title: string;
  matchContext: string;
  timestamp: string;
};

type GroupedMeeting = {
  id: string;
  title: string;
  created_at?: string;
  groupLabel: string;
  dateLabel: string;
  durationLabel: string;
  matchSnippet: string | null;
  sortTimestamp: number;
};

type DeleteModalState = {
  isOpen: boolean;
  itemId: string | null;
};

type EditModalState = {
  isOpen: boolean;
  meetingId: string | null;
  currentTitle: string;
};

function getMeetingRoute(meetingId: string) {
  if (meetingId.startsWith('intro-call')) {
    return '/';
  }

  return meetingId.includes('-') ? `/meeting-details?id=${meetingId}` : `/notes/${meetingId}`;
}

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();
  const {
    currentMeeting,
    setCurrentMeeting,
    isCollapsed,
    toggleCollapse,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
  } = useSidebar();
  const { selectedLanguage, setSelectedLanguage, transcriptModelConfig } = useConfig();
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();

  const [searchQuery, setSearchQuery] = useState('');
  const [, setShowModelSettings] = useState(false);
  const [deleteModalState, setDeleteModalState] = useState<DeleteModalState>({
    isOpen: false,
    itemId: null,
  });
  const [editModalState, setEditModalState] = useState<EditModalState>({
    isOpen: false,
    meetingId: null,
    currentTitle: '',
  });
  const [editingTitle, setEditingTitle] = useState('');
  const [languageModalOpen, setLanguageModalOpen] = useState(false);

  useEffect(() => {
    (window as Window & { openSettings?: () => void }).openSettings = () => {
      setShowModelSettings(true);
    };

    return () => {
      delete (window as Window & { openSettings?: () => void }).openSettings;
    };
  }, []);

  const searchResultMap = useMemo(() => {
    return new Map((searchResults as SearchResult[]).map((result) => [result.id, result]));
  }, [searchResults]);

  const filteredMeetings = useMemo(() => {
    if (!searchQuery.trim()) {
      return meetings;
    }

    const normalizedQuery = searchQuery.toLowerCase();

    if (searchResults.length > 0) {
      const matchingIds = new Set((searchResults as SearchResult[]).map((result) => result.id));

      return meetings.filter(
        (meeting) =>
          matchingIds.has(meeting.id) ||
          meeting.title.toLowerCase().includes(normalizedQuery)
      );
    }

    return meetings.filter((meeting) =>
      meeting.title.toLowerCase().includes(normalizedQuery)
    );
  }, [meetings, searchQuery, searchResults]);

  const groupedMeetings = useMemo(() => {
    const enrichedMeetings: GroupedMeeting[] = filteredMeetings
      .map((meeting) => {
        const createdAt = meeting.created_at ? new Date(meeting.created_at) : null;
        const hasValidDate = Boolean(createdAt && !Number.isNaN(createdAt.getTime()));
        const sortTimestamp = hasValidDate && createdAt ? createdAt.getTime() : 0;

        return {
          id: meeting.id,
          title: meeting.title,
          created_at: meeting.created_at,
          groupLabel: hasValidDate ? formatRelativeDate(createdAt) : 'Recent',
          dateLabel: hasValidDate ? formatMeetingDate(createdAt) : 'Just now',
          durationLabel: formatDuration(undefined),
          matchSnippet: searchResultMap.get(meeting.id)?.matchContext ?? null,
          sortTimestamp,
        };
      })
      .sort((left, right) => {
        if (right.sortTimestamp !== left.sortTimestamp) {
          return right.sortTimestamp - left.sortTimestamp;
        }

        return left.title.localeCompare(right.title);
      });

    const groups = new Map<string, { label: string; sortTimestamp: number; meetings: GroupedMeeting[] }>();

    enrichedMeetings.forEach((meeting) => {
      const existingGroup = groups.get(meeting.groupLabel);

      if (existingGroup) {
        existingGroup.meetings.push(meeting);
        existingGroup.sortTimestamp = Math.max(existingGroup.sortTimestamp, meeting.sortTimestamp);
        return;
      }

      groups.set(meeting.groupLabel, {
        label: meeting.groupLabel,
        sortTimestamp: meeting.sortTimestamp,
        meetings: [meeting],
      });
    });

    return Array.from(groups.values()).sort((left, right) => right.sortTimestamp - left.sortTimestamp);
  }, [filteredMeetings, searchResultMap]);

  const flatFilteredMeetings = useMemo(
    () => groupedMeetings.flatMap((group) => group.meetings),
    [groupedMeetings]
  );

  const handleSearchChange = useCallback(
    async (value: string) => {
      setSearchQuery(value);
      await searchTranscripts(value);
    },
    [searchTranscripts]
  );

  const handleMeetingSelect = useCallback(
    (meetingId: string, meetingTitle: string) => {
      setCurrentMeeting({ id: meetingId, title: meetingTitle });
      router.push(getMeetingRoute(meetingId));
    },
    [router, setCurrentMeeting]
  );

  const handleDelete = useCallback(
    async (itemId: string) => {
      try {
        await invoke('api_delete_meeting', {
          meetingId: itemId,
        });

        const updatedMeetings = meetings.filter((meeting) => meeting.id !== itemId);
        setMeetings(updatedMeetings);

        toast.success('Meeting deleted successfully', {
          description: 'All associated data has been removed',
        });

        if (currentMeeting?.id === itemId) {
          setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
          router.push('/');
        }
      } catch (error) {
        console.error('Failed to delete meeting:', error);
        toast.error('Failed to delete meeting', {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [currentMeeting?.id, meetings, router, setCurrentMeeting, setMeetings]
  );

  const handleDeleteConfirm = useCallback(() => {
    if (deleteModalState.itemId) {
      void handleDelete(deleteModalState.itemId);
    }

    setDeleteModalState({ isOpen: false, itemId: null });
  }, [deleteModalState.itemId, handleDelete]);

  const handleEditStart = useCallback((meetingId: string, currentTitle: string) => {
    setEditModalState({
      isOpen: true,
      meetingId,
      currentTitle,
    });
    setEditingTitle(currentTitle);
  }, []);

  const handleEditCancel = useCallback(() => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
    setEditingTitle('');
  }, []);

  const handleEditConfirm = useCallback(async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;

    if (!meetingId) {
      return;
    }

    if (!newTitle) {
      toast.error('Meeting title cannot be empty');
      return;
    }

    try {
      await invoke('api_save_meeting_title', {
        meetingId,
        title: newTitle,
      });

      const updatedMeetings = meetings.map((meeting) =>
        meeting.id === meetingId ? { ...meeting, title: newTitle } : meeting
      );

      setMeetings(updatedMeetings);

      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }

      toast.success('Meeting title updated successfully');
      handleEditCancel();
    } catch (error) {
      console.error('Failed to update meeting title:', error);
      toast.error('Failed to update meeting title', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [currentMeeting?.id, editModalState.meetingId, editingTitle, handleEditCancel, meetings, setCurrentMeeting, setMeetings]);

  const handleGoHome = useCallback(() => {
    setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
    router.push('/');
  }, [router, setCurrentMeeting]);

  const motionTransition = shouldReduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 260, damping: 28 };

  const isHomePage = pathname === '/';
  const isSettingsPage = pathname === '/settings';
  const showEmptyState = filteredMeetings.length === 0;

  return (
    <div className="fixed inset-y-0 left-0 z-40 flex">
      <motion.aside
        animate={{ width: isCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
        transition={motionTransition}
        className="relative flex h-screen flex-col overflow-hidden border-r border-border bg-background shadow-sm"
      >
        <button
          type="button"
          onClick={toggleCollapse}
          className="absolute -right-4 top-6 z-50 rounded-lg border border-border bg-background p-1 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          style={{ transform: 'translateX(50%)' }}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRightCircle className="size-6" />
          ) : (
            <ChevronLeftCircle className="size-6" />
          )}
        </button>

        <TooltipProvider>
          <AnimatePresence initial={false} mode="wait">
            {isCollapsed ? (
              <motion.div
                key="collapsed-sidebar"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
                className="flex h-full flex-col items-center py-4"
              >
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleCollapse}
                    aria-label="Toggle sidebar"
                    className="flex w-full items-center justify-center p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                  >
                    <PanelLeft className="h-5 w-5" />
                  </button>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleGoHome}
                        className={cn(
                          'size-10 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground',
                          isHomePage && 'bg-accent text-accent-foreground shadow-sm'
                        )}
                      >
                        <Home className="size-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>Home</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setLanguageModalOpen(true)}
                         className="size-10 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Globe className="size-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>Language Settings</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        onClick={handleRecordingToggle}
                        disabled={isRecording}
                         className="size-10 rounded-xl"
                      >
                        {isRecording ? <Square className="size-5" /> : <Mic className="size-5" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>{isRecording ? 'Recording in progress...' : 'Start Recording'}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                {flatFilteredMeetings.length > 0 && (
                  <div className="mt-2 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-hidden py-1">
                    {flatFilteredMeetings.slice(0, 12).map((meeting) => (
                      <Tooltip key={meeting.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => handleMeetingSelect(meeting.id, meeting.title)}
                            className={cn(
                               'flex size-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                              currentMeeting?.id === meeting.id
                                ? 'bg-gradient-to-br from-[#5B4DCC]/20 to-[#FFD166]/20 text-foreground shadow-sm ring-1 ring-[#5B4DCC]/30'
                                : 'bg-card/60 text-muted-foreground hover:bg-accent hover:text-foreground'
                            )}
                            aria-label={meeting.title}
                          >
                            {meeting.title.slice(0, 2).toUpperCase()}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[200px]">
                          <p className="font-medium">{meeting.title}</p>
                          <p className="text-xs text-muted-foreground">{meeting.dateLabel}</p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex flex-col items-center gap-3">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push('/settings')}
                        className={cn(
                           'size-10 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground',
                          isSettingsPage && 'bg-accent text-accent-foreground shadow-sm'
                        )}
                      >
                        <Settings className="size-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>Settings</p>
                    </TooltipContent>
                  </Tooltip>

                  <Info isCollapsed={true} />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="expanded-sidebar"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: 'easeOut' }}
                className="flex h-full min-h-0 flex-col"
              >
                <div className="flex min-h-0 flex-1 flex-col p-3">
                  <SidebarHeader />

                  <div className="mt-4">
                    <SidebarSearch
                      value={searchQuery}
                      onChange={(value) => {
                        void handleSearchChange(value);
                      }}
                      isSearching={isSearching}
                    />
                  </div>

                  <div className="mt-4 min-h-0 flex-1 overflow-y-auto scrollbar-hidden pr-1">
                    {showEmptyState ? (
                      <div className="flex h-full min-h-[240px] items-center justify-center px-2">
                        <div className="w-full rounded-xl border border-dashed border-border bg-card px-4 py-10 text-center shadow-sm">
                          <NotebookPen className="mx-auto size-10 text-muted-foreground" />
                          <h3 className="mt-4 text-sm font-semibold text-foreground">
                            {searchQuery.trim() ? 'No meetings found' : 'No meetings yet'}
                          </h3>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {searchQuery.trim()
                              ? 'Try a different title or transcript search.'
                              : 'Start recording to create one.'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-5 pb-3">
                        {groupedMeetings.map((group) => (
                          <MeetingGroup key={group.label} label={group.label}>
                            {group.meetings.map((meeting) => (
                              <MeetingItem
                                key={meeting.id}
                                title={meeting.title}
                                dateLabel={meeting.dateLabel}
                                durationLabel={meeting.durationLabel}
                                matchSnippet={meeting.matchSnippet}
                                isActive={currentMeeting?.id === meeting.id}
                                onSelect={() => handleMeetingSelect(meeting.id, meeting.title)}
                                onEdit={() => handleEditStart(meeting.id, meeting.title)}
                                onDelete={() =>
                                  setDeleteModalState({ isOpen: true, itemId: meeting.id })
                                }
                              />
                            ))}
                          </MeetingGroup>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <SidebarFooter
                  isRecording={isRecording}
                  onRecordClick={handleRecordingToggle}
                  onImportClick={() => openImportDialog()}
                  onSettingsClick={() => router.push('/settings')}
                  onHomeClick={handleGoHome}
                  onLanguageClick={() => setLanguageModalOpen(true)}
                  version={APP_VERSION}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </TooltipProvider>
      </motion.aside>

      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="Are you sure you want to delete this meeting? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      <Dialog
        open={editModalState.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleEditCancel();
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Meeting Title</DialogTitle>
            <DialogDescription>
              Rename this meeting without changing its transcript or notes.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <label htmlFor="meeting-title" className="mb-2 block text-sm font-medium text-foreground">
              Meeting Title
            </label>
            <Input
              id="meeting-title"
              type="text"
              value={editingTitle}
              onChange={(event) => setEditingTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleEditConfirm();
                } else if (event.key === 'Escape') {
                  handleEditCancel();
                }
              }}
              placeholder="Enter meeting title"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleEditCancel}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleEditConfirm()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={languageModalOpen} onOpenChange={setLanguageModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Language Settings</DialogTitle>
          <VisuallyHidden>
            Adjust the transcription language used for recordings.
          </VisuallyHidden>
          <LanguageSelection
            selectedLanguage={selectedLanguage}
            onLanguageChange={setSelectedLanguage}
            disabled={isRecording}
            provider={transcriptModelConfig?.provider}
          />
          <div className="flex justify-end pt-2">
            <Button variant="brand" onClick={() => setLanguageModalOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sidebar;
