'use strict';

import type * as Electron from 'electron';
import type * as NodeCrypto from 'node:crypto';
import type * as NodeFs from 'node:fs';
import type * as NodeHttp from 'node:http';
import type * as NodePath from 'node:path';
import type * as NodeStream from 'node:stream';
import type {
  HlsPlaybackCapturePlan,
  HlsPlaylistProxyRequestTarget,
  HlsPlaylistProxyRewriteState
} from './hls-playback-helpers';
import {
  hlsPlaylistProxyAbsoluteUri,
  hlsPlaylistProxyAssetExtension,
  hlsPlaylistProxyCaptureFileForSourceUrl,
  hlsPlaylistProxyRemotePlaylistUrl,
  hlsPlaylistProxyRequestTargetFromUrl as hlsPlaylistProxyRequestTargetFromUrlHelper,
  hlsPlaylistProxyRewritePlaylistContent,
  isHlsPlaylistProxyLoopbackUrl as isHlsPlaylistProxyLoopbackUrlHelper
} from './hls-playback-helpers';

type HlsProbeKind = 'playlist' | 'segment';
type HlsProbeTabContext = {
  tabId: string | null;
  videoUrl: string | null;
};
type HlsProbeRecord = HlsProbeTabContext & {
  kind: HlsProbeKind;
  host: string;
  pathHash: string;
  resourceType: string;
  webContentsId: number | null;
};
type HlsPlaybackCaptureMetadata = {
  title: string | null;
  views: number | null;
  likes: number | null;
  img: string | null;
  preview: string | null;
  sourcePageChineseSubtitleNotice: boolean | null;
  sourcePageSubtitleNoticeText: string | null;
};
type HlsPlaylistProxyToken = HlsProbeTabContext & {
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
type HlsPlaylistProxyAsset = {
  captureFilePath: string | null;
  sourceUrl: string;
  host: string;
  pathHash: string;
};
type HlsPlaylistProxyUnavailableReason = 'disabled' | 'not_video' | 'not_playlist' | 'unavailable';
type HlsPlaylistProxyAbort = {
  cleanup(): void;
  clientAborted(): boolean;
  signal: AbortSignal;
};
type HlsPlaybackBackgroundCompletionWorker = (signal: AbortSignal) => Promise<void>;
type HlsPlaylistProxyResponseBody = ConstructorParameters<typeof Response>[0];
type HlsPlaybackCaptureActivePage = {
  expiresAt: number;
  userInitiatedPlayback: boolean;
};
type HlsPlaybackCaptureContext = {
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
type HlsPlaylistProxyUrlResult =
  | {
      available: false;
      reason: 'disabled' | 'not_video' | 'not_playlist' | 'unavailable';
    }
  | {
      available: true;
      playlistUrl: string;
      sourceUrl: string;
      videoUrl: string;
    };

const nodeCrypto: typeof NodeCrypto = require('node:crypto');
const fs: typeof NodeFs = require('node:fs');
const http: typeof NodeHttp = require('node:http');
const path: typeof NodePath = require('node:path');
const stream: typeof NodeStream = require('node:stream');

const HLS_PLAYLIST_PROXY_HOST = '127.0.0.1';
const HLS_PROBE_SEGMENT_LOG_LIMIT = 30;
const HLS_PLAYLIST_PROXY_FETCH_TIMEOUT_MS = 3000;
const HLS_PLAYLIST_PROXY_TOKEN_TTL_MS = 10 * 60 * 1000;
const HLS_PLAYBACK_CAPTURE_ACTIVITY_TTL_MS = 6 * 60 * 60 * 1000;
const HLS_PLAYBACK_CAPTURE_PREFETCH_CONCURRENCY = 3;

let hlsProbeInstalled = false;
let hlsProbeSegmentLogs = 0;
let hlsProbeSegmentLimitReported = false;
const hlsProbeRequests = new Map<number, HlsProbeRecord>();
const hlsPlaylistProxyTokens = new Map<string, HlsPlaylistProxyToken>();
const hlsPlaybackCaptureActiveFiles = new Map<string, Promise<boolean>>();
const hlsPlaybackCaptureActivePages = new Map<string, HlsPlaybackCaptureActivePage>();
const hlsPlaybackCapturePrefetches = new Set<string>();
let hlsPlaylistProxyServer: NodeHttp.Server | null = null;
let hlsPlaylistProxyPort: number | null = null;
let hlsPlaylistProxyIpcInstalled = false;

class HlsPlaybackCaptureStoppedError extends Error {
  constructor() {
    super('playback capture stopped');
    this.name = 'HlsPlaybackCaptureStoppedError';
  }
}

function logger(context: HlsPlaybackCaptureContext) {
  return context.logger || console;
}

function mainErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function envFlagEnabled(env: Record<string, string | undefined> | null | undefined, name: string) {
  const value = String((env || process.env)[name] || '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

function isHlsProbeEnabledByEnv(env?: Record<string, string | undefined> | null) {
  return envFlagEnabled(env, 'JABLE_HLS_PROBE');
}

function isHlsProbeVerboseByEnv(env?: Record<string, string | undefined> | null) {
  return envFlagEnabled(env, 'JABLE_HLS_PROBE_VERBOSE');
}

function isHlsPlaylistProxyEnabledByEnv(env?: Record<string, string | undefined> | null) {
  return envFlagEnabled(env, 'JABLE_HLS_PROXY');
}

function isHlsPlaybackCaptureEnabledByEnv(env?: Record<string, string | undefined> | null) {
  return envFlagEnabled(env, 'JABLE_HLS_CAPTURE');
}

function isAutoDownloadOnPlaybackSettingEnabled(context: HlsPlaybackCaptureContext) {
  return Boolean(context.isAutoDownloadOnPlaybackEnabled && context.isAutoDownloadOnPlaybackEnabled());
}

function isAutoDownloadOnPlaybackEnabled(context: HlsPlaybackCaptureContext) {
  if (isHlsPlaybackCaptureEnabledByEnv(context.env)) return true;
  return isAutoDownloadOnPlaybackSettingEnabled(context);
}

function isHlsPlaylistProxyEnabled(context: HlsPlaybackCaptureContext) {
  return isHlsPlaylistProxyEnabledByEnv(context.env) || isAutoDownloadOnPlaybackEnabled(context);
}

function hlsPlaybackCaptureActivePageKey(webContentsId: number, videoUrl: string, pageLoadId: string | null): string {
  return String(webContentsId) + '\n' + videoUrl + '\n' + String(pageLoadId || '');
}

function purgeExpiredHlsPlaybackCaptureActivePages() {
  const now = Date.now();
  for (const entry of hlsPlaybackCaptureActivePages) {
    if (entry[1].expiresAt <= now) hlsPlaybackCaptureActivePages.delete(entry[0]);
  }
}

function hlsPlaybackCaptureActivePage(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken
): HlsPlaybackCaptureActivePage | null {
  if (isHlsPlaybackCaptureEnabledByEnv(context.env)) {
    return {
      expiresAt: Date.now() + HLS_PLAYBACK_CAPTURE_ACTIVITY_TTL_MS,
      userInitiatedPlayback: true
    };
  }
  if (!isAutoDownloadOnPlaybackSettingEnabled(context) || !entry.videoUrl) return null;

  purgeExpiredHlsPlaybackCaptureActivePages();
  const activePage = hlsPlaybackCaptureActivePages.get(
    hlsPlaybackCaptureActivePageKey(entry.webContentsId, entry.videoUrl, entry.pageLoadId)
  );
  return activePage && activePage.expiresAt > Date.now() ? activePage : null;
}

function hlsPlaybackCaptureCanContinue(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  signal?: AbortSignal | null
): boolean {
  if (signal && signal.aborted) return false;
  if (!entry.videoUrl) return false;
  if (!context.shouldContinueHlsPlaybackCapture) return true;
  return context.shouldContinueHlsPlaybackCapture({
    videoUrl: entry.videoUrl,
    pageLoadId: entry.pageLoadId
  });
}

function isHlsPlaybackCaptureStoppedError(error: unknown): boolean {
  return error instanceof HlsPlaybackCaptureStoppedError;
}

function hlsProbeHeaderValue(headers: Record<string, string | string[]> | undefined, name: string): string {
  if (!headers) return '';
  const names = Object.keys(headers);
  for (let i = 0; i < names.length; i++) {
    if (names[i].toLowerCase() !== name.toLowerCase()) continue;
    const value = headers[names[i]];
    return Array.isArray(value) ? String(value[0] || '') : String(value || '');
  }
  return '';
}

function hlsProbeTrustedJableOrigin(context: HlsPlaybackCaptureContext, value: unknown): boolean {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.origin === context.jablePrimaryOrigin || parsed.origin === context.jableFallbackOrigin;
  } catch (error) {
    return false;
  }
}

function hlsProbeKindForUrl(value: unknown): HlsProbeKind | null {
  try {
    const parsed = new URL(String(value || ''));
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.indexOf('.m3u8') !== -1) return 'playlist';
    if (/\.(aac|m4a|m4s|mp4|ts)$/.test(pathname)) return 'segment';
  } catch (error) {}
  return null;
}

function hlsProbeKindForContentType(value: string): HlsProbeKind | null {
  const contentType = value.toLowerCase();
  if (contentType.indexOf('mpegurl') !== -1 || contentType.indexOf('x-mpegurl') !== -1) return 'playlist';
  if (contentType.indexOf('mp2t') !== -1 || contentType.indexOf('video/mp4') !== -1) return 'segment';
  return null;
}

function hlsProbePathHash(value: unknown): string {
  return nodeCrypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 12);
}

function hlsProbeWebContents(
  context: HlsPlaybackCaptureContext,
  details:
    | Electron.OnBeforeRequestListenerDetails
    | Electron.OnBeforeSendHeadersListenerDetails
    | Electron.OnCompletedListenerDetails
): Electron.WebContents | null {
  if (details.webContents && !details.webContents.isDestroyed()) return details.webContents;
  if (typeof details.webContentsId !== 'number') return null;
  return context.webContentsFromId(details.webContentsId);
}

function hlsProbeTabContext(
  context: HlsPlaybackCaptureContext,
  details:
    | Electron.OnBeforeRequestListenerDetails
    | Electron.OnBeforeSendHeadersListenerDetails
    | Electron.OnCompletedListenerDetails
): HlsProbeTabContext {
  const webContents = hlsProbeWebContents(context, details);
  if (!webContents) {
    return {
      tabId: null,
      videoUrl: null
    };
  }

  let tab: { id: string } | null = null;
  try {
    tab = context.getBrowserTabByWebContents(webContents);
  } catch (error) {}

  return {
    tabId: tab ? tab.id : null,
    videoUrl: context.canonicalJableVideoUrl(webContents.getURL())
  };
}

function hlsProbeShouldLogSegment(context: HlsPlaybackCaptureContext): boolean {
  if (isHlsProbeVerboseByEnv(context.env)) return true;
  if (hlsProbeSegmentLogs < HLS_PROBE_SEGMENT_LOG_LIMIT) {
    hlsProbeSegmentLogs += 1;
    return true;
  }
  if (!hlsProbeSegmentLimitReported) {
    hlsProbeSegmentLimitReported = true;
    logger(context).info(
      '[hls-probe] segment log limit reached; set JABLE_HLS_PROBE_VERBOSE=1 to print every segment request'
    );
  }
  return false;
}

function hlsProbeRequestTrusted(
  context: HlsPlaybackCaptureContext,
  details: Electron.OnBeforeSendHeadersListenerDetails,
  tabContext: HlsProbeTabContext
): boolean {
  return Boolean(
    tabContext.videoUrl ||
    hlsProbeTrustedJableOrigin(context, details.referrer) ||
    hlsProbeTrustedJableOrigin(context, hlsProbeHeaderValue(details.requestHeaders, 'Origin'))
  );
}

function hlsProbeLogRequest(
  context: HlsPlaybackCaptureContext,
  details: Electron.OnBeforeSendHeadersListenerDetails,
  kind: HlsProbeKind
) {
  const tabContext = hlsProbeTabContext(context, details);
  if (!hlsProbeRequestTrusted(context, details, tabContext)) return;
  if (kind === 'segment' && !hlsProbeShouldLogSegment(context)) return;

  let host = '';
  try {
    host = new URL(details.url).hostname;
  } catch (error) {}

  const record: HlsProbeRecord = Object.assign({}, tabContext, {
    kind: kind,
    host: host || 'unknown',
    pathHash: hlsProbePathHash(details.url),
    resourceType: details.resourceType,
    webContentsId: typeof details.webContentsId === 'number' ? details.webContentsId : null
  });
  hlsProbeRequests.set(details.id, record);

  logger(context).info(
    '[hls-probe] request',
    'kind=' + record.kind,
    'requestId=' + details.id,
    'webContentsId=' + String(record.webContentsId),
    'tabId=' + String(record.tabId),
    'resourceType=' + record.resourceType,
    'host=' + record.host,
    'pathHash=' + record.pathHash,
    'videoUrl=' + String(record.videoUrl)
  );
}

function hlsProbeLogResponse(context: HlsPlaybackCaptureContext, details: Electron.OnCompletedListenerDetails) {
  const contentType = hlsProbeHeaderValue(details.responseHeaders, 'content-type');
  const record = hlsProbeRequests.get(details.id) || null;
  const kind = record ? record.kind : hlsProbeKindForUrl(details.url) || hlsProbeKindForContentType(contentType);
  if (!kind) return;
  if (!record && kind === 'segment' && !hlsProbeShouldLogSegment(context)) return;

  const tabContext = record || hlsProbeTabContext(context, details);
  if (!record && !tabContext.videoUrl && !hlsProbeTrustedJableOrigin(context, details.referrer)) return;

  let host = record ? record.host : '';
  if (!host) {
    try {
      host = new URL(details.url).hostname;
    } catch (error) {}
  }

  logger(context).info(
    '[hls-probe] response',
    'kind=' + kind,
    'requestId=' + details.id,
    'webContentsId=' + String(record ? record.webContentsId : details.webContentsId || null),
    'tabId=' + String(tabContext.tabId),
    'resourceType=' + (record ? record.resourceType : details.resourceType),
    'host=' + (host || 'unknown'),
    'pathHash=' + (record ? record.pathHash : hlsProbePathHash(details.url)),
    'status=' + details.statusCode,
    'fromCache=' + String(details.fromCache),
    'contentType=' + (contentType || 'unknown'),
    'error=' + (details.error || 'none'),
    'videoUrl=' + String(tabContext.videoUrl)
  );

  hlsProbeRequests.delete(details.id);
}

function installHlsPlaybackProbe(context: HlsPlaybackCaptureContext) {
  if (hlsProbeInstalled || !isHlsProbeEnabledByEnv(context.env)) return;
  hlsProbeInstalled = true;

  const webRequest = context.jableSession.webRequest;
  webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, function (details, callback) {
    const kind = hlsProbeKindForUrl(details.url);
    if (kind) hlsProbeLogRequest(context, details, kind);
    callback({});
  });
  webRequest.onCompleted({ urls: ['<all_urls>'] }, function (details) {
    hlsProbeLogResponse(context, details);
  });

  logger(context).info('[hls-probe] installed for Jable session; full HLS URLs are not logged');
}

