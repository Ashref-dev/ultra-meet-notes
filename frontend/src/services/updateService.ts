/**
 * Update Service
 *
 * Checks for updates by fetching the latest release from GitHub.
 */

import { getVersion } from '@tauri-apps/api/app';

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  version?: string;
  date?: string;
  body?: string;
  downloadUrl?: string;
}

const GITHUB_REPO = 'Ashref-dev/ultra-meet-notes';

export class UpdateService {
  private updateCheckInProgress = false;
  private lastCheckTime: number | null = null;
  private readonly CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

  async checkForUpdates(force = false): Promise<UpdateInfo> {
    if (this.updateCheckInProgress) {
      throw new Error('Update check already in progress');
    }

    if (!force && this.lastCheckTime) {
      const timeSinceLastCheck = Date.now() - this.lastCheckTime;
      if (timeSinceLastCheck < this.CHECK_INTERVAL_MS) {
        return { available: false, currentVersion: await getVersion() };
      }
    }

    this.updateCheckInProgress = true;
    this.lastCheckTime = Date.now();

    try {
      const currentVersion = await getVersion();

      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        { headers: { Accept: 'application/vnd.github+json' } }
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const release = await response.json() as {
        tag_name: string;
        published_at: string;
        body: string;
        html_url: string;
      };

      const latestVersion = release.tag_name.replace(/^v/, '');
      const isNewer = compareVersions(latestVersion, currentVersion) > 0;

      return {
        available: isNewer,
        currentVersion,
        version: latestVersion,
        date: release.published_at,
        body: release.body,
        downloadUrl: release.html_url,
      };
    } catch (error) {
      console.error('Failed to check for updates:', error);
      throw error;
    } finally {
      this.updateCheckInProgress = false;
    }
  }

  async getCurrentVersion(): Promise<string> {
    return getVersion();
  }

  wasCheckedRecently(): boolean {
    if (!this.lastCheckTime) return false;
    return Date.now() - this.lastCheckTime < this.CHECK_INTERVAL_MS;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const updateService = new UpdateService();
