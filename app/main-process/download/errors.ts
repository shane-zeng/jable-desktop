'use strict';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type Translate = (key: string, params?: TranslationParams | null) => string;

export function mainErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeDownloadErrorDetail(message: string, downloadRootPath?: string | null): string {
  let sanitized = message.replace(/https?:\/\/[^\s"'<>]+/g, '[remote URL]');
  const rootPath = downloadRootPath || '';
  if (rootPath) {
    const variants = [rootPath, rootPath.replace(/[\\/]+/g, '/'), rootPath.replace(/[\\/]+/g, '\\')];
    const seen = new Set<string>();
    for (const variant of variants) {
      if (!variant || seen.has(variant)) continue;
      seen.add(variant);
      sanitized = sanitized.replace(
        new RegExp(escapeRegExp(variant), process.platform === 'win32' ? 'gi' : 'g'),
        '[download root]'
      );
    }
  }
  return sanitized;
}

export class DownloadHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('HTTP ' + status);
    this.name = 'DownloadHttpError';
    this.status = status;
  }
}

export class HlsPlaylistNotFoundError extends Error {
  constructor() {
    super('HLS playlist was not found');
    this.name = 'HlsPlaylistNotFoundError';
  }
}

export class HlsPlaylistUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HlsPlaylistUnsupportedError';
  }
}

export class DownloadSegmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadSegmentError';
  }
}

export class FfmpegDownloadError extends Error {
  constructor(message: string) {
    super(message || 'FFmpeg failed');
    this.name = 'FfmpegDownloadError';
  }
}

export class DownloadFileSystemError extends Error {
  constructor(error: unknown) {
    super(mainErrorMessage(error));
    this.name = 'DownloadFileSystemError';
  }
}

export class DownloadCanceledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadCanceledError';
  }
}

export class DownloadPausedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadPausedError';
  }
}

export function isDownloadCanceledError(error: unknown): boolean {
  return error instanceof DownloadCanceledError;
}

export function isDownloadPausedError(error: unknown): boolean {
  return error instanceof DownloadPausedError;
}

export function isLikelyNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'TypeError' || /fetch|network|socket|timed out|ECONN|ENOTFOUND|EAI_AGAIN/i.test(error.message);
}

export function downloadHttpStatusFromMessage(error: unknown): number | null {
  const match = mainErrorMessage(error).match(/HTTP\s+(\d{3})|HTTP\s*(\d{3})|http[_\s-]*(\d{3})/i);
  if (!match) return null;
  const status = Number(match[1] || match[2] || match[3]);
  return Number.isFinite(status) ? status : null;
}

export function isSegmentRefreshCandidate(error: unknown): boolean {
  if (!(error instanceof DownloadSegmentError)) return false;
  const status = downloadHttpStatusFromMessage(error);
  return status === 403 || status === 428 || status === 429 || status === 503 || status === 504;
}

export function downloadFailureCode(error: unknown): string {
  if (isDownloadCanceledError(error) || (error instanceof Error && error.name === 'AbortError')) {
    return 'download_canceled';
  }
  if (error instanceof DownloadHttpError) return 'video_page_http_' + error.status;
  if (error instanceof HlsPlaylistNotFoundError) return 'playlist_not_found';
  if (error instanceof HlsPlaylistUnsupportedError) return 'playlist_unsupported';
  if (error instanceof DownloadSegmentError) {
    const status = downloadHttpStatusFromMessage(error);
    return status ? 'segment_http_' + status : 'segment_failed';
  }
  if (error instanceof FfmpegDownloadError) return 'ffmpeg_exit';
  if (error instanceof DownloadFileSystemError) return 'file_system';
  if (isLikelyNetworkError(error)) return 'network';
  return 'unknown';
}

export function downloadErrorMessage(error: unknown, translate: Translate, downloadRootPath?: string | null): string {
  function sanitizedDetail(detail: unknown): string {
    return sanitizeDownloadErrorDetail(mainErrorMessage(detail), downloadRootPath);
  }

  if (isDownloadPausedError(error)) return translate('status.downloadPaused');
  if (isDownloadCanceledError(error)) return translate('status.downloadCanceled');
  if (error instanceof Error && error.name === 'AbortError') return translate('status.downloadCanceled');
  if (error instanceof DownloadHttpError)
    return translate('status.downloadErrorVideoPageHttp', { status: error.status });
  if (error instanceof HlsPlaylistNotFoundError) return translate('status.downloadErrorPlaylistMissing');
  if (error instanceof HlsPlaylistUnsupportedError) {
    return translate('status.downloadErrorPlaylistUnsupported', { error: sanitizedDetail(error) });
  }
  if (error instanceof DownloadSegmentError) {
    return translate('status.downloadErrorSegment', { error: sanitizedDetail(error) });
  }
  if (error instanceof FfmpegDownloadError) {
    return translate('status.downloadErrorFfmpeg', { error: sanitizedDetail(error) });
  }
  if (error instanceof DownloadFileSystemError) {
    return translate('status.downloadErrorFileSystem', { error: sanitizedDetail(error) });
  }
  if (isLikelyNetworkError(error)) return translate('status.downloadErrorNetwork', { error: sanitizedDetail(error) });
  return translate('status.downloadErrorUnknown', { error: sanitizedDetail(error) });
}
