'use strict';

import type { AppSettings, DownloadRecord, DownloadRequestPayload, DownloadRecordPatch } from '../../types/jable';
import {
  capturedSegmentCountFromResumeManifest,
  downloadResumeManifestSegmentCount,
  downloadSegmentFilePath,
  downloadSegmentTempDirectory,
  prepareDownloadSegmentTempDirectory
} from './segment-workspace';

export type HlsPlaybackBackgroundCompletionWorker = (signal: AbortSignal) => Promise<void>;
export type HlsPlaybackCapturePlan = {
  videoUrl: string;
  playlistUrl: string;
  segmentCount: number;
  segments: Array<{
    url: string;
    filePath: string;
  }>;
};
export type HlsPlaybackCapturePreparePayload = {
  videoUrl: string;
  pageLoadId?: string | null;
  userInitiatedPlayback?: boolean | null;
  title: string | null;
  views: number | null;
  likes: number | null;
  img: string | null;
  preview: string | null;
  sourcePageChineseSubtitleNotice?: boolean | null;
  sourcePageSubtitleNoticeText?: string | null;
  playlistUrl: string;
  playlistText: string;
};
export type HlsPlaybackCaptureSegmentPayload = {
  videoUrl: string;
  pageLoadId?: string | null;
  filePath: string;
};
export type HlsPlaybackCaptureCompletePayload = {
  videoUrl: string;
  pageLoadId?: string | null;
};
export type HlsPlaybackBackgroundCompletionPayload = HlsPlaybackCaptureCompletePayload & {
  run: HlsPlaybackBackgroundCompletionWorker;
};

type HlsKey = {
  method: string;
  uri: string | null;
  iv: string | null;
};
type HlsSegment = {
  url: string;
  duration: number | null;
  key: HlsKey | null;
};
type HlsPlaylist = {
  variants: Array<{ url: string; bandwidth: number | null }>;
  segments: HlsSegment[];
  targetDuration: number | null;
};
type SourcePageChineseSubtitleNotice = {
  sourcePageChineseSubtitleNotice: boolean;
  sourcePageSubtitleNoticeText: string | null;
};
type DownloadPlaybackCaptureControllerOptions = {
  canonicalVideoUrl(value: unknown): string | null;
  downloadOutputRelativePath(payload: DownloadRequestPayload): string;
  downloadRecordWithRuntimeProgress(record: DownloadRecord): DownloadRecord;
  downloadRecordWithRuntimeState(record: DownloadRecord): DownloadRecord;
  ensureDownloadRootReady(): void;
  getAppSettings(): AppSettings;
  getPersistedDownload(videoUrl: string): DownloadRecord | null;
  hasQueuedOrActiveDownload(videoUrl: string): boolean;
  isPathInsideDirectory(filePath: string, directoryPath: string): boolean;
  isPlaybackBackgroundQueuedOrActive(videoUrl: string): boolean;
  markResumedDownload(videoUrl: string): void;
  notifyDownloadsChanged(): void;
  parseHlsPlaylist(content: string, playlistUrl: string): HlsPlaylist;
  queueDownloadRecord(
    record: DownloadRecord,
    source: 'normal' | 'playback_background',
    worker?: HlsPlaybackBackgroundCompletionWorker
  ): void;
  resolveManagedDownloadPath(fileRelativePath: string | null): string | null;
  upsertDownloadVideoMetadata(payload: DownloadRequestPayload): void;
  upsertPersistedDownload(patch: DownloadRecordPatch): DownloadRecord;
  videoUrlSlug(videoUrl: string): string;
};

export type DownloadPlaybackCaptureController = {
  activeDownloadUrls(): string[];
  allow(videoUrl: string): void;
  clearAfterActiveDownload(videoUrl: string): void;
  clearAutoQueued(videoUrl: string): void;
  completeHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): void;
  isActiveDownload(videoUrl: string): boolean;
  prepareHlsPlaybackCapture(value: HlsPlaybackCapturePreparePayload): HlsPlaybackCapturePlan | null;
  queueHlsPlaybackBackgroundCompletion(value: HlsPlaybackBackgroundCompletionPayload): void;
  recordHlsPlaybackCaptureSegment(value: HlsPlaybackCaptureSegmentPayload): void;
  runtimeProgress(videoUrl: string): number | null;
  shouldContinueHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): boolean;
  shouldProxyHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): boolean;
  suppress(videoUrl: string): void;
};