function purgeExpiredHlsPlaylistProxyTokens(now = Date.now()) {
  for (const entry of hlsPlaylistProxyTokens) {
    if (entry[1].expiresAt <= now) hlsPlaylistProxyTokens.delete(entry[0]);
  }
}

function hlsPlaylistProxyTokenUrl(token: string): string {
  if (!hlsPlaylistProxyPort) return '';
  return 'http://' + HLS_PLAYLIST_PROXY_HOST + ':' + hlsPlaylistProxyPort + '/playlist/' + token + '.m3u8';
}

function hlsPlaylistProxyAssetUrl(token: string, assetId: string, sourceUrl: string): string {
  if (!hlsPlaylistProxyPort) return '';
  return (
    'http://' +
    HLS_PLAYLIST_PROXY_HOST +
    ':' +
    hlsPlaylistProxyPort +
    '/asset/' +
    token +
    '/' +
    assetId +
    hlsPlaylistProxyAssetExtension(sourceUrl)
  );
}

function hlsPlaylistProxyRequestTargetFromUrl(value: unknown): HlsPlaylistProxyRequestTarget | null {
  return hlsPlaylistProxyRequestTargetFromUrlHelper(value, HLS_PLAYLIST_PROXY_HOST);
}

function isHlsPlaylistProxyLoopbackUrl(value: unknown): boolean {
  return isHlsPlaylistProxyLoopbackUrlHelper(value, HLS_PLAYLIST_PROXY_HOST);
}

