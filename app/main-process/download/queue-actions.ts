'use strict';

import type * as NodeChildProcess from 'node:child_process';
import type {
  BulkDownloadActionResult,
  CancelDownloadResult,
  DownloadRecord,
  DownloadRecordPatch,
  DownloadRequestPayload,
  EnqueueDownloadResult,
  PauseDownloadResult
} from '../../types/jable';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type DownloadQueueSource = 'normal' | 'playback_background';
type DownloadQueueActionRuntime = {
  source: DownloadQueueSource;
  abortController: AbortController;
  nativeId: string | null;
  process: Pick<NodeChildProcess.ChildProcess, 'kill'> | null;
};
type DownloadQueueActionItem = {
  source: DownloadQueueSource;
  videoUrl: string;
};

export type DownloadQueueActionsController = {
  cancelDownload(value: unknown): CancelDownloadResult;
  cancelQueuedDownloads(): BulkDownloadActionResult;
  enqueueDownload(value: unknown): Promise<EnqueueDownloadResult>;
  pauseAllDownloads(): BulkDownloadActionResult;
  pauseDownload(value: unknown): PauseDownloadResult;
  pausePlaybackAutoDownload(videoUrl: string): boolean;
  pausePlaybackAutoDownloadsForSettingDisable(): BulkDownloadActionResult;
  resumeDownload(value: unknown): Promise<EnqueueDownloadResult>;
  resumePausedDownloads(): Promise<BulkDownloadActionResult>;
  retryDownload(value: unknown): Promise<EnqueueDownloadResult>;
  retryFailedDownloads(): Promise<BulkDownloadActionResult>;
};

type DownloadQueueActionsControllerOptions = {
  activePlaybackCaptureUrls(): string[];
  activeRuntime(videoUrl: string): DownloadQueueActionRuntime | null;
  activeRuntimeEntries(): Array<[string, DownloadQueueActionRuntime]>;
  allowPlaybackCapture(videoUrl: string): void;
  canonicalVideoUrl(value: unknown): string | null;
  cancelNativeDownload(nativeId: string): void;
  clearCanceled(videoUrl: string): void;
  clearPaused(videoUrl: string): void;
  clearResumed(videoUrl: string): void;
  downloadOutputRelativePath(payload: DownloadRequestPayload): string;
  downloadTimestamp(): string;
  ensureDownloadRootReady(): void;
  ffmpegCommandForDownload(): Promise<string>;
  getPersistedDownload(videoUrl: string): DownloadRecord | null;
  isPlaybackCaptureActive(videoUrl: string): boolean;
  listDownloads(): DownloadRecord[];
  listPersistedDownloads(): DownloadRecord[];
  normalizeDownloadRequestPayload(value: unknown): DownloadRequestPayload;
  normalizeDownloadVideoUrl(value: unknown, field: string, channel: string): string;
  notifyDownloadsChanged(): void;
  queueDownloadRecord(record: DownloadRecord, source?: DownloadQueueSource): void;
  queuedItems(): DownloadQueueActionItem[];
  queuedItem(videoUrl: string): DownloadQueueActionItem | null;
  recordWithRuntimeState(record: DownloadRecord): DownloadRecord;
  reportError?(event: string, error: unknown, details?: unknown): void;
  removeDownloadWorkingFiles(record: DownloadRecord): void;
  removePartialDownloadFileForRecord(record: DownloadRecord): void;
  removeQueuedDownload(videoUrl: string): boolean;
  setCanceled(videoUrl: string): void;
  setPaused(videoUrl: string): void;
  setResumed(videoUrl: string): void;
  suppressPlaybackCapture(videoUrl: string): void;
  t(key: string, params?: TranslationParams | null): string;
  upsertDownloadVideoMetadata(payload: DownloadRequestPayload): void;
  upsertPersistedDownload(patch: DownloadRecordPatch): DownloadRecord;
};

