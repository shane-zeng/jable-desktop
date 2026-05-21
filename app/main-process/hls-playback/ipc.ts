'use strict';

import type * as Electron from 'electron';
import type { HlsPlaybackCapturePlan } from './helpers';
import { hlsPlaylistProxyRemotePlaylistUrl } from './helpers';
import { hlsProbePathHash } from './probe';
import {
  HLS_PLAYBACK_CAPTURE_ACTIVITY_TTL_MS,
  HLS_PLAYLIST_PROXY_HOST,
  hlsPlaybackDebugLog,
  isAutoDownloadOnPlaybackEnabled,
  isHlsPlaylistProxyEnabled,
  type HlsPlaybackCaptureActivePage,
  type HlsPlaybackCaptureContext,
  type HlsPlaybackCaptureMetadata,
  type HlsPlaylistProxyToken,
  type HlsPlaylistProxyUnavailableReason,
  type HlsPlaylistProxyUrlResult
} from './shared';

export type HlsPlaylistProxyIpcState = {
  activePages: Map<string, HlsPlaybackCaptureActivePage>;
  tokens: Map<string, HlsPlaylistProxyToken>;
  activePageKey: (webContentsId: number, videoUrl: string, pageLoadId: string | null) => string;
  createTokenForVideo: (
    context: HlsPlaybackCaptureContext,
    webContentsId: number,
    tabId: string | null,
    videoUrl: string,
    playlistUrl: string,
    metadata: HlsPlaybackCaptureMetadata,
    pageLoadId: string | null
  ) => string;
  ensureCapture: (context: HlsPlaybackCaptureContext, entry: HlsPlaylistProxyToken) => HlsPlaybackCapturePlan | null;
  playlistProxyPort: () => number | null;
  startCapturePrefetch: (context: HlsPlaybackCaptureContext, entry: HlsPlaylistProxyToken) => void;
  tokenUrl: (token: string) => string;
};

let hlsPlaylistProxyIpcInstalled = false;

export function unavailableHlsPlaylistProxyUrl(reason: HlsPlaylistProxyUnavailableReason): HlsPlaylistProxyUrlResult {
  return {
    available: false,
    reason: reason
  };
}

export function hlsPlaylistProxyPayloadString(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object') return '';
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function hlsPlaylistProxyPayloadPageLoadId(payload: unknown): string | null {
  const pageLoadId = hlsPlaylistProxyPayloadString(payload, 'pageLoadId').trim();
  return pageLoadId || null;
}

function hlsPlaylistProxyPayloadNumber(payload: unknown, key: string): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hlsPlaylistProxyPayloadMetadata(payload: unknown): HlsPlaybackCaptureMetadata {
  const sourcePageChineseSubtitleNotice =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as Record<string, unknown>).sourcePageChineseSubtitleNotice === 'boolean'
      ? ((payload as Record<string, unknown>).sourcePageChineseSubtitleNotice as boolean)
      : null;

  return {
    title: hlsPlaylistProxyPayloadString(payload, 'title').trim() || null,
    views: hlsPlaylistProxyPayloadNumber(payload, 'views'),
    likes: hlsPlaylistProxyPayloadNumber(payload, 'likes'),
    img: hlsPlaylistProxyPayloadString(payload, 'img').trim() || null,
    preview: hlsPlaylistProxyPayloadString(payload, 'preview').trim() || null,
    sourcePageChineseSubtitleNotice: sourcePageChineseSubtitleNotice,
    sourcePageSubtitleNoticeText:
      sourcePageChineseSubtitleNotice === true
        ? hlsPlaylistProxyPayloadString(payload, 'sourcePageSubtitleNoticeText').trim() || null
        : null
  };
}

function mergeHlsPlaybackCaptureMetadata(
  current: HlsPlaybackCaptureMetadata,
  next: HlsPlaybackCaptureMetadata
): HlsPlaybackCaptureMetadata {
  return {
    title: next.title || current.title,
    views: next.views === null ? current.views : next.views,
    likes: next.likes === null ? current.likes : next.likes,
    img: next.img || current.img,
    preview: next.preview || current.preview,
    sourcePageChineseSubtitleNotice:
      next.sourcePageChineseSubtitleNotice === null
        ? current.sourcePageChineseSubtitleNotice
        : next.sourcePageChineseSubtitleNotice,
    sourcePageSubtitleNoticeText:
      next.sourcePageChineseSubtitleNotice === null
        ? current.sourcePageSubtitleNoticeText
        : next.sourcePageSubtitleNoticeText
  };
}

