import type { DownloadRecord, DownloadState } from '../types/jable';

export const DOWNLOAD_SIDEBAR_RECENT_COMPLETED_MS = 30 * 60 * 1000;
export const DOWNLOAD_SIDEBAR_RECENT_COMPLETED_LIMIT = 5;
export const DOWNLOAD_SIDEBAR_ACTIVE_LIMIT = 20;

export type DownloadSidebarRecordSet = {
  records: DownloadRecord[];
  hiddenActiveCount: number;
  hasMoreActive: boolean;
};

const DOWNLOAD_SIDEBAR_ACTIVE_STATE_RANK: Partial<Record<DownloadState, number>> = {
  downloading: 0,
  queued: 1,
  paused: 2,
  failed: 3
};

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function activityTime(record: DownloadRecord): number {
  return (
    parseTime(record.lastStartedAt) ||
    parseTime(record.completedAt) ||
    parseTime(record.updatedAt) ||
    parseTime(record.createdAt)
  );
}

function readyCompletedTime(record: DownloadRecord): number {
  return parseTime(record.completedAt) || parseTime(record.updatedAt);
}

function isCurrentPlaybackAutoRecord(record: DownloadRecord, currentVideoUrl?: string | null): boolean {
  return Boolean(currentVideoUrl && record.videoUrl === currentVideoUrl && record.downloadSource === 'playback_auto');
}

function isCanceledFailure(record: DownloadRecord): boolean {
  return record.state === 'failed' && record.failureCode === 'download_canceled';
}

function isActiveSidebarRecord(record: DownloadRecord): boolean {
  if (isCanceledFailure(record)) return false;
  return Object.prototype.hasOwnProperty.call(DOWNLOAD_SIDEBAR_ACTIVE_STATE_RANK, record.state);
}

function compareSidebarRecords(a: DownloadRecord, b: DownloadRecord, currentVideoUrl?: string | null): number {
  const aCurrent = isCurrentPlaybackAutoRecord(a, currentVideoUrl);
  const bCurrent = isCurrentPlaybackAutoRecord(b, currentVideoUrl);
  if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;

  const aRank = DOWNLOAD_SIDEBAR_ACTIVE_STATE_RANK[a.state] ?? 4;
  const bRank = DOWNLOAD_SIDEBAR_ACTIVE_STATE_RANK[b.state] ?? 4;
  if (aRank !== bRank) return aRank - bRank;

  return activityTime(b) - activityTime(a);
}

function isRecentReady(record: DownloadRecord, now: number): boolean {
  if (record.state !== 'ready') return false;

  const completedTime = readyCompletedTime(record);
  if (!completedTime) return false;

  return now - completedTime <= DOWNLOAD_SIDEBAR_RECENT_COMPLETED_MS;
}

export function downloadSidebarRecords(
  records: DownloadRecord[],
  now: number = Date.now(),
  currentVideoUrl?: string | null,
  activeLimit: number = DOWNLOAD_SIDEBAR_ACTIVE_LIMIT
): DownloadRecord[] {
  return downloadSidebarRecordSet(records, now, currentVideoUrl, activeLimit).records;
}

export function downloadSidebarRecordSet(
  records: DownloadRecord[],
  now: number = Date.now(),
  currentVideoUrl?: string | null,
  activeLimit: number = DOWNLOAD_SIDEBAR_ACTIVE_LIMIT
): DownloadSidebarRecordSet {
  const visibleLimit = Math.max(0, Math.round(activeLimit) || DOWNLOAD_SIDEBAR_ACTIVE_LIMIT);
  const activeRecords = records
    .filter(function (record) {
      return isActiveSidebarRecord(record);
    })
    .slice()
    .sort(function (a, b) {
      return compareSidebarRecords(a, b, currentVideoUrl);
    });
  const recentReadyRecords = records
    .filter(function (record) {
      return isRecentReady(record, now);
    })
    .slice()
    .sort(function (a, b) {
      return compareSidebarRecords(a, b, currentVideoUrl);
    })
    .slice(0, DOWNLOAD_SIDEBAR_RECENT_COMPLETED_LIMIT);

  const visibleActiveRecords = activeRecords.slice(0, visibleLimit);
  const hiddenActiveCount = Math.max(0, activeRecords.length - visibleActiveRecords.length);

  return {
    records: visibleActiveRecords.concat(recentReadyRecords),
    hiddenActiveCount: hiddenActiveCount,
    hasMoreActive: hiddenActiveCount > 0
  };
}