export function createDownloadPlaybackCaptureController(
  options: DownloadPlaybackCaptureControllerOptions
): DownloadPlaybackCaptureController {
  const progressNotifications = new Map<string, { captured: number; notifiedAt: number; total: number }>();
  const activeDownloadUrls = new Set<string>();
  const activePageLoadIds = new Map<string, string>();
  const autoQueuedUrls = new Set<string>();
  const runtimeProgress = new Map<string, number>();
  const suppressedPageLoadIds = new Map<string, string | null>();

  function playbackCaptureDownloadPayload(
    videoUrl: string,
    metadata: {
      title: string | null;
      views: number | null;
      likes: number | null;
      img: string | null;
      preview: string | null;
    }
  ): DownloadRequestPayload {
    const cleanTitle = playbackCaptureCleanTitle(metadata.title);

    return {
      collectionKey: 'favourites',
      video: {
        title: cleanTitle || options.videoUrlSlug(videoUrl),
        url: videoUrl,
        views: metadata.views,
        likes: metadata.likes,
        img: metadata.img,
        preview: metadata.preview
      }
    };
  }

  function playbackCaptureCleanTitle(value: string | null): string | null {
    if (!value) return null;
    const title = value
      .replace(/\s+/g, ' ')
      .replace(/\s*[-|]\s*Jable\.TV\b.*$/i, '')
      .trim();
    return title || null;
  }

  function playbackCaptureMetadata(value: Partial<HlsPlaybackCapturePreparePayload> | null | undefined) {
    const sourcePageChineseSubtitleNotice =
      typeof value?.sourcePageChineseSubtitleNotice === 'boolean' ? value.sourcePageChineseSubtitleNotice : null;

    return {
      title: typeof value?.title === 'string' && value.title.trim() ? value.title.trim() : null,
      views: typeof value?.views === 'number' && Number.isFinite(value.views) ? value.views : null,
      likes: typeof value?.likes === 'number' && Number.isFinite(value.likes) ? value.likes : null,
      img: typeof value?.img === 'string' && value.img.trim() ? value.img.trim() : null,
      preview: typeof value?.preview === 'string' && value.preview.trim() ? value.preview.trim() : null,
      sourcePageChineseSubtitleNotice: sourcePageChineseSubtitleNotice,
      sourcePageSubtitleNoticeText:
        sourcePageChineseSubtitleNotice === true && typeof value?.sourcePageSubtitleNoticeText === 'string'
          ? value.sourcePageSubtitleNoticeText.trim() || null
          : null
    };
  }

  function playbackCaptureSourcePageNotice(
    metadata: ReturnType<typeof playbackCaptureMetadata>,
    existingRecord: DownloadRecord | null
  ): SourcePageChineseSubtitleNotice {
    if (metadata.sourcePageChineseSubtitleNotice !== null) {
      return {
        sourcePageChineseSubtitleNotice: metadata.sourcePageChineseSubtitleNotice,
        sourcePageSubtitleNoticeText: metadata.sourcePageSubtitleNoticeText
      };
    }

    return {
      sourcePageChineseSubtitleNotice: existingRecord ? existingRecord.sourcePageChineseSubtitleNotice : false,
      sourcePageSubtitleNoticeText: existingRecord ? existingRecord.sourcePageSubtitleNoticeText : null
    };
  }

  function playbackCapturePageLoadId(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function playbackCaptureUserInitiated(value: unknown): boolean {
    return Boolean(value);
  }

  function playbackCaptureSegmentFiles(outputPath: string, playlist: HlsPlaylist): HlsPlaybackCapturePlan['segments'] {
    return playlist.segments.map(function (segment, index) {
      return {
        url: segment.url,
        filePath: downloadSegmentFilePath(outputPath, index, segment.url)
      };
    });
  }

  function suppress(videoUrl: string) {
    activeDownloadUrls.delete(videoUrl);
    runtimeProgress.delete(videoUrl);
    progressNotifications.delete(videoUrl);
    suppressedPageLoadIds.set(videoUrl, activePageLoadIds.get(videoUrl) || null);
  }

  function allow(videoUrl: string) {
    suppressedPageLoadIds.delete(videoUrl);
  }

  function isPlaybackAutoResumeBlockedRecord(record: DownloadRecord | null): boolean {
    return Boolean(record && record.state === 'paused' && record.playbackAutoResumeBlocked);
  }

  function hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl: string, pageLoadId: string | null): boolean {
    if (!suppressedPageLoadIds.has(videoUrl)) return false;

    const suppressedPageLoadId = suppressedPageLoadIds.get(videoUrl) || null;
    if (!suppressedPageLoadId) {
      suppressedPageLoadIds.delete(videoUrl);
      return false;
    }
    if (!pageLoadId) return true;
    if (suppressedPageLoadId === pageLoadId) return true;

    suppressedPageLoadIds.delete(videoUrl);
    return false;
  }

  function prepareHlsPlaybackCapture(value: HlsPlaybackCapturePreparePayload): HlsPlaybackCapturePlan | null {
    const videoUrl = options.canonicalVideoUrl(value && value.videoUrl);
    const pageLoadId = playbackCapturePageLoadId(value && value.pageLoadId);
    const playlistUrl = typeof value.playlistUrl === 'string' ? value.playlistUrl : '';
    const playlistText = typeof value.playlistText === 'string' ? value.playlistText : '';
    const metadata = playbackCaptureMetadata(value);
    if (!videoUrl || !playlistUrl || !playlistText) return null;
    if (hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, pageLoadId)) return null;
    if (!playbackCaptureUserInitiated(value.userInitiatedPlayback)) return null;

    let playlist: HlsPlaylist;
    try {
      playlist = options.parseHlsPlaylist(playlistText, playlistUrl);
    } catch (error) {
      return null;
    }
    if (!playlist.segments.length) return null;

    const existing = options.getPersistedDownload(videoUrl);
    const existingRecord = existing ? options.downloadRecordWithRuntimeState(existing) : null;
    if (isPlaybackAutoResumeBlockedRecord(existingRecord)) return null;
    // Normal records have been explicitly formalized by the user; playback must not retry or replace them.
    if (existingRecord && existingRecord.downloadSource === 'normal') return null;
    if (
      existingRecord &&
      (existingRecord.state === 'queued' || existingRecord.state === 'downloading' || existingRecord.state === 'ready')
    ) {
      return null;
    }

    try {
      options.ensureDownloadRootReady();
    } catch (error) {
      return null;
    }

    const localPath =
      existingRecord && existingRecord.localPath && options.resolveManagedDownloadPath(existingRecord.localPath)
        ? existingRecord.localPath
        : options.downloadOutputRelativePath(playbackCaptureDownloadPayload(videoUrl, metadata));
    const outputPath = options.resolveManagedDownloadPath(localPath);
    if (!outputPath) return null;

    try {
      prepareDownloadSegmentTempDirectory(outputPath, playlist, true);
    } catch (error) {
      return null;
    }

    const payload = playbackCaptureDownloadPayload(videoUrl, metadata);
    const sourcePageNotice = playbackCaptureSourcePageNotice(metadata, existingRecord);
    const activePlaybackDownload = Boolean(options.getAppSettings().autoDownloadOnPlayback);
    if (pageLoadId) activePageLoadIds.set(videoUrl, pageLoadId);
    if (activePlaybackDownload) activeDownloadUrls.add(videoUrl);
    options.upsertDownloadVideoMetadata(payload);
    options.upsertPersistedDownload({
      videoUrl: videoUrl,
      title:
        existingRecord && existingRecord.title
          ? playbackCaptureCleanTitle(existingRecord.title) || payload.video.title
          : payload.video.title,
      img: payload.video.img || (existingRecord ? existingRecord.img : null),
      preview: payload.video.preview || (existingRecord ? existingRecord.preview : null),
      sourcePageChineseSubtitleNotice: sourcePageNotice.sourcePageChineseSubtitleNotice,
      sourcePageSubtitleNoticeText: sourcePageNotice.sourcePageSubtitleNoticeText,
      downloadSource: 'playback_auto',
      localPath: localPath,
      state: activePlaybackDownload ? 'queued' : 'paused',
      progress: activePlaybackDownload
        ? null
        : existingRecord && typeof existingRecord.progress === 'number'
          ? existingRecord.progress
          : 0,
      playbackAutoResumeBlocked: false,
      error: null,
      failurePhase: null,
      failureCode: null,
      lastStartedAt: existingRecord ? existingRecord.lastStartedAt : null,
      completedAt: null
    });
    options.notifyDownloadsChanged();

    return {
      videoUrl: videoUrl,
      playlistUrl: playlistUrl,
      segmentCount: playlist.segments.length,
      segments: playbackCaptureSegmentFiles(outputPath, playlist)
    };
  }

  function shouldNotifyHlsPlaybackCaptureProgress(videoUrl: string, captured: number, total: number): boolean {
    const now = Date.now();
    const previous = progressNotifications.get(videoUrl) || null;
    const shouldNotify =
      !previous || captured >= total || total !== previous.total || now - previous.notifiedAt >= 1000;
    if (!shouldNotify) return false;

    progressNotifications.set(videoUrl, {
      captured: captured,
      total: total,
      notifiedAt: now
    });
    return true;
  }

  function queueCompletedHlsPlaybackCapture(record: DownloadRecord, captured: number, total: number) {
    if (!options.getAppSettings().autoDownloadOnPlayback) return;
    if (record.downloadSource !== 'playback_auto') return;
    if (
      captured < total ||
      (record.state !== 'paused' && record.state !== 'queued' && record.state !== 'downloading')
    ) {
      return;
    }
    if (autoQueuedUrls.has(record.videoUrl)) return;
    if (options.hasQueuedOrActiveDownload(record.videoUrl)) return;

    autoQueuedUrls.add(record.videoUrl);
    activeDownloadUrls.delete(record.videoUrl);
    runtimeProgress.delete(record.videoUrl);
    progressNotifications.delete(record.videoUrl);
    options.markResumedDownload(record.videoUrl);
    const queued = options.upsertPersistedDownload({
      videoUrl: record.videoUrl,
      downloadSource: 'playback_auto',
      state: 'queued',
      progress: null,
      playbackAutoResumeBlocked: false,
      error: null,
      failurePhase: null,
      failureCode: null,
      completedAt: null
    });
    options.queueDownloadRecord(queued, 'playback_background', async function () {});
  }

  function recordHlsPlaybackCaptureSegment(value: HlsPlaybackCaptureSegmentPayload) {
    const videoUrl = options.canonicalVideoUrl(value && value.videoUrl);
    const pageLoadId = playbackCapturePageLoadId(value && value.pageLoadId);
    const filePath = typeof value.filePath === 'string' ? value.filePath : '';
    if (!videoUrl || !filePath) return;
    if (hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, pageLoadId)) return;

    const record = options.getPersistedDownload(videoUrl);
    if (!record || !record.localPath) return;
    if (isPlaybackAutoResumeBlockedRecord(record)) return;

    const outputPath = options.resolveManagedDownloadPath(record.localPath);
    if (!outputPath) return;

    const tempDir = downloadSegmentTempDirectory(outputPath);
    if (!options.isPathInsideDirectory(filePath, tempDir)) return;

    const segmentCount = downloadResumeManifestSegmentCount(outputPath);
    if (!segmentCount) return;

    const captured = capturedSegmentCountFromResumeManifest(outputPath);
    const progress = Math.max(0, Math.min(1, captured / segmentCount));
    if ((record.state === 'queued' || record.state === 'downloading') && activeDownloadUrls.has(videoUrl)) {
      if (record.state === 'downloading') {
        runtimeProgress.set(videoUrl, progress);
        if (shouldNotifyHlsPlaybackCaptureProgress(videoUrl, captured, segmentCount)) options.notifyDownloadsChanged();
      }
      queueCompletedHlsPlaybackCapture(options.downloadRecordWithRuntimeProgress(record), captured, segmentCount);
      return;
    }

    const updated = options.upsertPersistedDownload({
      videoUrl: videoUrl,
      state: record.state === 'failed' || record.state === 'missing' ? 'paused' : record.state,
      progress: progress,
      playbackAutoResumeBlocked: false,
      error: null,
      failurePhase: null,
      failureCode: null
    });

    if (shouldNotifyHlsPlaybackCaptureProgress(videoUrl, captured, segmentCount)) options.notifyDownloadsChanged();
    queueCompletedHlsPlaybackCapture(updated, captured, segmentCount);
  }

  function completeHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload) {
    const videoUrl = options.canonicalVideoUrl(value && value.videoUrl);
    const pageLoadId = playbackCapturePageLoadId(value && value.pageLoadId);
    if (!videoUrl) return;

    const hasPlaybackBackgroundOwnership = options.isPlaybackBackgroundQueuedOrActive(videoUrl);
    if (!hasPlaybackBackgroundOwnership) {
      activeDownloadUrls.delete(videoUrl);
      runtimeProgress.delete(videoUrl);
      progressNotifications.delete(videoUrl);
    }
    if (hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, pageLoadId)) return;

    const record = options.getPersistedDownload(videoUrl);
    if (!record || !record.localPath) return;
    if (isPlaybackAutoResumeBlockedRecord(record)) return;

    const outputPath = options.resolveManagedDownloadPath(record.localPath);
    if (!outputPath) return;

    const segmentCount = downloadResumeManifestSegmentCount(outputPath);
    if (!segmentCount) return;

    const captured = capturedSegmentCountFromResumeManifest(outputPath);
    const progress = Math.max(0, Math.min(1, captured / segmentCount));
    const current = options.getPersistedDownload(videoUrl);
    if (!current) return;

    if (captured >= segmentCount) {
      queueCompletedHlsPlaybackCapture(current, captured, segmentCount);
      return;
    }
    if (hasPlaybackBackgroundOwnership) return;

    options.upsertPersistedDownload({
      videoUrl: videoUrl,
      state: 'paused',
      progress: progress,
      playbackAutoResumeBlocked: false,
      error: null,
      failurePhase: null,
      failureCode: null
    });
    options.notifyDownloadsChanged();
  }

  function queueHlsPlaybackBackgroundCompletion(value: HlsPlaybackBackgroundCompletionPayload) {
    const videoUrl = options.canonicalVideoUrl(value && value.videoUrl);
    if (!videoUrl || typeof value.run !== 'function') return;
    if (!options.getAppSettings().autoDownloadOnPlayback) return;
    if (hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, playbackCapturePageLoadId(value.pageLoadId))) return;

    const record = options.getPersistedDownload(videoUrl);
    const currentRecord = record ? options.downloadRecordWithRuntimeState(record) : null;
    if (!currentRecord || !currentRecord.localPath) return;
    if (currentRecord.downloadSource !== 'playback_auto') return;
    if (isPlaybackAutoResumeBlockedRecord(currentRecord)) return;
    if (currentRecord.state === 'ready' || currentRecord.state === 'downloading') return;

    const queued =
      currentRecord.state === 'queued'
        ? currentRecord
        : options.upsertPersistedDownload({
            videoUrl: currentRecord.videoUrl,
            downloadSource: 'playback_auto',
            state: 'queued',
            progress: null,
            playbackAutoResumeBlocked: false,
            error: null,
            failurePhase: null,
            failureCode: null,
            completedAt: null
          });
    options.queueDownloadRecord(queued, 'playback_background', value.run);
  }

  function shouldContinueHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): boolean {
    const videoUrl = options.canonicalVideoUrl(value && value.videoUrl);
    const pageLoadId = playbackCapturePageLoadId(value && value.pageLoadId);
    if (!options.getAppSettings().autoDownloadOnPlayback) return false;
    if (!videoUrl || hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, pageLoadId)) return false;

    const record = options.getPersistedDownload(videoUrl);
    if (!record || !record.localPath) return false;
    return record.state === 'downloading' || activeDownloadUrls.has(videoUrl);
  }

  function shouldProxyHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): boolean {
    const videoUrl = options.canonicalVideoUrl(value && value.videoUrl);
    const pageLoadId = playbackCapturePageLoadId(value && value.pageLoadId);
    if (!videoUrl) return false;
    const record = options.getPersistedDownload(videoUrl);
    if (isPlaybackAutoResumeBlockedRecord(record)) return false;
    return !hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, pageLoadId);
  }

  function clearAfterActiveDownload(videoUrl: string) {
    runtimeProgress.delete(videoUrl);
    progressNotifications.delete(videoUrl);
    activeDownloadUrls.delete(videoUrl);
    autoQueuedUrls.delete(videoUrl);
  }

  return {
    activeDownloadUrls: function () {
      return Array.from(activeDownloadUrls);
    },
    allow: allow,
    clearAfterActiveDownload: clearAfterActiveDownload,
    clearAutoQueued: function (videoUrl: string) {
      autoQueuedUrls.delete(videoUrl);
    },
    completeHlsPlaybackCapture: completeHlsPlaybackCapture,
    isActiveDownload: function (videoUrl: string) {
      return activeDownloadUrls.has(videoUrl);
    },
    prepareHlsPlaybackCapture: prepareHlsPlaybackCapture,
    queueHlsPlaybackBackgroundCompletion: queueHlsPlaybackBackgroundCompletion,
    recordHlsPlaybackCaptureSegment: recordHlsPlaybackCaptureSegment,
    runtimeProgress: function (videoUrl: string) {
      return runtimeProgress.get(videoUrl) ?? null;
    },
    shouldContinueHlsPlaybackCapture: shouldContinueHlsPlaybackCapture,
    shouldProxyHlsPlaybackCapture: shouldProxyHlsPlaybackCapture,
    suppress: suppress
  };
}
