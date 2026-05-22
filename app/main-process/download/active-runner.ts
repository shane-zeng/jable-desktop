'use strict';

import type * as NodeChildProcess from 'node:child_process';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type { DownloadRecord, DownloadRecordPatch } from '../../types/jable';
import { downloadFailureCode, isDownloadPausedError } from './errors';
import { runFfmpegRemux } from './ffmpeg-remux';
import type { DownloadFailurePhase, HlsPlaylist, SourcePageChineseSubtitleNotice } from './hls-source';
import { removeDownloadSegmentTempDirectory } from './segment-workspace';
import type { LocalPlaybackFile } from '../local-playback/preview';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type DiagnosticsEventLogger = {
  event(level: 'debug' | 'info' | 'warn' | 'error', domain: string, event: string, details?: unknown): void;
  errorEvent(domain: string, event: string, error: unknown, details?: unknown): void;
};

export type DownloadQueueSource = 'normal' | 'playback_background';
export type ActiveDownloadRuntime = {
  abortController: AbortController;
  source: DownloadQueueSource;
  process: NodeChildProcess.ChildProcess | null;
  nativeId: string | null;
};

type DownloadActiveRunnerOptions = {
  clearActiveDownload(videoUrl: string): void;
  clearDownloadFlags(videoUrl: string): void;
  clearPlaybackCaptureAfterActiveDownload(videoUrl: string): void;
  clearRuntimeProgress(videoUrl: string): void;
  downloadCanceledError(): Error;
  downloadErrorMessage(error: unknown): string;
  downloadFileSystemError(error: unknown): Error;
  downloadHlsSegmentsWithPlaylistRefresh(
    playlist: HlsPlaylist,
    videoUrl: string,
    cookieHeader: string,
    outputPath: string,
    signal: AbortSignal,
    runtime: ActiveDownloadRuntime,
    reuseExistingSegments: boolean
  ): Promise<string>;
  downloadPausedError(): Error;
  downloadTimestamp(): string;
  ffmpegCommandForDownload(): Promise<string>;
  isCanceled(videoUrl: string): boolean;
  isDeleted(videoUrl: string): boolean;
  isPaused(videoUrl: string): boolean;
  localPlaybackReadyFile(videoUrl: string): LocalPlaybackFile | null;
  logger?: DiagnosticsEventLogger | null;
  notifyDownloadsChanged(): void;
  path: typeof NodePath;
  removePartialDownloadFile(outputPath: string): void;
  resolveDownloadHlsSource(
    videoUrl: string,
    signal: AbortSignal,
    setFailurePhase?: (phase: DownloadFailurePhase) => void,
    updateSourcePageNotice?: (notice: SourcePageChineseSubtitleNotice) => void
  ): Promise<
    {
      cookieHeader: string;
      playlist: HlsPlaylist;
    } & SourcePageChineseSubtitleNotice
  >;
  resolveManagedDownloadPath(fileRelativePath: string | null): string | null;
  schedulePreviewGeneration(file: LocalPlaybackFile): void;
  statFile(filePath: string): NodeFs.Stats;
  t(key: string, params?: TranslationParams | null): string;
  updateDownloadRuntimeProgress(videoUrl: string, downloadedBytes: number): void;
  upsertPersistedDownload(patch: DownloadRecordPatch): DownloadRecord;
  writeDirectory(directoryPath: string): void;
};

export type DownloadActiveRunner = {
  runActiveDownload(
    record: DownloadRecord,
    runtime: ActiveDownloadRuntime,
    reuseExistingSegments: boolean,
    beforeDownloadSegments?: () => Promise<void>
  ): Promise<void>;
};

