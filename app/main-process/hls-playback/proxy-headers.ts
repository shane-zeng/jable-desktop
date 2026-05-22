'use strict';

import type { HlsPlaybackCaptureContext, HlsPlaylistProxyToken } from './shared';

function fallbackUserAgent(): string {
  if (process.platform === 'win32') {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari';
  }
  if (process.platform === 'darwin') {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari';
  }
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari';
}

export function hlsPlaylistProxyUserAgent(context: HlsPlaybackCaptureContext, entry: HlsPlaylistProxyToken): string {
  try {
    const webContents = context.webContentsFromId(entry.webContentsId);
    if (webContents && !webContents.isDestroyed()) return webContents.getUserAgent() || fallbackUserAgent();
  } catch (error) {}
  return fallbackUserAgent();
}

export function hlsPlaylistProxyFetchHeaders(
  entry: HlsPlaylistProxyToken,
  userAgent?: string | null
): Record<string, string> {
  return {
    accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*',
    'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
    origin: entry.origin,
    // Chromium rejects full cross-origin page referrers for session.fetch; Jable's page sends the origin root.
    referer: entry.origin + '/',
    'user-agent': userAgent || fallbackUserAgent()
  };
}

export function hlsPlaylistProxyAssetFetchHeaders(
  entry: HlsPlaylistProxyToken,
  request: Request,
  userAgent?: string | null
): Record<string, string> {
  const headers = hlsPlaylistProxyFetchHeaders(entry, userAgent);
  const range = request.headers.get('range');
  headers.accept = '*/*';
  if (range) headers.range = range;
  return headers;
}

export function hlsPlaylistProxyResponseHeaders(entry: HlsPlaylistProxyToken, body?: string | null): Headers {
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

export function hlsPlaylistProxyAssetResponseHeaders(entry: HlsPlaylistProxyToken, upstream: Response): Headers {
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

export function hlsPlaylistProxyFallbackHeaders(): Headers {
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