export function createDownloadQueueActionsController(
  options: DownloadQueueActionsControllerOptions
): DownloadQueueActionsController {
  function emptyBulkDownloadActionResult(requested: number): BulkDownloadActionResult {
    return {
      requested: requested,
      affected: 0,
      skipped: 0,
      failed: 0
    };
  }

  function recordBulkDownloadActionOutcome(result: BulkDownloadActionResult, affected: boolean) {
    if (affected) result.affected += 1;
    else result.skipped += 1;
  }

  function recordBulkDownloadActionFailure(result: BulkDownloadActionResult, error: unknown, videoUrl?: string) {
    result.failed += 1;
    if (options.reportError) {
      options.reportError('bulk-download-action-failed', error, {
        videoUrl: videoUrl || null
      });
    }
    console.error(error);
  }

  async function runAsyncBulkDownloadAction(
    records: DownloadRecord[],
    action: (record: DownloadRecord) => Promise<boolean>
  ): Promise<BulkDownloadActionResult> {
    const result = emptyBulkDownloadActionResult(records.length);

    for (const record of records) {
      try {
        recordBulkDownloadActionOutcome(result, await action(record));
      } catch (error) {
        recordBulkDownloadActionFailure(result, error, record.videoUrl);
      }
    }

    return result;
  }

  function runSyncBulkDownloadAction(
    records: DownloadRecord[],
    action: (record: DownloadRecord) => boolean
  ): BulkDownloadActionResult {
    const result = emptyBulkDownloadActionResult(records.length);

    for (const record of records) {
      try {
        recordBulkDownloadActionOutcome(result, action(record));
      } catch (error) {
        recordBulkDownloadActionFailure(result, error, record.videoUrl);
      }
    }

    return result;
  }

  async function enqueueDownload(value: unknown): Promise<EnqueueDownloadResult> {
    const payload = options.normalizeDownloadRequestPayload(value);
    options.allowPlaybackCapture(payload.video.url);
    const existing = options.getPersistedDownload(payload.video.url);
    const existingRecord = existing ? options.recordWithRuntimeState(existing) : null;
    const existingState = existingRecord ? existingRecord.state : null;

    if (
      existingRecord &&
      (existingState === 'queued' || existingState === 'downloading' || existingState === 'ready')
    ) {
      return {
        record: existingRecord,
        queued: false
      };
    }
    if (existingState === 'paused') return resumeDownload(payload.video.url);

    await options.ffmpegCommandForDownload();
    options.ensureDownloadRootReady();

    options.upsertDownloadVideoMetadata(payload);
    const record = options.upsertPersistedDownload({
      videoUrl: payload.video.url,
      title: payload.video.title,
      img: payload.video.img,
      preview: payload.video.preview,
      downloadSource: 'normal',
      localPath: options.downloadOutputRelativePath(payload),
      state: 'queued',
      progress: null,
      playbackAutoResumeBlocked: false,
      error: null,
      completedAt: null
    });

    options.queueDownloadRecord(record);

    return {
      record: record,
      queued: true
    };
  }

  async function retryDownload(value: unknown): Promise<EnqueueDownloadResult> {
    const videoUrl = options.normalizeDownloadVideoUrl(value, 'videoUrl', 'download:retry');
    if (videoUrl) options.allowPlaybackCapture(videoUrl);
    const existing = videoUrl ? options.getPersistedDownload(videoUrl) : null;
    const existingRecord = existing ? options.recordWithRuntimeState(existing) : null;
    const existingState = existingRecord ? existingRecord.state : null;

    if (!existing) throw new Error(options.t('status.downloadFileUnavailable'));
    if (
      existingRecord &&
      (existingState === 'queued' || existingState === 'downloading' || existingState === 'ready')
    ) {
      return {
        record: existingRecord,
        queued: false
      };
    }
    if (existingState === 'paused') return resumeDownload(videoUrl);

    await options.ffmpegCommandForDownload();
    options.ensureDownloadRootReady();

    const record = options.upsertPersistedDownload({
      videoUrl: existing.videoUrl,
      downloadSource: 'normal',
      state: 'queued',
      progress: null,
      playbackAutoResumeBlocked: false,
      error: null,
      completedAt: null
    });
    options.queueDownloadRecord(record);

    return {
      record: record,
      queued: true
    };
  }

  async function retryFailedDownloads(): Promise<BulkDownloadActionResult> {
    const records = options.listDownloads().filter(function (record) {
      return record.state === 'failed' || record.state === 'missing';
    });
    return runAsyncBulkDownloadAction(records, async function (record) {
      const queued = await retryDownload(record.videoUrl);
      return queued.queued;
    });
  }

  async function resumeDownload(value: unknown): Promise<EnqueueDownloadResult> {
    const videoUrl = options.normalizeDownloadVideoUrl(value, 'videoUrl', 'download:resume');
    if (videoUrl) options.allowPlaybackCapture(videoUrl);
    const existing = videoUrl ? options.getPersistedDownload(videoUrl) : null;
    const existingRecord = existing ? options.recordWithRuntimeState(existing) : null;
    const existingState = existingRecord ? existingRecord.state : null;

    if (!existingRecord) throw new Error(options.t('status.downloadFileUnavailable'));
    if (existingState === 'queued' || existingState === 'downloading' || existingState === 'ready') {
      return {
        record: existingRecord,
        queued: false
      };
    }
    if (existingState !== 'paused') throw new Error(options.t('status.downloadResumeUnavailable'));

    await options.ffmpegCommandForDownload();
    options.ensureDownloadRootReady();

    options.clearCanceled(videoUrl);
    options.clearPaused(videoUrl);
    options.setResumed(videoUrl);

    const record = options.upsertPersistedDownload({
      videoUrl: existingRecord.videoUrl,
      downloadSource: 'normal',
      state: 'queued',
      progress: null,
      playbackAutoResumeBlocked: false,
      error: null,
      completedAt: null
    });
    options.queueDownloadRecord(record);

    return {
      record: record,
      queued: true
    };
  }

  async function resumePausedDownloads(): Promise<BulkDownloadActionResult> {
    const records = options.listDownloads().filter(function (record) {
      return record.state === 'paused';
    });
    return runAsyncBulkDownloadAction(records, async function (record) {
      const resumed = await resumeDownload(record.videoUrl);
      return resumed.queued;
    });
  }

  function playbackAutoResumeBlockedAfterPause(
    record: DownloadRecord,
    isNormalDownloaderActive: boolean,
    isNormalDownloaderQueued: boolean,
    isPlaybackCaptureOwned: boolean
  ): boolean {
    if (isNormalDownloaderActive || isNormalDownloaderQueued) return true;
    if (isPlaybackCaptureOwned) return false;
    return record.playbackAutoResumeBlocked;
  }

  function pauseDownload(value: unknown): PauseDownloadResult {
    const videoUrl = options.normalizeDownloadVideoUrl(value, 'videoUrl', 'download:pause');
    const existing = videoUrl ? options.getPersistedDownload(videoUrl) : null;
    const currentRecord = existing ? options.recordWithRuntimeState(existing) : null;
    if (!currentRecord) throw new Error(options.t('status.downloadPauseUnavailable'));

    const runtime = options.activeRuntime(videoUrl);
    const isActive = Boolean(runtime);
    const queuedItem = options.queuedItem(videoUrl);
    const isPlaybackCaptureActive = options.isPlaybackCaptureActive(videoUrl);
    const isQueued = options.removeQueuedDownload(videoUrl);
    if (!isActive && !isPlaybackCaptureActive && !isQueued && currentRecord.state !== 'paused') {
      throw new Error(options.t('status.downloadPauseUnavailable'));
    }

    options.clearCanceled(videoUrl);
    options.setPaused(videoUrl);
    options.suppressPlaybackCapture(videoUrl);
    const playbackAutoResumeBlocked = playbackAutoResumeBlockedAfterPause(
      currentRecord,
      Boolean(runtime && runtime.source === 'normal'),
      Boolean(queuedItem && queuedItem.source === 'normal'),
      isPlaybackCaptureActive ||
        Boolean(runtime && runtime.source === 'playback_background') ||
        Boolean(queuedItem && queuedItem.source === 'playback_background')
    );

    const record = options.upsertPersistedDownload({
      videoUrl: videoUrl,
      state: 'paused',
      progress: null,
      playbackAutoResumeBlocked: playbackAutoResumeBlocked,
      error: options.t('status.downloadPaused'),
      failurePhase: null,
      failureCode: null,
      lastErrorAt: null,
      completedAt: null
    });

    if (runtime) {
      runtime.abortController.abort();
      if (runtime.nativeId) options.cancelNativeDownload(runtime.nativeId);
      if (runtime.process) runtime.process.kill('SIGTERM');
    } else {
      options.removePartialDownloadFileForRecord(record);
    }

    options.notifyDownloadsChanged();

    return {
      paused: currentRecord.state !== 'paused',
      record: record
    };
  }

  function pauseAllDownloads(): BulkDownloadActionResult {
    const records = options.listDownloads().filter(function (record) {
      return record.state === 'queued' || record.state === 'downloading';
    });
    return runSyncBulkDownloadAction(records, function (record) {
      const paused = pauseDownload(record.videoUrl);
      return paused.paused;
    });
  }

  function playbackAutoDownloadUrlsForSettingDisable(): string[] {
    const urls = new Set<string>();
    function addPlaybackAutoVideoUrl(value: string) {
      const videoUrl = options.canonicalVideoUrl(value);
      if (!videoUrl) return;

      const record = options.getPersistedDownload(videoUrl);
      const currentRecord = record ? options.recordWithRuntimeState(record) : null;
      if (!currentRecord || currentRecord.downloadSource !== 'playback_auto') return;
      if (currentRecord.state !== 'queued' && currentRecord.state !== 'downloading') return;

      urls.add(currentRecord.videoUrl);
    }

    for (const item of options.queuedItems()) {
      if (item.source === 'playback_background') addPlaybackAutoVideoUrl(item.videoUrl);
    }
    for (const [videoUrl, runtime] of options.activeRuntimeEntries()) {
      if (runtime.source === 'playback_background') addPlaybackAutoVideoUrl(videoUrl);
    }
    for (const videoUrl of options.activePlaybackCaptureUrls()) {
      addPlaybackAutoVideoUrl(videoUrl);
    }
    for (const record of options.listPersistedDownloads()) {
      if (record.downloadSource === 'playback_auto' && (record.state === 'queued' || record.state === 'downloading')) {
        addPlaybackAutoVideoUrl(record.videoUrl);
      }
    }

    return Array.from(urls);
  }

  function pausePlaybackAutoDownload(videoUrl: string): boolean {
    const record = options.getPersistedDownload(videoUrl);
    const currentRecord = record ? options.recordWithRuntimeState(record) : null;
    if (!currentRecord || currentRecord.downloadSource !== 'playback_auto') return false;

    const paused = pauseDownload(videoUrl);
    return paused.record.state === 'paused';
  }

  function pausePlaybackAutoDownloadsForSettingDisable(): BulkDownloadActionResult {
    const videoUrls = playbackAutoDownloadUrlsForSettingDisable();
    const result = emptyBulkDownloadActionResult(videoUrls.length);

    for (const videoUrl of videoUrls) {
      try {
        recordBulkDownloadActionOutcome(result, pausePlaybackAutoDownload(videoUrl));
      } catch (error) {
        recordBulkDownloadActionFailure(result, error);
      }
    }

    return result;
  }

  function cancelDownload(value: unknown): CancelDownloadResult {
    const videoUrl = options.normalizeDownloadVideoUrl(value, 'videoUrl', 'download:cancel');
    if (!videoUrl) throw new Error(options.t('status.downloadCancelUnavailable'));

    const existing = options.getPersistedDownload(videoUrl);
    const currentRecord = existing ? options.recordWithRuntimeState(existing) : null;
    if (!currentRecord) throw new Error(options.t('status.downloadCancelUnavailable'));

    const runtime = options.activeRuntime(videoUrl);
    const isActive = Boolean(runtime);
    const isPlaybackCaptureActive = options.isPlaybackCaptureActive(videoUrl);
    if (!isActive && !isPlaybackCaptureActive && currentRecord.state !== 'queued') {
      throw new Error(options.t('status.downloadCancelUnavailable'));
    }

    options.removeQueuedDownload(videoUrl);
    if (isActive) options.setCanceled(videoUrl);
    options.clearPaused(videoUrl);
    options.clearResumed(videoUrl);
    options.suppressPlaybackCapture(videoUrl);

    const record = options.upsertPersistedDownload({
      videoUrl: videoUrl,
      state: 'failed',
      progress: null,
      error: options.t('status.downloadCanceled'),
      failurePhase: null,
      failureCode: 'download_canceled',
      lastErrorAt: options.downloadTimestamp(),
      completedAt: null
    });

    if (runtime) {
      runtime.abortController.abort();
      if (runtime.nativeId) options.cancelNativeDownload(runtime.nativeId);
      if (runtime.process) runtime.process.kill('SIGTERM');
    } else {
      options.removeDownloadWorkingFiles(currentRecord);
    }
    options.notifyDownloadsChanged();

    return {
      canceled: true,
      record: record
    };
  }

  function cancelQueuedDownloads(): BulkDownloadActionResult {
    const records = options.listDownloads().filter(function (record) {
      return record.state === 'queued';
    });
    return runSyncBulkDownloadAction(records, function (record) {
      cancelDownload(record.videoUrl);
      return true;
    });
  }

  return {
    cancelDownload: cancelDownload,
    cancelQueuedDownloads: cancelQueuedDownloads,
    enqueueDownload: enqueueDownload,
    pauseAllDownloads: pauseAllDownloads,
    pauseDownload: pauseDownload,
    pausePlaybackAutoDownload: pausePlaybackAutoDownload,
    pausePlaybackAutoDownloadsForSettingDisable: pausePlaybackAutoDownloadsForSettingDisable,
    resumeDownload: resumeDownload,
    resumePausedDownloads: resumePausedDownloads,
    retryDownload: retryDownload,
    retryFailedDownloads: retryFailedDownloads
  };
}
