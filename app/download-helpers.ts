'use strict';

import { URL } from 'node:url';

export const DOWNLOAD_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari';

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

export function videoPageRequestHeaders(videoUrl: string, cookieHeader: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml',
    referer: new URL(videoUrl).origin + '/',
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
