'use strict';

import type * as NodeCrypto from 'node:crypto';
import type * as NodeHttp from 'node:http';
import type { HlsPlaybackCapturePlan, HlsPlaylistProxyRequestTarget, HlsPlaylistProxyRewriteState } from './helpers';
import {
  hlsPlaylistProxyAbsoluteUri,
  hlsPlaylistProxyAssetExtension,
  hlsPlaylistProxyCaptureFileForSourceUrl,
  hlsPlaylistProxyRemotePlaylistUrl,
  hlsPlaylistProxyRequestTargetFromUrl as hlsPlaylistProxyRequestTargetFromUrlHelper,
  hlsPlaylistProxyRewritePlaylistContent,
  isHlsPlaylistProxyLoopbackUrl as isHlsPlaylistProxyLoopbackUrlHelper
} from './helpers';
import { installHlsPlaylistProxyIpc } from './ipc';
import { hlsProbePathHash } from './probe';
import {
  hlsPlaylistProxyAssetBody,
  hlsPlaylistProxyCapturedAssetResponse,
  startHlsPlaybackCapturePrefetch
} from './capture-writes';
import {
  hlsPlaylistProxyAssetFetchHeaders,
  hlsPlaylistProxyAssetResponseHeaders,
  hlsPlaylistProxyFallbackHeaders,
  hlsPlaylistProxyFetchHeaders,
  hlsPlaylistProxyResponseHeaders
} from './proxy-headers';
import {
  HLS_PLAYBACK_CAPTURE_ACTIVITY_TTL_MS,
  HLS_PLAYLIST_PROXY_FETCH_TIMEOUT_MS,
  HLS_PLAYLIST_PROXY_HOST,
  HLS_PLAYLIST_PROXY_TOKEN_TTL_MS,
  hlsPlaybackDebugLog,
  isAutoDownloadOnPlaybackSettingEnabled,
  isHlsPlaybackCaptureEnabledByEnv,
  logger,
  mainErrorMessage,
  type HlsPlaybackCaptureActivePage,
  type HlsPlaybackCaptureContext,
  type HlsPlaybackCaptureMetadata,
  type HlsPlaylistProxyAbort,
  type HlsPlaylistProxyToken
} from './shared';

const nodeCrypto: typeof NodeCrypto = require('node:crypto');
const http: typeof NodeHttp = require('node:http');

const hlsPlaylistProxyTokens = new Map<string, HlsPlaylistProxyToken>();
const hlsPlaybackCaptureActiveFiles = new Map<string, Promise<boolean>>();
const hlsPlaybackCaptureActivePages = new Map<string, HlsPlaybackCaptureActivePage>();
const hlsPlaybackCapturePrefetches = new Set<string>();
let hlsPlaylistProxyServer: NodeHttp.Server | null = null;
let hlsPlaylistProxyPort: number | null = null;

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
  hlsPlaybackDebugLog(
    context,
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
      hlsPlaybackDebugLog(
        context,
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

  hlsPlaybackDebugLog(
    context,
    '[hls-proxy] asset',
    'method=' + request.method,
    'host=' + asset.host,
    'pathHash=' + asset.pathHash,
    'tabId=' + String(entry.tabId),
    'videoUrl=' + String(entry.videoUrl)
  );

  const capturedResponse = await hlsPlaylistProxyCapturedAssetResponse(
    context,
    entry,
    asset,
    request,
    hlsPlaybackCaptureActiveFiles
  );
  if (capturedResponse) return capturedResponse;

  const abort = hlsPlaylistProxyFetchAbort(request);

  try {
    const upstream = await context.jableSession.fetch(asset.sourceUrl, {
      method: request.method,
      headers: hlsPlaylistProxyAssetFetchHeaders(entry, request),
      signal: abort.signal
    });
    abort.cleanup();

    hlsPlaybackDebugLog(
      context,
      '[hls-proxy] asset served',
      'status=' + upstream.status,
      'host=' + asset.host,
      'pathHash=' + asset.pathHash,
      'tabId=' + String(entry.tabId),
      'videoUrl=' + String(entry.videoUrl)
    );

    return new Response(
      request.method === 'HEAD'
        ? null
        : hlsPlaylistProxyAssetBody(context, entry, asset, upstream.body, hlsPlaybackCaptureActiveFiles),
      {
        status: upstream.status,
        headers: hlsPlaylistProxyAssetResponseHeaders(entry, upstream)
      }
    );
  } catch (error) {
    abort.cleanup();
    if (abort.clientAborted()) {
      hlsPlaybackDebugLog(
        context,
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

    hlsPlaybackDebugLog(
      context,
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

  hlsPlaybackDebugLog(
    context,
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
    hlsPlaybackDebugLog(
      context,
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
    if (capturePlan) {
      startHlsPlaybackCapturePrefetch(context, entry, hlsPlaybackCaptureActiveFiles, hlsPlaybackCapturePrefetches);
    }
    hlsPlaybackDebugLog(
      context,
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
      hlsPlaybackDebugLog(
        context,
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
      hlsPlaybackDebugLog(context, '[hls-proxy] loopback aborted');
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

export async function installHlsPlaylistProxy(context: HlsPlaybackCaptureContext) {
  try {
    await startHlsPlaylistProxyServer(context);
  } catch (error) {
    logger(context).info('[hls-proxy] unavailable', 'error=' + mainErrorMessage(error));
    return;
  }
  installHlsPlaylistProxyIpc(context, {
    activePageKey: hlsPlaybackCaptureActivePageKey,
    activePages: hlsPlaybackCaptureActivePages,
    createTokenForVideo: createHlsPlaylistProxyTokenForVideo,
    ensureCapture: hlsPlaylistProxyEnsureCapture,
    playlistProxyPort: function () {
      return hlsPlaylistProxyPort;
    },
    startCapturePrefetch: function (captureContext, entry) {
      startHlsPlaybackCapturePrefetch(
        captureContext,
        entry,
        hlsPlaybackCaptureActiveFiles,
        hlsPlaybackCapturePrefetches
      );
    },
    tokenUrl: hlsPlaylistProxyTokenUrl,
    tokens: hlsPlaylistProxyTokens
  });
  context.jableSession.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, function (details) {
    if (!isHlsPlaylistProxyLoopbackUrl(details.url)) return;
    const target = hlsPlaylistProxyRequestTargetFromUrl(details.url);
    const entry = target ? hlsPlaylistProxyTokens.get(target.token) || null : null;
    const asset = entry && target && target.type === 'asset' ? entry.assets[target.assetId] || null : null;
    hlsPlaybackDebugLog(
      context,
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

module.exports = {
  installHlsPlaylistProxy: installHlsPlaylistProxy
};
