'use strict';

import type * as Electron from 'electron';
import type { HlsPlaybackCapturePlan } from './helpers';

export type HlsProbeTabContext = {
  tabId: string | null;
  videoUrl: string | null;
};
export type HlsPlaybackCaptureMetadata = {
  title: string | null;
  views: number | null;
  likes: number | null;
  img: string | null;
  preview: string | null;
  sourcePageChineseSubtitleNotice: boolean | null;
  sourcePageSubtitleNoticeText: string | null;
};
export type HlsPlaylistProxyAsset = {
  captureFilePath: string | null;
  sourceUrl: string;
  host: string;
  pathHash: string;
};
export type HlsPlaylistProxyToken = HlsProbeTabContext & {
  assets: Record<string, HlsPlaylistProxyAsset>;
  capturePlan: HlsPlaybackCapturePlan | null;
  metadata: HlsPlaybackCaptureMetadata;
  pageLoadId: string | null;
  playlistUrl: string;
  playlistText: string | null;
  origin: string;
  host: string;
  pathHash: string;
  expiresAt: number;
  webContentsId: number;
};
export type HlsPlaylistProxyUnavailableReason = 'disabled' | 'not_video' | 'not_playlist' | 'unavailable';
export type HlsPlaylistProxyAbort = {
  cleanup(): void;
  clientAborted(): boolean;
  signal: AbortSignal;
};
export type HlsPlaybackBackgroundCompletionWorker = (signal: AbortSignal) => Promise<void>;
export type HlsPlaylistProxyResponseBody = ConstructorParameters<typeof Response>[0];
export type HlsPlaybackCaptureActivePage = {
  expiresAt: number;
  userInitiatedPlayback: boolean;
};
export type HlsPlaybackCaptureContext = {
  canonicalJableVideoUrl(value: unknown): string | null;
  env?: Record<string, string | undefined> | null;
  getBrowserTabByWebContents(webContents: Electron.WebContents): { id: string } | null;
  ipcMain: typeof Electron.ipcMain;
  jableFallbackOrigin: string;
  jablePrimaryOrigin: string;
  jableSession: Electron.Session;
  logger?: { info(message?: unknown, ...optionalParams: unknown[]): void } | null;
  isAutoDownloadOnPlaybackEnabled?(): boolean;
  completeHlsPlaybackCapture?(value: { videoUrl: string; pageLoadId?: string | null }): void;
  queueHlsPlaybackBackgroundCompletion?(value: {
    videoUrl: string;
    pageLoadId?: string | null;
    run: HlsPlaybackBackgroundCompletionWorker;
  }): void;
  shouldContinueHlsPlaybackCapture?(value: { videoUrl: string; pageLoadId?: string | null }): boolean;
  shouldProxyHlsPlaybackCapture?(value: { videoUrl: string; pageLoadId?: string | null }): boolean;
  prepareHlsPlaybackCapture?(value: {
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
  }): HlsPlaybackCapturePlan | null;
  recordHlsPlaybackCaptureSegment?(value: { videoUrl: string; pageLoadId?: string | null; filePath: string }): void;
  webContentsFromId(webContentsId: number): Electron.WebContents | null;
};
export type HlsPlaylistProxyUrlResult =
  | {
      available: false;
      reason: HlsPlaylistProxyUnavailableReason;
    }
  | {
      available: true;
      playlistUrl: string;
      sourceUrl: string;
      videoUrl: string;
    };

export const HLS_PLAYLIST_PROXY_HOST = '127.0.0.1';
export const HLS_PLAYLIST_PROXY_FETCH_TIMEOUT_MS = 3000;
export const HLS_PLAYLIST_PROXY_TOKEN_TTL_MS = 10 * 60 * 1000;
export const HLS_PLAYBACK_CAPTURE_ACTIVITY_TTL_MS = 6 * 60 * 60 * 1000;
export const HLS_PLAYBACK_CAPTURE_PREFETCH_CONCURRENCY = 3;

export function logger(context: HlsPlaybackCaptureContext) {
  return context.logger || console;
}

export function hlsPlaybackDebugLog(
  context: HlsPlaybackCaptureContext,
  message?: unknown,
  ...optionalParams: unknown[]
) {
  if (!isHlsPlaybackVerboseLoggingEnabledByEnv(context.env)) return;
  logger(context).info(message, ...optionalParams);
}

export function mainErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function envFlagEnabled(env: Record<string, string | undefined> | null | undefined, name: string) {
  const value = String((env || process.env)[name] || '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

export function isHlsProbeEnabledByEnv(env?: Record<string, string | undefined> | null) {
  return envFlagEnabled(env, 'JABLE_HLS_PROBE');
}

export function isHlsProbeVerboseByEnv(env?: Record<string, string | undefined> | null) {
  return envFlagEnabled(env, 'JABLE_HLS_PROBE_VERBOSE');
}

export function isHlsPlaybackVerboseLoggingEnabledByEnv(env?: Record<string, string | undefined> | null) {
  return envFlagEnabled(env, 'JABLE_HLS_VERBOSE');
}

export function isHlsPlaylistProxyEnabledByEnv(env?: Record<string, string | undefined> | null) {
  return envFlagEnabled(env, 'JABLE_HLS_PROXY');
}

export function isHlsPlaybackCaptureEnabledByEnv(env?: Record<string, string | undefined> | null) {
  return envFlagEnabled(env, 'JABLE_HLS_CAPTURE');
}

export function isAutoDownloadOnPlaybackSettingEnabled(context: HlsPlaybackCaptureContext) {
  return Boolean(context.isAutoDownloadOnPlaybackEnabled && context.isAutoDownloadOnPlaybackEnabled());
}

export function isAutoDownloadOnPlaybackEnabled(context: HlsPlaybackCaptureContext) {
  if (isHlsPlaybackCaptureEnabledByEnv(context.env)) return true;
  return isAutoDownloadOnPlaybackSettingEnabled(context);
}

export function isHlsPlaylistProxyEnabled(context: HlsPlaybackCaptureContext) {
  return isHlsPlaylistProxyEnabledByEnv(context.env) || isAutoDownloadOnPlaybackEnabled(context);
}
