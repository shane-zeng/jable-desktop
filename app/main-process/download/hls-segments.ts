'use strict';

import {
  DownloadSegmentError,
  HlsPlaylistUnsupportedError,
  isSegmentRefreshCandidate,
  mainErrorMessage
} from './errors';
import type { DownloadHlsHelpers, HlsPlaylist } from './hls-source';
import {
  downloadSegmentDirectorySize,
  downloadSegmentTempDirectory,
  prepareDownloadSegmentTempDirectory,
  resumeManifestMatches,
  reusableSegmentFileCount
} from './segment-workspace';

export type NativeDownloadRuntime = {
  nativeId: string | null;
};

type NativeDownloadEngine = {
  downloadHlsSegments(payload: string): Promise<string> | string;
};
type NativeDownloadSegmentsResult = {
  playlistPath: string;
  downloadedBytes: number;
};
type DownloadHlsSegmentsOptions = {
  currentDownloadSegmentConcurrency(): { min: number; max: number };
  downloadCanceledError(): Error;
  downloadFileSystemError(error: unknown): Error;
  downloadPausedError(): Error;
  getDownloadEngine(): NativeDownloadEngine;
  helpers: DownloadHlsHelpers;
  isCanceled(videoUrl: string): boolean;
  isPaused(videoUrl: string): boolean;
  progressNotifyIntervalMs: number;
  resolveDownloadHlsSource(
    videoUrl: string,
    signal: AbortSignal
  ): Promise<{ cookieHeader: string; playlist: HlsPlaylist }>;
  retryLimit: number;
  sampleSegmentCount: number;
  throwIfDownloadCanceled(videoUrl: string): void;
  updateDownloadRuntimeProgress(videoUrl: string, downloadedBytes: number): void;
};

function refreshedPlaylistMatchesDownloadWork(outputPath: string, playlist: HlsPlaylist): boolean {
  return (
    resumeManifestMatches(outputPath, playlist) ||
    (playlist.segments.length > 0 && reusableSegmentFileCount(outputPath, playlist) === playlist.segments.length)
  );
}

function startNativeDownloadProgress(
  videoUrl: string,
  tempDir: string,
  options: DownloadHlsSegmentsOptions
): ReturnType<typeof setInterval> {
  return setInterval(function () {
    options.updateDownloadRuntimeProgress(videoUrl, downloadSegmentDirectorySize(tempDir));
  }, options.progressNotifyIntervalMs);
}

function parseNativeDownloadSegmentsResult(value: string): NativeDownloadSegmentsResult {
  const result = JSON.parse(value) as Partial<NativeDownloadSegmentsResult>;
  if (typeof result.playlistPath !== 'string' || !result.playlistPath) {
    throw new DownloadSegmentError('native download engine did not return playlistPath');
  }
  return {
    playlistPath: result.playlistPath,
    downloadedBytes:
      typeof result.downloadedBytes === 'number' && Number.isFinite(result.downloadedBytes) ? result.downloadedBytes : 0
  };
}

function nativeDownloadError(error: unknown, options: DownloadHlsSegmentsOptions): Error {
  const message = mainErrorMessage(error);
  if (/download canceled|AbortError/i.test(message)) return options.downloadCanceledError();
  if (/unsupported HLS key method/i.test(message)) return new HlsPlaylistUnsupportedError(message);
  return new DownloadSegmentError(message);
}

async function downloadHlsSegmentsWithNative(
  playlist: HlsPlaylist,
  videoUrl: string,
  cookieHeader: string,
  outputPath: string,
  signal: AbortSignal,
  runtime: NativeDownloadRuntime,
  reuseExistingSegments: boolean,
  options: DownloadHlsSegmentsOptions
): Promise<string> {
  const tempDir = downloadSegmentTempDirectory(outputPath);
  const headers = options.helpers.hlsRequestHeaders(videoUrl, cookieHeader);
  const downloadId = videoUrl;
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  try {
    options.throwIfDownloadCanceled(videoUrl);
    try {
      prepareDownloadSegmentTempDirectory(outputPath, playlist, reuseExistingSegments);
    } catch (error) {
      throw options.downloadFileSystemError(error);
    }
    runtime.nativeId = downloadId;
    options.updateDownloadRuntimeProgress(videoUrl, downloadSegmentDirectorySize(tempDir));
    progressTimer = startNativeDownloadProgress(videoUrl, tempDir, options);
    const concurrency = options.currentDownloadSegmentConcurrency();
    const result = parseNativeDownloadSegmentsResult(
      await options.getDownloadEngine().downloadHlsSegments(
        JSON.stringify({
          downloadId: downloadId,
          tempDir: tempDir,
          headers: headers,
          minConcurrency: concurrency.min,
          maxConcurrency: concurrency.max,
          sampleSegmentCount: options.sampleSegmentCount,
          retryLimit: options.retryLimit,
          targetDuration: playlist.targetDuration,
          segments: playlist.segments
        })
      )
    );
    options.throwIfDownloadCanceled(videoUrl);
    options.updateDownloadRuntimeProgress(videoUrl, result.downloadedBytes);
    return result.playlistPath;
  } catch (error) {
    if (options.isPaused(videoUrl)) throw options.downloadPausedError();
    if (signal.aborted || options.isCanceled(videoUrl)) throw options.downloadCanceledError();
    throw nativeDownloadError(error, options);
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    if (runtime.nativeId === downloadId) runtime.nativeId = null;
  }
}

export async function downloadHlsSegmentsWithPlaylistRefresh(
  playlist: HlsPlaylist,
  videoUrl: string,
  cookieHeader: string,
  outputPath: string,
  signal: AbortSignal,
  runtime: NativeDownloadRuntime,
  reuseExistingSegments: boolean,
  options: DownloadHlsSegmentsOptions
): Promise<string> {
  try {
    return await downloadHlsSegmentsWithNative(
      playlist,
      videoUrl,
      cookieHeader,
      outputPath,
      signal,
      runtime,
      reuseExistingSegments,
      options
    );
  } catch (error) {
    if (!isSegmentRefreshCandidate(error)) throw error;
    options.throwIfDownloadCanceled(videoUrl);

    let refreshed: { cookieHeader: string; playlist: HlsPlaylist };
    try {
      refreshed = await options.resolveDownloadHlsSource(videoUrl, signal);
    } catch (refreshError) {
      void refreshError;
      throw error;
    }
    options.throwIfDownloadCanceled(videoUrl);

    if (!refreshedPlaylistMatchesDownloadWork(outputPath, refreshed.playlist)) throw error;

    return downloadHlsSegmentsWithNative(
      refreshed.playlist,
      videoUrl,
      refreshed.cookieHeader,
      outputPath,
      signal,
      runtime,
      true,
      options
    );
  }
}