function hlsPlaylistProxyOrigin(context: HlsPlaybackCaptureContext, videoUrl: string): string {
  try {
    return new URL(videoUrl).origin;
  } catch (error) {
    return context.jablePrimaryOrigin;
  }
}

function createHlsPlaylistProxyTokenForVideo(
  context: HlsPlaybackCaptureContext,
  webContentsId: number,
  tabId: string | null,
  videoUrl: string,
  playlistUrl: string,
  metadata: HlsPlaybackCaptureMetadata,
  pageLoadId: string | null
): string {
  purgeExpiredHlsPlaylistProxyTokens();

  let host = '';
  try {
    host = new URL(playlistUrl).hostname;
  } catch (error) {}

  const token = nodeCrypto.randomBytes(18).toString('base64url');
  hlsPlaylistProxyTokens.set(token, {
    assets: {},
    capturePlan: null,
    metadata: metadata,
    pageLoadId: pageLoadId,
    tabId: tabId,
    videoUrl: videoUrl,
    playlistUrl: playlistUrl,
    playlistText: null,
    origin: hlsPlaylistProxyOrigin(context, videoUrl),
    host: host || 'unknown',
    pathHash: hlsProbePathHash(playlistUrl),
    expiresAt: Date.now() + HLS_PLAYLIST_PROXY_TOKEN_TTL_MS,
    webContentsId: webContentsId
  });
  return token;
}

function hlsPlaylistProxyFetchHeaders(entry: HlsPlaylistProxyToken): Record<string, string> {
  return {
    accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*',
    'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
    origin: entry.origin,
    // Chromium rejects full cross-origin page referrers for session.fetch; Jable's page sends the origin root.
    referer: entry.origin + '/',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari'
  };
}

function hlsPlaylistProxyAssetFetchHeaders(entry: HlsPlaylistProxyToken, request: Request): Record<string, string> {
  const headers = hlsPlaylistProxyFetchHeaders(entry);
  const range = request.headers.get('range');
  headers.accept = '*/*';
  if (range) headers.range = range;
  return headers;
}

function hlsPlaylistProxyResponseHeaders(entry: HlsPlaylistProxyToken, body?: string | null): Headers {
  const headers = new Headers();
  headers.set('access-control-allow-headers', 'accept, content-type, origin, range, referer, user-agent');
  headers.set('access-control-allow-credentials', 'true');
  headers.set('access-control-allow-private-network', 'true');
  headers.set('access-control-allow-origin', entry.origin);
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  headers.set('access-control-expose-headers', 'content-length, content-type');
  headers.set('cache-control', 'no-store');
  headers.set('content-type', 'application/vnd.apple.mpegurl');
  headers.set('vary', 'Origin');
  if (typeof body === 'string') headers.set('content-length', String(Buffer.byteLength(body)));
  return headers;
}

function hlsPlaylistProxyAssetResponseHeaders(entry: HlsPlaylistProxyToken, upstream: Response): Headers {
  const headers = hlsPlaylistProxyResponseHeaders(entry);
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const contentType = upstream.headers.get('content-type');
  const acceptRanges = upstream.headers.get('accept-ranges');

  headers.set('access-control-expose-headers', 'accept-ranges, content-length, content-range, content-type');
  headers.set('content-type', contentType || 'application/octet-stream');
  if (contentLength) headers.set('content-length', contentLength);
  else headers.delete('content-length');
  if (contentRange) headers.set('content-range', contentRange);
  if (acceptRanges) headers.set('accept-ranges', acceptRanges);
  else headers.set('accept-ranges', 'bytes');
  return headers;
}