function hlsPlaybackCaptureStartedForRenderer(
  context: HlsPlaybackCaptureContext,
  state: HlsPlaylistProxyIpcState,
  event: Electron.IpcMainEvent,
  payload: unknown
) {
  if (!isAutoDownloadOnPlaybackEnabled(context)) return;

  const senderVideoUrl = context.canonicalJableVideoUrl(event.sender.getURL());
  const payloadVideoUrl = context.canonicalJableVideoUrl(hlsPlaylistProxyPayloadString(payload, 'videoUrl'));
  if (!senderVideoUrl || (payloadVideoUrl && payloadVideoUrl !== senderVideoUrl)) return;
  const metadata = hlsPlaylistProxyPayloadMetadata(payload);
  const pageLoadId = hlsPlaylistProxyPayloadPageLoadId(payload);
  const userInitiatedPlayback = Boolean(
    payload && typeof payload === 'object' && (payload as Record<string, unknown>).userInitiatedPlayback === true
  );

  state.activePages.set(state.activePageKey(event.sender.id, senderVideoUrl, pageLoadId), {
    expiresAt: Date.now() + HLS_PLAYBACK_CAPTURE_ACTIVITY_TTL_MS,
    userInitiatedPlayback: userInitiatedPlayback
  });

  let prepared = 0;
  for (const tokenEntry of state.tokens) {
    const entry = tokenEntry[1];
    if (entry.webContentsId !== event.sender.id || entry.videoUrl !== senderVideoUrl) continue;
    if (pageLoadId && entry.pageLoadId !== pageLoadId) continue;
    entry.metadata = mergeHlsPlaybackCaptureMetadata(entry.metadata, metadata);
    if (!state.ensureCapture(context, entry)) continue;
    state.startCapturePrefetch(context, entry);
    prepared += 1;
  }

  hlsPlaybackDebugLog(
    context,
    '[hls-capture] playback started',
    'webContentsId=' + event.sender.id,
    'prepared=' + prepared,
    'userInitiated=' + String(userInitiatedPlayback),
    'videoUrl=' + senderVideoUrl
  );
}

function hlsPlaylistProxyUrlForRenderer(
  context: HlsPlaybackCaptureContext,
  state: HlsPlaylistProxyIpcState,
  event: Electron.IpcMainInvokeEvent,
  payload: unknown
): HlsPlaylistProxyUrlResult {
  if (!isHlsPlaylistProxyEnabled(context)) return unavailableHlsPlaylistProxyUrl('disabled');
  if (!state.playlistProxyPort()) return unavailableHlsPlaylistProxyUrl('unavailable');

  const senderVideoUrl = context.canonicalJableVideoUrl(event.sender.getURL());
  const payloadVideoUrl = context.canonicalJableVideoUrl(hlsPlaylistProxyPayloadString(payload, 'videoUrl'));
  if (!senderVideoUrl || (payloadVideoUrl && payloadVideoUrl !== senderVideoUrl)) {
    return unavailableHlsPlaylistProxyUrl('not_video');
  }

  const playlistUrl = hlsPlaylistProxyRemotePlaylistUrl(
    hlsPlaylistProxyPayloadString(payload, 'playlistUrl'),
    HLS_PLAYLIST_PROXY_HOST
  );
  if (!playlistUrl) return unavailableHlsPlaylistProxyUrl('not_playlist');
  const metadata = hlsPlaylistProxyPayloadMetadata(payload);
  const pageLoadId = hlsPlaylistProxyPayloadPageLoadId(payload);

  if (
    context.shouldProxyHlsPlaybackCapture &&
    !context.shouldProxyHlsPlaybackCapture({ videoUrl: senderVideoUrl, pageLoadId: pageLoadId })
  ) {
    return unavailableHlsPlaylistProxyUrl('disabled');
  }

  let tabId: string | null = null;
  try {
    const tab = context.getBrowserTabByWebContents(event.sender);
    tabId = tab ? tab.id : null;
  } catch (error) {}

  const token = state.createTokenForVideo(
    context,
    event.sender.id,
    tabId,
    senderVideoUrl,
    playlistUrl,
    metadata,
    pageLoadId
  );
  const sourceUrl = state.tokenUrl(token);
  if (!sourceUrl) return unavailableHlsPlaylistProxyUrl('unavailable');

  const entry = state.tokens.get(token);
  hlsPlaybackDebugLog(
    context,
    '[hls-proxy] token',
    'webContentsId=' + event.sender.id,
    'tabId=' + String(tabId),
    'host=' + String(entry ? entry.host : 'unknown'),
    'pathHash=' + String(entry ? entry.pathHash : hlsProbePathHash(playlistUrl)),
    'videoUrl=' + senderVideoUrl
  );

  return {
    available: true,
    playlistUrl: playlistUrl,
    sourceUrl: sourceUrl,
    videoUrl: senderVideoUrl
  };
}

export function installHlsPlaylistProxyIpc(context: HlsPlaybackCaptureContext, state: HlsPlaylistProxyIpcState) {
  if (hlsPlaylistProxyIpcInstalled) return;
  hlsPlaylistProxyIpcInstalled = true;

  context.ipcMain.handle('hls:playlist-proxy-url', function (event, payload) {
    return hlsPlaylistProxyUrlForRenderer(context, state, event, payload);
  });
  context.ipcMain.on('hls:playback-started', function (event, payload) {
    hlsPlaybackCaptureStartedForRenderer(context, state, event, payload);
  });
}
