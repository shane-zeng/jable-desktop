'use strict';

import type * as Electron from 'electron';
import { DownloadHttpError, DownloadSegmentError, HlsPlaylistNotFoundError } from './errors';
import { sourcePageChineseSubtitleNoticeTextFromHtml } from './request-boundary';

export type DownloadFailurePhase = 'ffmpeg_check' | 'video_page' | 'playlist' | 'segments' | 'remux' | 'file';
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
export type HlsPlaylist = {
  variants: Array<{ url: string; bandwidth: number | null }>;
  segments: HlsSegment[];
  targetDuration: number | null;
};
export type SourcePageChineseSubtitleNotice = {
  sourcePageChineseSubtitleNotice: boolean;
  sourcePageSubtitleNoticeText: string | null;
};
export type DownloadHlsHelpers = {
  extractHlsPlaylistUrl(html: string, pageUrl: string): string | null;
  parseHlsPlaylist(content: string, playlistUrl: string): HlsPlaylist;
  videoPageRequestHeaders(videoUrl: string, cookieHeader: string): Record<string, string>;
  hlsRequestHeaders(videoUrl: string, cookieHeader: string): Record<string, string>;
};

export type DownloadHlsSourceResolver = {
  resolveDownloadHlsSource(
    videoUrl: string,
    signal: AbortSignal,
    setFailurePhase?: (phase: DownloadFailurePhase) => void,
    updateSourcePageNotice?: (notice: SourcePageChineseSubtitleNotice) => void
  ): Promise<
    {
      cookieHeader: string;
      playlist: HlsPlaylist;
    } & SourcePageChineseSubtitleNotice
  >;
};

type DownloadHlsSourceResolverOptions = {
  helpers: DownloadHlsHelpers;
  session: typeof Electron.session;
  sessionPartition: string;
  throwIfDownloadCanceled(videoUrl: string): void;
};

export function createDownloadHlsSourceResolver(options: DownloadHlsSourceResolverOptions): DownloadHlsSourceResolver {
  async function cookieHeaderForUrl(targetUrl: string): Promise<string> {
    const origin = new URL(targetUrl).origin;
    const cookies = await options.session.fromPartition(options.sessionPartition).cookies.get({ url: origin });
    return cookies
      .map(function (cookie) {
        return cookie.name + '=' + cookie.value;
      })
      .join('; ');
  }

  async function fetchVideoPageHtml(videoUrl: string, signal?: AbortSignal | null): Promise<string> {
    const cookieHeader = await cookieHeaderForUrl(videoUrl);
    const headers = options.helpers.videoPageRequestHeaders(videoUrl, cookieHeader);

    const response = await fetch(videoUrl, { headers: headers, signal: signal || undefined });
    if (!response.ok) throw new DownloadHttpError(response.status);
    return response.text();
  }

  async function fetchHlsText(
    playlistUrl: string,
    videoUrl: string,
    cookieHeader: string,
    signal: AbortSignal
  ): Promise<string> {
    const response = await fetch(playlistUrl, {
      headers: options.helpers.hlsRequestHeaders(videoUrl, cookieHeader),
      signal: signal
    });
    if (!response.ok) throw new DownloadSegmentError('playlist HTTP ' + response.status);
    return response.text();
  }

  function highestBandwidthVariant(playlist: HlsPlaylist): string | null {
    const variants = playlist.variants.slice();
    if (!variants.length) return null;

    variants.sort(function (a, b) {
      return (b.bandwidth || 0) - (a.bandwidth || 0);
    });
    return variants[0].url;
  }

  async function resolveHlsMediaPlaylist(
    playlistUrl: string,
    videoUrl: string,
    cookieHeader: string,
    signal: AbortSignal
  ): Promise<HlsPlaylist> {
    let currentPlaylistUrl = playlistUrl;

    for (let i = 0; i < 3; i++) {
      options.throwIfDownloadCanceled(videoUrl);
      const content = await fetchHlsText(currentPlaylistUrl, videoUrl, cookieHeader, signal);
      const playlist = options.helpers.parseHlsPlaylist(content, currentPlaylistUrl);
      if (playlist.segments.length) return playlist;

      const variantUrl = highestBandwidthVariant(playlist);
      if (!variantUrl || variantUrl === currentPlaylistUrl) break;
      currentPlaylistUrl = variantUrl;
    }

    throw new HlsPlaylistNotFoundError();
  }

  async function resolveDownloadHlsSource(
    videoUrl: string,
    signal: AbortSignal,
    setFailurePhase?: (phase: DownloadFailurePhase) => void,
    updateSourcePageNotice?: (notice: SourcePageChineseSubtitleNotice) => void
  ): Promise<
    {
      cookieHeader: string;
      playlist: HlsPlaylist;
    } & SourcePageChineseSubtitleNotice
  > {
    if (setFailurePhase) setFailurePhase('video_page');
    const cookieHeader = await cookieHeaderForUrl(videoUrl);
    const html = await fetchVideoPageHtml(videoUrl, signal);
    const sourcePageSubtitleNoticeText = sourcePageChineseSubtitleNoticeTextFromHtml(html);
    const sourcePageNotice = {
      sourcePageChineseSubtitleNotice: sourcePageSubtitleNoticeText !== null,
      sourcePageSubtitleNoticeText: sourcePageSubtitleNoticeText
    };
    if (updateSourcePageNotice) updateSourcePageNotice(sourcePageNotice);
    options.throwIfDownloadCanceled(videoUrl);
    if (setFailurePhase) setFailurePhase('playlist');
    const playlistUrl = options.helpers.extractHlsPlaylistUrl(html, videoUrl);
    if (!playlistUrl) throw new HlsPlaylistNotFoundError();
    options.throwIfDownloadCanceled(videoUrl);
    const playlist = await resolveHlsMediaPlaylist(playlistUrl, videoUrl, cookieHeader, signal);
    return {
      cookieHeader: cookieHeader,
      playlist: playlist,
      sourcePageChineseSubtitleNotice: sourcePageNotice.sourcePageChineseSubtitleNotice,
      sourcePageSubtitleNoticeText: sourcePageNotice.sourcePageSubtitleNoticeText
    };
  }

  return {
    resolveDownloadHlsSource: resolveDownloadHlsSource
  };
}
