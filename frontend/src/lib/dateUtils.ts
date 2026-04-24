/**
 * Date formatting utilities for Ultra-Meet-Notes
 * Uses date-fns (already in package.json) for reliable formatting
 */
import { format, isToday, isYesterday } from 'date-fns';

function toValidDate(date?: Date | string | null): Date | null {
  if (!date) {
    return null;
  }

  const parsedDate = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

/** Format as "DD/MM/YY : HH:MM am/pm" for sidebar meeting items */
export function formatMeetingDate(date?: Date | string | null): string {
  const d = toValidDate(date);
  if (!d) return '';
  return format(d, 'MMM d');
}

/** Format a readable date and time for meeting metadata */
export function formatMeetingDateTime(date?: Date | string | null): string {
  const d = toValidDate(date);
  if (!d) return '';
  return format(d, 'MMMM d, yyyy h:mm a');
}

/** Format as relative group header: "Today", "Yesterday", or "DD/MM/YY" */
export function formatRelativeDate(date?: Date | string | null): string {
  const d = toValidDate(date);
  if (!d) return 'Recent';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd/MM/yy');
}

/** Format duration in seconds to human-readable: "1h 23m" or "5 mins" */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''}`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

/** Format recording timer as MM:SS */
export function formatRecordingTimer(seconds: number): string {
  const mins = Math.floor(Math.abs(seconds) / 60);
  const secs = Math.floor(Math.abs(seconds) % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** Format time of day: "10:58 am" */
export function formatTimeOfDay(date: Date | string): string {
  const d = toValidDate(date);
  if (!d) return '';
  return format(d, 'h:mm a');
}
