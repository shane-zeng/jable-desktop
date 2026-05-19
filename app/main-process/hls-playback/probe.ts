'use strict';

import type * as Electron from 'electron';
import type * as NodeCrypto from 'node:crypto';
import {
  isHlsProbeEnabledByEnv,
  isHlsProbeVerboseByEnv,
  logger,
  type HlsPlaybackCaptureContext,
  type HlsProbeTabContext
} from './shared';

type HlsProbeKind = 'playlist' | 'segment';
type HlsProbeRecord = HlsProbeTabContext & {
  kind: HlsProbeKind;
  host: string;
  pathHash: string;
  resourceType: string;
  webContentsId: number | null;
};

const nodeCrypto: typeof NodeCrypto = require('node:crypto');

const HLS_PROBE_SEGMENT_LOG_LIMIT = 30;

let hlsProbeInstalled = false;
let hlsProbeSegmentLogs = 0;
let hlsProbeSegmentLimitReported = false;
const hlsProbeRequests = new Map<number, HlsProbeRecord>();

export function hlsProbePathHash(value: unknown): string {
  return nodeCrypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 12);
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

export function installHlsPlaybackProbe(context: HlsPlaybackCaptureContext) {
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