function hlsPlaylistProxyFallbackHeaders(): Headers {
  const headers = new Headers();
  headers.set('access-control-allow-headers', 'accept, content-type, origin, range, referer, user-agent');
  headers.set('access-control-allow-credentials', 'true');
  headers.set('access-control-allow-private-network', 'true');
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  headers.set('cache-control', 'no-store');
  headers.set('content-type', 'text/plain; charset=utf-8');
  return headers;
}

function hlsPlaylistProxyRemoteUrlIsPlaylist(value: string): boolean {
  return Boolean(hlsPlaylistProxyRemotePlaylistUrl(value, HLS_PLAYLIST_PROXY_HOST));
}

function hlsPlaylistProxyRewriteUri(
  context: HlsPlaybackCaptureContext,
  token: string,
  entry: HlsPlaylistProxyToken,
  value: string,
  playlistUrl: string,
  state: HlsPlaylistProxyRewriteState
): string {
  const sourceUrl = hlsPlaylistProxyAbsoluteUri(value, playlistUrl);
  if (hlsPlaylistProxyRemoteUrlIsPlaylist(sourceUrl)) {
    const childToken = createHlsPlaylistProxyTokenForVideo(
      context,
      entry.webContentsId,
      entry.tabId,
      entry.videoUrl || '',
      sourceUrl,
      entry.metadata,
      entry.pageLoadId
    );
    return hlsPlaylistProxyTokenUrl(childToken) || sourceUrl;
  }

  const assetId = nodeCrypto.randomBytes(12).toString('base64url');
  let host = '';
  try {
    host = new URL(sourceUrl).hostname;
  } catch (error) {}

  entry.assets[assetId] = {
    captureFilePath: hlsPlaylistProxyCaptureFileForSourceUrl(state, sourceUrl),
    sourceUrl: sourceUrl,
    host: host || 'unknown',
    pathHash: hlsProbePathHash(sourceUrl)
  };
  return hlsPlaylistProxyAssetUrl(token, assetId, sourceUrl) || sourceUrl;
}

function hlsPlaylistProxyRewritePlaylist(
  context: HlsPlaybackCaptureContext,
  token: string,
  entry: HlsPlaylistProxyToken,
  content: string,
  playlistUrl: string,
  capturePlan: HlsPlaybackCapturePlan | null
): string {
  const state: HlsPlaylistProxyRewriteState = {
    captureIndexes: {},
    capturePlan: capturePlan
  };

  return hlsPlaylistProxyRewritePlaylistContent(content, function (value) {
    return hlsPlaylistProxyRewriteUri(context, token, entry, value, playlistUrl, state);
  });
}

function hlsPlaylistProxyFallbackRedirect(context: HlsPlaybackCaptureContext, entry: HlsPlaylistProxyToken): Response {
  logger(context).info(
    '[hls-proxy] fail-open',
    'host=' + entry.host,
    'pathHash=' + entry.pathHash,
    'tabId=' + String(entry.tabId),
    'videoUrl=' + String(entry.videoUrl)
  );
  const headers = hlsPlaylistProxyResponseHeaders(entry);
  headers.set('location', entry.playlistUrl);
  return new Response(null, {
    status: 307,
    headers: headers
  });
}

function hlsPlaylistProxyPrepareCapture(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  playlistText: string
): HlsPlaybackCapturePlan | null {
  const activePage = hlsPlaybackCaptureActivePage(context, entry);
  if (!activePage) return null;
  if (!context.prepareHlsPlaybackCapture || !entry.videoUrl) return null;

  try {
    const plan = context.prepareHlsPlaybackCapture({
      videoUrl: entry.videoUrl,
      pageLoadId: entry.pageLoadId,
      userInitiatedPlayback: activePage.userInitiatedPlayback,
      title: entry.metadata.title,
      views: entry.metadata.views,
      likes: entry.metadata.likes,
      img: entry.metadata.img,
      preview: entry.metadata.preview,
      sourcePageChineseSubtitleNotice: entry.metadata.sourcePageChineseSubtitleNotice,
      sourcePageSubtitleNoticeText: entry.metadata.sourcePageSubtitleNoticeText,
      playlistUrl: entry.playlistUrl,
      playlistText: playlistText
    });
    if (plan && plan.segmentCount > 0) {
      logger(context).info(
        '[hls-capture] prepared',
        'segments=' + plan.segmentCount,
        'host=' + entry.host,
        'pathHash=' + entry.pathHash,
        'tabId=' + String(entry.tabId),
        'videoUrl=' + String(entry.videoUrl)
      );
    }
    return plan;
  } catch (error) {
    logger(context).info(
      '[hls-capture] prepare failed',
      'host=' + entry.host,
      'pathHash=' + entry.pathHash,
      'tabId=' + String(entry.tabId),
      'error=' + mainErrorMessage(error)
    );
    return null;
  }
}

function hlsPlaylistProxyApplyCapturePlan(entry: HlsPlaylistProxyToken, capturePlan: HlsPlaybackCapturePlan) {
  const state: HlsPlaylistProxyRewriteState = {
    captureIndexes: {},
    capturePlan: capturePlan
  };
  const assetIds = Object.keys(entry.assets);
  for (let i = 0; i < assetIds.length; i++) {
    const asset = entry.assets[assetIds[i]];
    if (!asset) continue;
    asset.captureFilePath = hlsPlaylistProxyCaptureFileForSourceUrl(state, asset.sourceUrl);
  }
}

function hlsPlaylistProxyEnsureCapture(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken
): HlsPlaybackCapturePlan | null {
  if (entry.capturePlan) return entry.capturePlan;
  if (!entry.playlistText) return null;

  const capturePlan = hlsPlaylistProxyPrepareCapture(context, entry, entry.playlistText);
  if (!capturePlan) return null;

  entry.capturePlan = capturePlan;
  hlsPlaylistProxyApplyCapturePlan(entry, capturePlan);
  return capturePlan;
}

function hlsPlaylistProxyFetchAbort(request: Request): HlsPlaylistProxyAbort {
  const abortController = new AbortController();
  let clientAborted = request.signal.aborted;

  function abortFromClient() {
    clientAborted = true;
    abortController.abort();
  }

  if (request.signal.aborted) abortFromClient();
  else request.signal.addEventListener('abort', abortFromClient, { once: true });

  const timeout = setTimeout(function () {
    abortController.abort();
  }, HLS_PLAYLIST_PROXY_FETCH_TIMEOUT_MS);

  return {
    cleanup: function () {
      clearTimeout(timeout);
    },
    clientAborted: function () {
      return clientAborted || request.signal.aborted;
    },
    signal: abortController.signal
  };
}

function hlsPlaybackCaptureFileExists(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch (error) {
    return false;
  }
}

function hlsPlaybackCaptureContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.aac') return 'audio/aac';
  if (extension === '.m4s') return 'video/iso.segment';
  if (extension === '.mp4') return 'video/mp4';
  return 'video/mp2t';
}

function hlsPlaylistProxyCapturedAssetFileResponse(
  entry: HlsPlaylistProxyToken,
  asset: HlsPlaylistProxyAsset,
  request: Request
): Response | null {
  if (!asset.captureFilePath) return null;

  let stats: NodeFs.Stats;
  try {
    stats = fs.statSync(asset.captureFilePath);
    if (!stats.isFile() || stats.size <= 0) return null;
  } catch (error) {
    return null;
  }

  const headers = hlsPlaylistProxyResponseHeaders(entry);
  headers.set('access-control-expose-headers', 'accept-ranges, content-length, content-type');
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(stats.size));
  headers.set('content-type', hlsPlaybackCaptureContentType(asset.captureFilePath));

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: headers
    });
  }

  const fileStream = fs.createReadStream(asset.captureFilePath);
  const body = stream.Readable.toWeb(fileStream) as unknown as HlsPlaylistProxyResponseBody;
  return new Response(body, {
    status: 200,
    headers: headers
  });
}

function hlsPlaybackCaptureTempPath(filePath: string): string {
  return filePath + '.capture-' + nodeCrypto.randomBytes(8).toString('base64url') + '.part';
}

async function hlsPlaybackCaptureCommitTempFile(tempPath: string, filePath: string): Promise<boolean> {
  try {
    if (hlsPlaybackCaptureFileExists(filePath)) return false;
    await fs.promises.link(tempPath, filePath);
    return true;
  } catch (error) {
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null;
    if (code === 'EEXIST') return false;
    throw error;
  } finally {
    try {
      await fs.promises.rm(tempPath, { force: true });
    } catch (removeError) {}
  }
}

async function hlsPlaybackCaptureWriteStreamToFile(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  asset: HlsPlaylistProxyAsset,
  body: ReadableStream<Uint8Array>,
  stopSource?: () => void,
  signal?: AbortSignal | null
): Promise<boolean> {
  if (!asset.captureFilePath) return false;
  if (hlsPlaybackCaptureFileExists(asset.captureFilePath)) return false;
  if (!hlsPlaybackCaptureCanContinue(context, entry, signal)) return false;

  const tempPath = hlsPlaybackCaptureTempPath(asset.captureFilePath);
  let handle: NodeFs.promises.FileHandle | null = null;
  const reader = body.getReader();
  let committed = false;

  try {
    await fs.promises.mkdir(path.dirname(asset.captureFilePath), { recursive: true });
    handle = await fs.promises.open(tempPath, 'w');

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value) continue;
      if (!hlsPlaybackCaptureCanContinue(context, entry, signal)) {
        if (stopSource) stopSource();
        throw new HlsPlaybackCaptureStoppedError();
      }
      await handle.write(Buffer.from(chunk.value));
    }

    if (!hlsPlaybackCaptureCanContinue(context, entry, signal)) {
      if (stopSource) stopSource();
      throw new HlsPlaybackCaptureStoppedError();
    }
    await handle.close();
    handle = null;
    committed = await hlsPlaybackCaptureCommitTempFile(tempPath, asset.captureFilePath);
    if (!committed) return false;
    if (entry.videoUrl && context.recordHlsPlaybackCaptureSegment) {
      context.recordHlsPlaybackCaptureSegment({
        videoUrl: entry.videoUrl,
        pageLoadId: entry.pageLoadId,
        filePath: asset.captureFilePath
      });
    }

    logger(context).info(
      '[hls-capture] segment saved',
      'host=' + asset.host,
      'pathHash=' + asset.pathHash,
      'tabId=' + String(entry.tabId),
      'videoUrl=' + String(entry.videoUrl)
    );
    return committed;
  } catch (error) {
    const stopped = isHlsPlaybackCaptureStoppedError(error);
    if (!stopped) {
      try {
        await reader.cancel();
      } catch (cancelError) {}
    }
    try {
      if (handle) await handle.close();
    } catch (closeError) {}
    try {
      await fs.promises.rm(tempPath, { force: true });
    } catch (removeError) {}
    logger(context).info(
      stopped ? '[hls-capture] segment stopped' : '[hls-capture] segment failed',
      'host=' + asset.host,
      'pathHash=' + asset.pathHash,
      'tabId=' + String(entry.tabId),
      'error=' + mainErrorMessage(error)
    );
    return false;
  } finally {
    reader.releaseLock();
  }
}

function writeHlsPlaybackCaptureStream(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  asset: HlsPlaylistProxyAsset,
  body: ReadableStream<Uint8Array>
): Promise<boolean> {
  if (!asset.captureFilePath) return Promise.resolve(false);
  if (hlsPlaybackCaptureFileExists(asset.captureFilePath)) return Promise.resolve(false);
  if (!hlsPlaybackCaptureCanContinue(context, entry)) return Promise.resolve(false);

  const active = hlsPlaybackCaptureActiveFiles.get(asset.captureFilePath);
  if (active) return active;

  const promise = hlsPlaybackCaptureWriteStreamToFile(context, entry, asset, body);
  hlsPlaybackCaptureActiveFiles.set(asset.captureFilePath, promise);
  return promise.finally(function () {
    if (asset.captureFilePath && hlsPlaybackCaptureActiveFiles.get(asset.captureFilePath) === promise) {
      hlsPlaybackCaptureActiveFiles.delete(asset.captureFilePath);
    }
  });
}

async function hlsPlaybackCaptureFetchAsset(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  asset: HlsPlaylistProxyAsset,
  signal?: AbortSignal | null
): Promise<boolean> {
  if (!asset.captureFilePath) return false;
  if (hlsPlaybackCaptureFileExists(asset.captureFilePath)) return false;
  if (!hlsPlaybackCaptureCanContinue(context, entry, signal)) return false;

  const active = hlsPlaybackCaptureActiveFiles.get(asset.captureFilePath);
  if (active) return active;

  const promise = (async function () {
    const abortController = new AbortController();
    const abortFromSignal = function () {
      abortController.abort();
    };
    if (signal) {
      if (signal.aborted) abortController.abort();
      else signal.addEventListener('abort', abortFromSignal, { once: true });
    }
    try {
      const upstream = await context.jableSession.fetch(asset.sourceUrl, {
        method: 'GET',
        headers: hlsPlaylistProxyAssetFetchHeaders(entry, new Request(asset.sourceUrl)),
        signal: abortController.signal
      });
      if (!hlsPlaybackCaptureCanContinue(context, entry, signal)) return false;
      if (!upstream.ok || !upstream.body) return false;
      return hlsPlaybackCaptureWriteStreamToFile(
        context,
        entry,
        asset,
        upstream.body,
        function () {
          abortController.abort();
        },
        signal
      );
    } catch (error) {
      if (isHlsPlaybackCaptureStoppedError(error) || abortController.signal.aborted) {
        logger(context).info(
          '[hls-capture] prefetch stopped',
          'host=' + asset.host,
          'pathHash=' + asset.pathHash,
          'tabId=' + String(entry.tabId)
        );
        return false;
      }
      logger(context).info(
        '[hls-capture] prefetch failed',
        'host=' + asset.host,
        'pathHash=' + asset.pathHash,
        'tabId=' + String(entry.tabId),
        'error=' + mainErrorMessage(error)
      );
      return false;
    } finally {
      if (signal) signal.removeEventListener('abort', abortFromSignal);
    }
  })();

  hlsPlaybackCaptureActiveFiles.set(asset.captureFilePath, promise);
  return promise.finally(function () {
    if (asset.captureFilePath && hlsPlaybackCaptureActiveFiles.get(asset.captureFilePath) === promise) {
      hlsPlaybackCaptureActiveFiles.delete(asset.captureFilePath);
    }
  });
}