export function createDownloadActiveRunner(options: DownloadActiveRunnerOptions): DownloadActiveRunner {
  function logDownloadEvent(level: 'debug' | 'info' | 'warn' | 'error', event: string, details?: unknown) {
    if (options.logger) options.logger.event(level, 'download', event, details);
  }

  function logDownloadError(event: string, error: unknown, details?: unknown) {
    if (options.logger) options.logger.errorEvent('download', event, error, details);
  }

  function markDownloadStarted(record: DownloadRecord) {
    options.upsertPersistedDownload({
      videoUrl: record.videoUrl,
      state: 'downloading',
      progress: null,
      error: null,
      localPath: record.localPath,
      failurePhase: null,
      failureCode: null,
      attemptCount: Math.max(0, record.attemptCount || 0) + 1,
      lastStartedAt: options.downloadTimestamp(),
      lastErrorAt: null
    });
    options.notifyDownloadsChanged();
  }

  function throwIfDownloadCanceled(videoUrl: string) {
    if (options.isPaused(videoUrl)) throw options.downloadPausedError();
    if (options.isCanceled(videoUrl)) throw options.downloadCanceledError();
  }

  function throwIfActiveDownloadStopped(videoUrl: string, signal: AbortSignal) {
    if (options.isPaused(videoUrl)) throw options.downloadPausedError();
    if (signal.aborted || options.isCanceled(videoUrl)) throw options.downloadCanceledError();
    throwIfDownloadCanceled(videoUrl);
  }

  async function runActiveDownload(
    record: DownloadRecord,
    runtime: ActiveDownloadRuntime,
    reuseExistingSegments: boolean,
    beforeDownloadSegments?: () => Promise<void>
  ) {
    const outputPath = options.resolveManagedDownloadPath(record.localPath);
    let failurePhase: DownloadFailurePhase = 'ffmpeg_check';
    const startedAt = Date.now();
    markDownloadStarted(record);
    logDownloadEvent('info', 'active-download-started', {
      videoUrl: record.videoUrl,
      source: runtime.source,
      reuseExistingSegments: reuseExistingSegments,
      attemptCount: Math.max(0, record.attemptCount || 0) + 1
    });

    try {
      failurePhase = 'file';
      if (!outputPath) throw new Error(options.t('status.downloadFileUnavailable'));
      throwIfActiveDownloadStopped(record.videoUrl, runtime.abortController.signal);
      logDownloadEvent('info', 'download-file-prepare-started', {
        videoUrl: record.videoUrl
      });
      try {
        options.writeDirectory(options.path.dirname(outputPath));
      } catch (error) {
        throw options.downloadFileSystemError(error);
      }
      logDownloadEvent('info', 'download-file-prepare-complete', {
        videoUrl: record.videoUrl
      });
      failurePhase = 'ffmpeg_check';
      logDownloadEvent('info', 'download-ffmpeg-check-started', {
        videoUrl: record.videoUrl
      });
      const command = await options.ffmpegCommandForDownload();
      logDownloadEvent('info', 'download-ffmpeg-check-complete', {
        videoUrl: record.videoUrl
      });
      throwIfActiveDownloadStopped(record.videoUrl, runtime.abortController.signal);
      logDownloadEvent('info', 'download-source-resolve-started', {
        videoUrl: record.videoUrl
      });
      const source = await options.resolveDownloadHlsSource(
        record.videoUrl,
        runtime.abortController.signal,
        function (phase) {
          failurePhase = phase;
        },
        function (notice) {
          options.upsertPersistedDownload({
            videoUrl: record.videoUrl,
            sourcePageChineseSubtitleNotice: notice.sourcePageChineseSubtitleNotice,
            sourcePageSubtitleNoticeText: notice.sourcePageSubtitleNoticeText
          });
          options.notifyDownloadsChanged();
        }
      );
      logDownloadEvent('info', 'download-source-resolve-complete', {
        videoUrl: record.videoUrl,
        segmentCount: source.playlist.segments.length,
        sourcePageChineseSubtitleNotice: source.sourcePageChineseSubtitleNotice
      });
      throwIfActiveDownloadStopped(record.videoUrl, runtime.abortController.signal);
      failurePhase = 'segments';
      if (beforeDownloadSegments) {
        await beforeDownloadSegments();
        throwIfActiveDownloadStopped(record.videoUrl, runtime.abortController.signal);
      }
      logDownloadEvent('info', 'download-segments-started', {
        videoUrl: record.videoUrl,
        segmentCount: source.playlist.segments.length
      });
      const localPlaylistPath = await options.downloadHlsSegmentsWithPlaylistRefresh(
        source.playlist,
        record.videoUrl,
        source.cookieHeader,
        outputPath,
        runtime.abortController.signal,
        runtime,
        reuseExistingSegments
      );
      logDownloadEvent('info', 'download-segments-complete', {
        videoUrl: record.videoUrl,
        segmentCount: source.playlist.segments.length
      });
      throwIfActiveDownloadStopped(record.videoUrl, runtime.abortController.signal);

      failurePhase = 'remux';
      logDownloadEvent('info', 'download-remux-started', {
        videoUrl: record.videoUrl
      });
      await runFfmpegRemux(command, localPlaylistPath, record.videoUrl, outputPath, runtime, {
        downloadCanceledError: options.downloadCanceledError,
        downloadFileSystemError: options.downloadFileSystemError,
        downloadPausedError: options.downloadPausedError,
        isCanceled: options.isCanceled,
        isPaused: options.isPaused,
        throwIfDownloadCanceled: throwIfDownloadCanceled,
        updateDownloadRuntimeProgress: options.updateDownloadRuntimeProgress
      });
      logDownloadEvent('info', 'download-remux-complete', {
        videoUrl: record.videoUrl
      });
      throwIfActiveDownloadStopped(record.videoUrl, runtime.abortController.signal);
      let stats: NodeFs.Stats;
      try {
        failurePhase = 'file';
        logDownloadEvent('info', 'download-file-verify-started', {
          videoUrl: record.videoUrl
        });
        stats = options.statFile(outputPath);
      } catch (error) {
        throw options.downloadFileSystemError(error);
      }
      logDownloadEvent('info', 'download-file-verify-complete', {
        videoUrl: record.videoUrl,
        fileSizeBytes: stats.isFile() ? stats.size : null
      });

      options.upsertPersistedDownload({
        videoUrl: record.videoUrl,
        downloadSource: 'normal',
        state: 'ready',
        progress: 1,
        error: null,
        localPath: record.localPath,
        fileSizeBytes: stats.isFile() ? stats.size : null,
        sourcePageChineseSubtitleNotice: source.sourcePageChineseSubtitleNotice,
        sourcePageSubtitleNoticeText: source.sourcePageSubtitleNoticeText,
        failurePhase: null,
        failureCode: null,
        lastErrorAt: null,
        completedAt: options.downloadTimestamp()
      });
      options.notifyDownloadsChanged();

      const readyFile = options.localPlaybackReadyFile(record.videoUrl);
      if (readyFile) options.schedulePreviewGeneration(readyFile);
      logDownloadEvent('info', 'active-download-complete', {
        videoUrl: record.videoUrl,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const paused = options.isPaused(record.videoUrl) || isDownloadPausedError(error);
      if (paused) {
        logDownloadEvent('info', 'active-download-paused', {
          videoUrl: record.videoUrl,
          durationMs: Date.now() - startedAt
        });
      } else {
        logDownloadError('active-download-failed', error, {
          videoUrl: record.videoUrl,
          failurePhase: failurePhase,
          failureCode: downloadFailureCode(error),
          durationMs: Date.now() - startedAt
        });
      }
      if (!options.isDeleted(record.videoUrl)) {
        options.upsertPersistedDownload({
          videoUrl: record.videoUrl,
          state: paused ? 'paused' : 'failed',
          progress: null,
          error: paused ? options.t('status.downloadPaused') : options.downloadErrorMessage(error),
          failurePhase: paused ? null : failurePhase,
          failureCode: paused ? null : downloadFailureCode(error),
          lastErrorAt: paused ? null : options.downloadTimestamp()
        });
        options.notifyDownloadsChanged();
      }
    } finally {
      const paused = options.isPaused(record.videoUrl);
      if (outputPath) {
        options.removePartialDownloadFile(outputPath);
        if (!paused) removeDownloadSegmentTempDirectory(outputPath, logDownloadError);
      }
      options.clearRuntimeProgress(record.videoUrl);
      options.clearPlaybackCaptureAfterActiveDownload(record.videoUrl);
      options.clearDownloadFlags(record.videoUrl);
      options.clearActiveDownload(record.videoUrl);
    }
  }

  return {
    runActiveDownload: runActiveDownload
  };
}
