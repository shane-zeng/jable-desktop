'use strict';

import { URL } from 'node:url';

export const DOWNLOAD_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari';

export type HlsKey = {
  method: string;
  uri: string | null;
  iv: string | null;
};

export type HlsSegment = {
  url: string;
  duration: number | null;
  key: HlsKey | null;
};

export type HlsVariant = {
  url: string;
  bandwidth: number | null;
};

export type HlsPlaylist = {
  variants: HlsVariant[];
  segments: HlsSegment[];
  targetDuration: number | null;
};

export type LocalHlsSegment = {
  fileName: string;
  duration: number | null;
  keyFileName: string | null;
  keyMethod: string | null;
  keyIv: string | null;
};

function hlsUrlCandidate(value: string, pageUrl: string): string | null {
  const candidate = value.replace(/\\\//g, '/').replace(/&amp;/g, '&').trim();
  if (candidate.indexOf('.m3u8') === -1) return null;

  try {
    return new URL(candidate, pageUrl).toString();
  } catch (error) {
    return null;
  }
}

export function extractHlsPlaylistUrl(html: string, pageUrl: string): string | null {
  const candidates = new Set<string>();
  const normalizedHtml = html.replace(/\\\//g, '/');
  const absoluteMatches = normalizedHtml.match(/https?:\/\/[^"'<>\\\s]+\.m3u8[^"'<>\\\s]*/g) || [];

  for (let i = 0; i < absoluteMatches.length; i++) {
    const candidate = hlsUrlCandidate(absoluteMatches[i], pageUrl);
    if (candidate) candidates.add(candidate);
  }

  const quotedPattern = /["']([^"']+\.m3u8[^"']*)["']/g;
  let match = quotedPattern.exec(normalizedHtml);
  while (match) {
    const candidate = hlsUrlCandidate(match[1], pageUrl);
    if (candidate) candidates.add(candidate);
    match = quotedPattern.exec(normalizedHtml);
  }

  return candidates.values().next().value || null;
}

function splitHlsAttributeList(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const character of value) {
    if (character === '"') inQuotes = !inQuotes;
    if (character === ',' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function unquoteHlsAttribute(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseHlsAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const parts = splitHlsAttributeList(value);

  for (const part of parts) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = part.slice(0, separatorIndex).trim().toUpperCase();
    const attributeValue = unquoteHlsAttribute(part.slice(separatorIndex + 1));
    if (key) attributes[key] = attributeValue;
  }

  return attributes;
}

function resolveHlsUri(value: string, playlistUrl: string): string | null {
  try {
    return new URL(value.replace(/&amp;/g, '&').trim(), playlistUrl).toString();
  } catch (error) {
    return null;
  }
}

function parseExtinfDuration(line: string): number | null {
  const value = line.slice('#EXTINF:'.length).split(',')[0].trim();
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export function parseHlsPlaylist(content: string, playlistUrl: string): HlsPlaylist {
  const variants: HlsVariant[] = [];
  const segments: HlsSegment[] = [];
  let pendingVariant = false;
  let pendingVariantBandwidth: number | null = null;
  let pendingDuration: number | null = null;
  let currentKey: HlsKey | null = null;
  let targetDuration: number | null = null;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const duration = Number(line.slice('#EXT-X-TARGETDURATION:'.length).trim());
      targetDuration = Number.isFinite(duration) && duration > 0 ? duration : targetDuration;
      continue;
    }

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attributes = parseHlsAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      const bandwidth = Number(attributes.BANDWIDTH);
      pendingVariant = true;
      pendingVariantBandwidth = Number.isFinite(bandwidth) ? bandwidth : null;
      continue;
    }

    if (line.startsWith('#EXT-X-KEY:')) {
      const attributes = parseHlsAttributes(line.slice('#EXT-X-KEY:'.length));
      const method = (attributes.METHOD || '').toUpperCase();
      if (method === 'NONE') {
        currentKey = null;
      } else {
        currentKey = {
          method: method,
          uri: attributes.URI ? resolveHlsUri(attributes.URI, playlistUrl) : null,
          iv: attributes.IV || null
        };
      }
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      pendingDuration = parseExtinfDuration(line);
      continue;
    }

    if (line.startsWith('#')) continue;

    const resolvedUrl = resolveHlsUri(line, playlistUrl);
    if (!resolvedUrl) continue;

    if (pendingVariant) {
      variants.push({
        url: resolvedUrl,
        bandwidth: pendingVariantBandwidth
      });
      pendingVariant = false;
      pendingVariantBandwidth = null;
      continue;
    }

    segments.push({
      url: resolvedUrl,
      duration: pendingDuration,
      key: currentKey ? Object.assign({}, currentKey) : null
    });
    pendingDuration = null;
  }

  return {
    variants: variants,
    segments: segments,
    targetDuration: targetDuration
  };
}

function hlsDurationValue(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : '0';
}

export function buildLocalHlsPlaylist(segments: LocalHlsSegment[], targetDuration: number | null): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:' + (targetDuration && targetDuration > 0 ? Math.ceil(targetDuration) : 10),
    '#EXT-X-MEDIA-SEQUENCE:0'
  ];
  let previousKey = '';

  for (const segment of segments) {
    const key =
      segment.keyMethod && segment.keyFileName
        ? segment.keyMethod + '|' + segment.keyFileName + '|' + (segment.keyIv || '')
        : '';
    if (key !== previousKey) {
      if (segment.keyMethod && segment.keyFileName) {
        let keyLine = '#EXT-X-KEY:METHOD=' + segment.keyMethod + ',URI="' + segment.keyFileName + '"';
        if (segment.keyIv) keyLine += ',IV=' + segment.keyIv;
        lines.push(keyLine);
      } else if (previousKey) {
        lines.push('#EXT-X-KEY:METHOD=NONE');
      }
      previousKey = key;
    }

    lines.push('#EXTINF:' + hlsDurationValue(segment.duration) + ',');
    lines.push(segment.fileName);
  }

  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}

export function videoPageRequestHeaders(videoUrl: string, cookieHeader: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml',
    referer: new URL(videoUrl).origin + '/',
    'user-agent': DOWNLOAD_USER_AGENT
  };
  if (cookieHeader) headers.cookie = cookieHeader;
  return headers;
}

export function hlsRequestHeaders(videoUrl: string, cookieHeader: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: '*/*',
    referer: videoUrl,
    'user-agent': DOWNLOAD_USER_AGENT
  };
  if (cookieHeader) headers.cookie = cookieHeader;
  return headers;
}

export function ffmpegHeaderBlock(videoUrl: string, cookieHeader: string): string {
  const headers = ['Referer: ' + videoUrl, 'User-Agent: ' + DOWNLOAD_USER_AGENT];
  if (cookieHeader) headers.push('Cookie: ' + cookieHeader);
  return headers.join('\r\n') + '\r\n';
}