async function hlsPlaylistProxyCapturedAssetResponse(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  asset: HlsPlaylistProxyAsset,
  request: Request
): Promise<Response | null> {
  if (!asset.captureFilePath) return null;
  if (!hlsPlaybackCaptureCanContinue(context, entry)) return null;

  const cached = hlsPlaylistProxyCapturedAssetFileResponse(entry, asset, request);
  if (cached) return cached;
  if (request.method !== 'GET') return null;

  await hlsPlaybackCaptureFetchAsset(context, entry, asset);
  return hlsPlaylistProxyCapturedAssetFileResponse(entry, asset, request);
}

function hlsPlaylistProxyAssetBody(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  asset: HlsPlaylistProxyAsset,
  body: ReadableStream<Uint8Array> | null
): ReadableStream<Uint8Array> | null {
  if (
    !body ||
    !asset.captureFilePath ||
    !hlsPlaybackCaptureCanContinue(context, entry) ||
    hlsPlaybackCaptureFileExists(asset.captureFilePath) ||
    hlsPlaybackCaptureActiveFiles.has(asset.captureFilePath)
  ) {
    return body;
  }

  const streams = body.tee();
  writeHlsPlaybackCaptureStream(context, entry, asset, streams[1]).catch(function (error) {
    logger(context).info(
      '[hls-capture] segment unhandled',
      'host=' + asset.host,
      'pathHash=' + asset.pathHash,
      'tabId=' + String(entry.tabId),
      'error=' + mainErrorMessage(error)
    );
  });
  return streams[0];
}

async function runHlsPlaybackCapturePrefetch(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  assets: HlsPlaylistProxyAsset[],
  signal?: AbortSignal | null
) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < assets.length) {
      const asset = assets[nextIndex++];
      if (!hlsPlaybackCaptureCanContinue(context, entry, signal)) return;
      if (!asset || !asset.captureFilePath) continue;
      await hlsPlaybackCaptureFetchAsset(context, entry, asset, signal);
    }
  }

  const workerCount = Math.min(HLS_PLAYBACK_CAPTURE_PREFETCH_CONCURRENCY, assets.length);
  await Promise.all(
    Array.from({ length: workerCount }, function () {
      return worker();
    })
  );
}

async function runHlsPlaybackCapturePrefetchWithCompletion(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  assets: HlsPlaylistProxyAsset[],
  signal?: AbortSignal | null
) {
  const key = String(entry.videoUrl || '') + '\n' + entry.playlistUrl;
  if (hlsPlaybackCapturePrefetches.has(key)) return;

  hlsPlaybackCapturePrefetches.add(key);
  try {
    await runHlsPlaybackCapturePrefetch(context, entry, assets, signal);
  } catch (error) {
    logger(context).info(
      '[hls-capture] prefetch failed',
      'host=' + entry.host,
      'pathHash=' + entry.pathHash,
      'tabId=' + String(entry.tabId),
      'error=' + mainErrorMessage(error)
    );
  } finally {
    hlsPlaybackCapturePrefetches.delete(key);
    if (entry.videoUrl && context.completeHlsPlaybackCapture) {
      context.completeHlsPlaybackCapture({ videoUrl: entry.videoUrl, pageLoadId: entry.pageLoadId });
    }
  }
}

function startHlsPlaybackCapturePrefetch(context: HlsPlaybackCaptureContext, entry: HlsPlaylistProxyToken) {
  if (!entry.videoUrl) return;
  if (!hlsPlaybackCaptureCanContinue(context, entry)) return;

  const assets = Object.keys(entry.assets)
    .map(function (assetId) {
      return entry.assets[assetId];
    })
    .filter(function (asset): asset is HlsPlaylistProxyAsset {
      return Boolean(asset && asset.captureFilePath);
    });
  if (!assets.length) return;

  if (context.queueHlsPlaybackBackgroundCompletion) {
    context.queueHlsPlaybackBackgroundCompletion({
      videoUrl: entry.videoUrl,
      pageLoadId: entry.pageLoadId,
      run: function (signal) {
        return runHlsPlaybackCapturePrefetchWithCompletion(context, entry, assets, signal);
      }
    });
    return;
  }

  runHlsPlaybackCapturePrefetchWithCompletion(context, entry, assets).catch(function (error) {
    logger(context).info(
      '[hls-capture] prefetch failed',
      'host=' + entry.host,
      'pathHash=' + entry.pathHash,
      'tabId=' + String(entry.tabId),
      'error=' + mainErrorMessage(error)
    );
  });
}

