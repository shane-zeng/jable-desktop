'use strict';

export type HlsPlaybackCapturePlan = {
  videoUrl: string;
  playlistUrl: string;
  segmentCount: number;
  segments: Array<{
    url: string;
    filePath: string;
  }>;
};
export type HlsPlaylistProxyRewriteState = {
  captureIndexes: Record<string, number>;
  capturePlan: HlsPlaybackCapturePlan | null;
};
export type HlsPlaylistProxyRequestTarget =
  | {
      type: 'playlist';
      token: string;
    }
  | {
      assetId: string;
      type: 'asset';
      token: string;
    };
export type HlsPlaylistProxyUriRewriter = (value: string) => string;

export function hlsPlaylistProxyRemotePlaylistUrl(value: unknown, proxyHost: string): string | null {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname === proxyHost || parsed.hostname === 'localhost') return null;
    return parsed.pathname.toLowerCase().indexOf('.m3u8') !== -1 ? parsed.toString() : null;
  } catch (error) {
    return null;
  }
}

export function isHlsPlaylistProxyLoopbackUrl(value: unknown, proxyHost: string): boolean {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' && parsed.hostname === proxyHost;
  } catch (error) {
    return false;
  }
}

export function hlsPlaylistProxyAssetExtension(value: string): string {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/\.([A-Za-z0-9]{1,8})$/);
    return match ? '.' + match[1].toLowerCase() : '';
  } catch (error) {
    return '';
  }
}

export function hlsPlaylistProxyRequestTargetFromUrl(
  value: unknown,
  proxyHost: string
): HlsPlaylistProxyRequestTarget | null {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'http:' || parsed.hostname !== proxyHost) return null;
    let match = parsed.pathname.match(/^\/playlist\/([A-Za-z0-9_-]+)\.m3u8$/);
    if (match) {
      return {
        type: 'playlist',
        token: match[1]
      };
    }

    match = parsed.pathname.match(/^\/asset\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)(?:\.[A-Za-z0-9]{1,8})?$/);
    return match
      ? {
          assetId: match[2],
          type: 'asset',
          token: match[1]
        }
      : null;
  } catch (error) {
    return null;
  }
}

export function hlsPlaylistProxyAbsoluteUri(value: string, playlistUrl: string): string {
  try {
    return new URL(value.replace(/&amp;/g, '&').trim(), playlistUrl).toString();
  } catch (error) {
    return value;
  }
}

export function hlsPlaylistProxyCaptureFileForSourceUrl(
  state: HlsPlaylistProxyRewriteState,
  sourceUrl: string
): string | null {
  if (!state.capturePlan) return null;

  const startIndex = state.captureIndexes[sourceUrl] || 0;
  for (let index = startIndex; index < state.capturePlan.segments.length; index++) {
    const segment = state.capturePlan.segments[index];
    if (!segment || segment.url !== sourceUrl) continue;
    state.captureIndexes[sourceUrl] = index + 1;
    return segment.filePath;
  }

  return null;
}

export function hlsPlaylistProxyRewriteUriAttributes(line: string, rewriteUri: HlsPlaylistProxyUriRewriter): string {
  return line.replace(/URI="([^"]+)"/g, function (_match, uri: string) {
    return 'URI="' + rewriteUri(uri) + '"';
  });
}

export function hlsPlaylistProxyRewritePlaylistContent(
  content: string,
  rewriteUri: HlsPlaylistProxyUriRewriter
): string {
  return content
    .split(/\r?\n/)
    .map(function (line) {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) return hlsPlaylistProxyRewriteUriAttributes(line, rewriteUri);
      return rewriteUri(trimmed);
    })
    .join('\n');
}
