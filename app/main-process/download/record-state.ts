'use strict';

import type * as NodeFs from 'node:fs';
import type { DownloadRecord, DownloadRecordPatch } from '../../types/jable';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type DownloadRuntimeProgress = {
  downloadedBytes: number | null;
  downloadSpeedBytesPerSecond: number | null;
};

export type DownloadRecordStateController = {
  listDownloads(): DownloadRecord[];
  reconcileDownloadRecordFileState(record: DownloadRecord): DownloadRecord;
  recordWithRuntimeProgress(record: DownloadRecord): DownloadRecord;
  recordWithRuntimeState(record: DownloadRecord): DownloadRecord;
};

type DownloadRecordStateControllerOptions = {
  fs: typeof NodeFs;
  hasActiveDownload(videoUrl: string): boolean;
  hasQueuedDownload(videoUrl: string): boolean;
  isPlaybackCaptureActive(videoUrl: string): boolean;
  listPersistedDownloads(): DownloadRecord[];
  notifyDownloadsChanged(): void;
  playbackCaptureRuntimeProgress(videoUrl: string): number | null;
  resolveManagedDownloadPath(fileRelativePath: string | null): string | null;
  runtimeProgress(videoUrl: string): DownloadRuntimeProgress | null;
  t(key: string, params?: TranslationParams | null): string;
  upsertPersistedDownload(patch: DownloadRecordPatch): DownloadRecord;
};

export function createDownloadRecordStateController(
  options: DownloadRecordStateControllerOptions
): DownloadRecordStateController {
  function downloadRecordFileStats(record: DownloadRecord): NodeFs.Stats | null {
    const filePath = options.resolveManagedDownloadPath(record.localPath);
    if (!filePath) return null;
    try {
      return options.fs.statSync(filePath);
    } catch (error) {
      return null;
    }
  }

  function recordWithFileState(record: DownloadRecord): DownloadRecord {
    if (record.state !== 'ready' && record.state !== 'missing') return record;

    const stats = downloadRecordFileStats(record);
    const exists = Boolean(stats && stats.isFile());
    if (record.state === 'ready' && !exists) {
      return Object.assign({}, record, {
        state: 'missing' as const,
        fileSizeBytes: null,
        error: null
      });
    }
    if (record.state === 'missing' && exists) {
      return Object.assign({}, record, {
        state: 'ready' as const,
        error: null,
        fileSizeBytes: stats ? stats.size : record.fileSizeBytes
      });
    }
    if (record.state === 'ready' && exists && stats && record.fileSizeBytes !== stats.size) {
      return Object.assign({}, record, {
        fileSizeBytes: stats.size
      });
    }

    return record;
  }

  function recordWithRuntimeState(record: DownloadRecord): DownloadRecord {
    const fileRecord = recordWithFileState(record);
    if (fileRecord.state !== 'queued' && fileRecord.state !== 'downloading') return fileRecord;

    const isActive = options.hasActiveDownload(fileRecord.videoUrl);
    const isCapturingPlayback = options.isPlaybackCaptureActive(fileRecord.videoUrl);
    const isQueued = options.hasQueuedDownload(fileRecord.videoUrl);
    if (isActive || isCapturingPlayback || isQueued) return fileRecord;

    return Object.assign({}, fileRecord, {
      state: 'paused' as const,
      progress: null,
      error: options.t('status.downloadPausedAfterRestart'),
      failurePhase: null,
      failureCode: null,
      lastErrorAt: null
    });
  }

  function recordWithRuntimeProgress(record: DownloadRecord): DownloadRecord {
    if (record.state !== 'downloading') return record;

    const hlsPlaybackProgress = options.playbackCaptureRuntimeProgress(record.videoUrl);
    if (typeof hlsPlaybackProgress === 'number') {
      return Object.assign({}, record, {
        progress: hlsPlaybackProgress
      });
    }

    const runtimeProgress = options.runtimeProgress(record.videoUrl);
    if (!runtimeProgress) return record;

    return Object.assign({}, record, {
      downloadedBytes: runtimeProgress.downloadedBytes,
      downloadSpeedBytesPerSecond: runtimeProgress.downloadSpeedBytesPerSecond
    });
  }

  function downloadRecordNeedsPersistence(current: DownloadRecord, next: DownloadRecord): boolean {
    return (
      current.state !== next.state ||
      current.progress !== next.progress ||
      current.error !== next.error ||
      current.fileSizeBytes !== next.fileSizeBytes ||
      current.failurePhase !== next.failurePhase ||
      current.failureCode !== next.failureCode ||
      current.lastErrorAt !== next.lastErrorAt
    );
  }

  function reconcileDownloadRecordFileState(record: DownloadRecord): DownloadRecord {
    const next = recordWithFileState(record);
    if (!downloadRecordNeedsPersistence(record, next)) return next;

    const persisted = options.upsertPersistedDownload({
      videoUrl: next.videoUrl,
      state: next.state,
      progress: next.progress,
      error: next.error,
      fileSizeBytes: next.fileSizeBytes,
      failurePhase: next.failurePhase,
      failureCode: next.failureCode,
      lastErrorAt: next.lastErrorAt
    });
    options.notifyDownloadsChanged();
    return persisted;
  }

  function listDownloads(): DownloadRecord[] {
    return options.listPersistedDownloads().map(function (record) {
      const next = recordWithRuntimeState(record);
      if (!downloadRecordNeedsPersistence(record, next)) return recordWithRuntimeProgress(next);

      const persisted = options.upsertPersistedDownload({
        videoUrl: next.videoUrl,
        state: next.state,
        progress: next.progress,
        error: next.error,
        fileSizeBytes: next.fileSizeBytes,
        failurePhase: next.failurePhase,
        failureCode: next.failureCode,
        lastErrorAt: next.lastErrorAt
      });
      return recordWithRuntimeProgress(persisted);
    });
  }

  return {
    listDownloads: listDownloads,
    reconcileDownloadRecordFileState: reconcileDownloadRecordFileState,
    recordWithRuntimeProgress: recordWithRuntimeProgress,
    recordWithRuntimeState: recordWithRuntimeState
  };
}