async function handleHlsPlaylistProxyAssetRequest(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  assetId: string,
  request: Request
): Promise<Response> {
  const asset = entry.assets[assetId] || null;
  if (!asset) {
    return new Response('playlist proxy asset unavailable', {
      status: 404,
      headers: hlsPlaylistProxyFallbackHeaders()
    });
  }

  logger(context).info(
    '[hls-proxy] asset',
    'method=' + request.method,
    'host=' + asset.host,
    'pathHash=' + asset.pathHash,
    'tabId=' + String(entry.tabId),
    'videoUrl=' + String(entry.videoUrl)
  );

  const capturedResponse = await hlsPlaylistProxyCapturedAssetResponse(context, entry, asset, request);
  if (capturedResponse) return capturedResponse;

  const abort = hlsPlaylistProxyFetchAbort(request);

  try {
    const upstream = await context.jableSession.fetch(asset.sourceUrl, {
      method: request.method,
      headers: hlsPlaylistProxyAssetFetchHeaders(entry, request),
      signal: abort.signal
    });
    abort.cleanup();

    logger(context).info(
      '[hls-proxy] asset served',
      'status=' + upstream.status,
      'host=' + asset.host,
      'pathHash=' + asset.pathHash,
      'tabId=' + String(entry.tabId),
      'videoUrl=' + String(entry.videoUrl)
    );

    return new Response(
      request.method === 'HEAD' ? null : hlsPlaylistProxyAssetBody(context, entry, asset, upstream.body),
      {
        status: upstream.status,
        headers: hlsPlaylistProxyAssetResponseHeaders(entry, upstream)
      }
    );
  } catch (error) {
    abort.cleanup();
    if (abort.clientAborted()) {
      logger(context).info(
        '[hls-proxy] asset aborted',
        'host=' + asset.host,
        'pathHash=' + asset.pathHash,
        'tabId=' + String(entry.tabId),
        'videoUrl=' + String(entry.videoUrl)
      );
      return new Response(null, {
        status: 499,
        headers: hlsPlaylistProxyFallbackHeaders()
      });
    }

    logger(context).info(
      '[hls-proxy] asset failed',
      'host=' + asset.host,
      'pathHash=' + asset.pathHash,
      'tabId=' + String(entry.tabId),
      'error=' + mainErrorMessage(error)
    );
    return new Response('playlist proxy asset failed', {
      status: 502,
      headers: hlsPlaylistProxyFallbackHeaders()
    });
  }
}

async function handleHlsPlaylistProxyRequest(context: HlsPlaybackCaptureContext, request: Request): Promise<Response> {
  const target = hlsPlaylistProxyRequestTargetFromUrl(request.url);
  const entry = target ? hlsPlaylistProxyTokens.get(target.token) || null : null;

  logger(context).info(
    '[hls-proxy] handler',
    'method=' + request.method,
    'target=' + (target ? target.type : 'missing'),
    'token=' + (target ? 'present' : 'missing'),
    'entry=' + (entry ? 'present' : 'missing')
  );

  if (!target || !entry || entry.expiresAt <= Date.now()) {
    if (target) hlsPlaylistProxyTokens.delete(target.token);
    return new Response('playlist proxy token unavailable', {
      status: 404,
      headers: hlsPlaylistProxyFallbackHeaders()
    });
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: hlsPlaylistProxyResponseHeaders(entry)
    });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', {
      status: 405,
      headers: {
        allow: 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'accept, content-type, origin, range, referer, user-agent',
        'access-control-allow-credentials': 'true',
        'access-control-allow-private-network': 'true',
        'access-control-allow-origin': entry.origin,
        'access-control-allow-methods': 'GET, HEAD, OPTIONS'
      }
    });
  }

  entry.expiresAt = Date.now() + HLS_PLAYLIST_PROXY_TOKEN_TTL_MS;

  if (target.type === 'asset') return handleHlsPlaylistProxyAssetRequest(context, entry, target.assetId, request);

  const abort = hlsPlaylistProxyFetchAbort(request);

  try {
    logger(context).info(
      '[hls-proxy] fetch',
      'host=' + entry.host,
      'pathHash=' + entry.pathHash,
      'tabId=' + String(entry.tabId),
      'videoUrl=' + String(entry.videoUrl)
    );
    const upstream = await context.jableSession.fetch(entry.playlistUrl, {
      method: request.method,
      headers: hlsPlaylistProxyFetchHeaders(entry),
      signal: abort.signal
    });
    abort.cleanup();

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: upstream.status,
        headers: hlsPlaylistProxyResponseHeaders(entry)
      });
    }

    const text = await upstream.text();
    if (upstream.ok) entry.playlistText = text;
    const capturePlan = upstream.ok ? hlsPlaylistProxyPrepareCapture(context, entry, text) : null;
    if (capturePlan) entry.capturePlan = capturePlan;
    const body = upstream.ok
      ? hlsPlaylistProxyRewritePlaylist(context, target.token, entry, text, entry.playlistUrl, capturePlan)
      : text;
    if (capturePlan) startHlsPlaybackCapturePrefetch(context, entry);
    logger(context).info(
      '[hls-proxy] served',
      'status=' + upstream.status,
      'host=' + entry.host,
      'pathHash=' + entry.pathHash,
      'tabId=' + String(entry.tabId),
      'videoUrl=' + String(entry.videoUrl)
    );

    return new Response(body, {
      status: upstream.status,
      headers: hlsPlaylistProxyResponseHeaders(entry, body)
    });
  } catch (error) {
    abort.cleanup();
    if (abort.clientAborted()) {
      logger(context).info(
        '[hls-proxy] fetch aborted',
        'host=' + entry.host,
        'pathHash=' + entry.pathHash,
        'tabId=' + String(entry.tabId),
        'videoUrl=' + String(entry.videoUrl)
      );
      return new Response(null, {
        status: 499,
        headers: hlsPlaylistProxyFallbackHeaders()
      });
    }

    logger(context).info(
      '[hls-proxy] fetch failed',
      'host=' + entry.host,
      'pathHash=' + entry.pathHash,
      'tabId=' + String(entry.tabId),
      'error=' + mainErrorMessage(error)
    );
    return hlsPlaylistProxyFallbackRedirect(context, entry);
  }
}

async function writeHlsPlaylistProxyHttpResponse(response: NodeHttp.ServerResponse, proxyResponse: Response) {
  response.statusCode = proxyResponse.status;
  proxyResponse.headers.forEach(function (value, key) {
    response.setHeader(key, value);
  });

  if (!proxyResponse.body) {
    response.end();
    return;
  }

  const reader = proxyResponse.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value) continue;
      if (!response.write(Buffer.from(chunk.value))) {
        await new Promise(function (resolve) {
          response.once('drain', resolve);
        });
      }
    }
    response.end();
  } finally {
    reader.releaseLock();
  }
}

function hlsPlaylistProxyRequestHeaders(request: NodeHttp.IncomingMessage): Headers {
  const headers = new Headers();
  const range = request.headers.range;
  if (typeof range === 'string') headers.set('range', range);
  else if (Array.isArray(range) && range[0]) headers.set('range', range[0]);
  return headers;
}

function hlsPlaylistProxyLoopbackAbort(
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse
): HlsPlaylistProxyAbort {
  const abortController = new AbortController();
  let clientAborted = false;

  function abortFromClient() {
    clientAborted = true;
    abortController.abort();
  }

  function abortFromClosedResponse() {
    if (!response.writableEnded) abortFromClient();
  }

  request.once('aborted', abortFromClient);
  response.once('close', abortFromClosedResponse);

  return {
    cleanup: function () {
      request.removeListener('aborted', abortFromClient);
      response.removeListener('close', abortFromClosedResponse);
    },
    clientAborted: function () {
      return clientAborted || abortController.signal.aborted;
    },
    signal: abortController.signal
  };
}

async function handleHlsPlaylistProxyHttpRequest(
  context: HlsPlaybackCaptureContext,
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse
) {
  const port = hlsPlaylistProxyPort;
  if (!port) {
    response.statusCode = 503;
    response.end('playlist proxy unavailable');
    return;
  }

  const targetUrl = 'http://' + HLS_PLAYLIST_PROXY_HOST + ':' + port + String(request.url || '/');
  const abort = hlsPlaylistProxyLoopbackAbort(request, response);

  try {
    const proxyResponse = await handleHlsPlaylistProxyRequest(
      context,
      new Request(targetUrl, {
        headers: hlsPlaylistProxyRequestHeaders(request),
        method: request.method || 'GET',
        signal: abort.signal
      })
    );
    await writeHlsPlaylistProxyHttpResponse(response, proxyResponse);
  } catch (error) {
    if (abort.clientAborted()) {
      logger(context).info('[hls-proxy] loopback aborted');
      return;
    }

    logger(context).info('[hls-proxy] loopback failed', 'error=' + mainErrorMessage(error));
    response.statusCode = 500;
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.end('playlist proxy failed');
  } finally {
    abort.cleanup();
  }
}

function startHlsPlaylistProxyServer(context: HlsPlaybackCaptureContext): Promise<number> {
  if (hlsPlaylistProxyServer && hlsPlaylistProxyPort) return Promise.resolve(hlsPlaylistProxyPort);

  return new Promise(function (resolve, reject) {
    const server = http.createServer(function (request, response) {
      handleHlsPlaylistProxyHttpRequest(context, request, response).catch(function (error) {
        logger(context).info('[hls-proxy] loopback unhandled', 'error=' + mainErrorMessage(error));
        if (!response.headersSent) response.statusCode = 500;
        response.end('playlist proxy failed');
      });
    });

    function handleError(error: Error) {
      reject(error);
    }

    server.once('error', handleError);
    server.listen(0, HLS_PLAYLIST_PROXY_HOST, function () {
      server.removeListener('error', handleError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('HLS playlist proxy did not receive a TCP port'));
        return;
      }

      hlsPlaylistProxyServer = server;
      hlsPlaylistProxyPort = address.port;
      logger(context).info('[hls-proxy] loopback listening', 'host=' + HLS_PLAYLIST_PROXY_HOST, 'port=' + address.port);
      resolve(address.port);
    });
  });
}

function unavailableHlsPlaylistProxyUrl(reason: HlsPlaylistProxyUnavailableReason): HlsPlaylistProxyUrlResult {
  return {
    available: false,
    reason: reason
  };
}

function hlsPlaylistProxyPayloadString(payload: unknown, key: string): string {
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

  hlsPlaybackCaptureActivePages.set(hlsPlaybackCaptureActivePageKey(event.sender.id, senderVideoUrl, pageLoadId), {
    expiresAt: Date.now() + HLS_PLAYBACK_CAPTURE_ACTIVITY_TTL_MS,
    userInitiatedPlayback: userInitiatedPlayback
  });

  let prepared = 0;
  for (const tokenEntry of hlsPlaylistProxyTokens) {
    const entry = tokenEntry[1];
    if (entry.webContentsId !== event.sender.id || entry.videoUrl !== senderVideoUrl) continue;
    if (pageLoadId && entry.pageLoadId !== pageLoadId) continue;
    entry.metadata = mergeHlsPlaybackCaptureMetadata(entry.metadata, metadata);
    if (!hlsPlaylistProxyEnsureCapture(context, entry)) continue;
    startHlsPlaybackCapturePrefetch(context, entry);
    prepared += 1;
  }

  logger(context).info(
    '[hls-capture] playback started',
    'webContentsId=' + event.sender.id,
    'prepared=' + prepared,
    'userInitiated=' + String(userInitiatedPlayback),
    'videoUrl=' + senderVideoUrl
  );
}

function hlsPlaylistProxyUrlForRenderer(
  context: HlsPlaybackCaptureContext,
  event: Electron.IpcMainInvokeEvent,
  payload: unknown
): HlsPlaylistProxyUrlResult {
  if (!isHlsPlaylistProxyEnabled(context)) return unavailableHlsPlaylistProxyUrl('disabled');
  if (!hlsPlaylistProxyPort) return unavailableHlsPlaylistProxyUrl('unavailable');

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

  const token = createHlsPlaylistProxyTokenForVideo(
    context,
    event.sender.id,
    tabId,
    senderVideoUrl,
    playlistUrl,
    metadata,
    pageLoadId
  );
  const sourceUrl = hlsPlaylistProxyTokenUrl(token);
  if (!sourceUrl) return unavailableHlsPlaylistProxyUrl('unavailable');

  const entry = hlsPlaylistProxyTokens.get(token);
  logger(context).info(
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

function installHlsPlaylistProxyIpc(context: HlsPlaybackCaptureContext) {
  if (hlsPlaylistProxyIpcInstalled) return;
  hlsPlaylistProxyIpcInstalled = true;

  context.ipcMain.handle('hls:playlist-proxy-url', function (event, payload) {
    return hlsPlaylistProxyUrlForRenderer(context, event, payload);
  });
  context.ipcMain.on('hls:playback-started', function (event, payload) {
    hlsPlaybackCaptureStartedForRenderer(context, event, payload);
  });
}

async function installHlsPlaylistProxy(context: HlsPlaybackCaptureContext) {
  try {
    await startHlsPlaylistProxyServer(context);
  } catch (error) {
    logger(context).info('[hls-proxy] unavailable', 'error=' + mainErrorMessage(error));
    return;
  }
  installHlsPlaylistProxyIpc(context);
  context.jableSession.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, function (details) {
    if (!isHlsPlaylistProxyLoopbackUrl(details.url)) return;
    const target = hlsPlaylistProxyRequestTargetFromUrl(details.url);
    const entry = target ? hlsPlaylistProxyTokens.get(target.token) || null : null;
    const asset = entry && target && target.type === 'asset' ? entry.assets[target.assetId] || null : null;
    logger(context).info(
      '[hls-proxy] request error',
      'requestId=' + details.id,
      'webContentsId=' + String(details.webContentsId || null),
      'resourceType=' + details.resourceType,
      'pathHash=' + String(asset ? asset.pathHash : entry ? entry.pathHash : hlsProbePathHash(details.url)),
      'error=' + details.error,
      'videoUrl=' + String(entry ? entry.videoUrl : null)
    );
  });

  logger(context).info(
    '[hls-proxy] installed loopback HLS proxy; playlist requests require Settings auto-download or debug env'
  );
}

function installHlsPlaybackCapture(context: HlsPlaybackCaptureContext): Promise<void> {
  installHlsPlaybackProbe(context);
  return installHlsPlaylistProxy(context);
}

module.exports = {
  installHlsPlaybackCapture: installHlsPlaybackCapture
};
