'use strict';

import type * as NodeCrypto from 'node:crypto';
import type * as NodeFs from 'node:fs';
import type * as NodeStream from 'node:stream';
import type { DownloadRecord, LocalPlaybackSourceResult, LocalPlaybackUnavailableReason } from '../../types/jable';
import { parseLocalPlaybackRangeHeader } from './range';
import type { LocalPlaybackFile, LocalPlaybackPreviewController } from './preview';

const nodeCrypto: typeof NodeCrypto = require('node:crypto');
const fs: typeof NodeFs = require('node:fs');
const stream: typeof NodeStream = require('node:stream');

type LocalPlaybackSourceRequest = {
  videoUrl: string | null;
  sourcePageChineseSubtitleNotice: boolean | null;
};

type LocalPlaybackRequestTarget =
  | {
      type: 'video';
      token: string;
    }
  | {
      type: 'preview-vtt';
      token: string;
    }
  | {
      type: 'preview-image';
      token: string;
      fileName: string;
    };

type LocalPlaybackResponseBody = ConstructorParameters<typeof Response>[0];
type LocalPlaybackResponseHeaders = NonNullable<ConstructorParameters<typeof Response>[1]>['headers'];

type LocalPlaybackServerOptions = {
  canonicalVideoUrl(value: unknown): string | null;
  getPersistedDownload(videoUrl: string): DownloadRecord | null;
  localPlaybackScheme: string;
  previewController: LocalPlaybackPreviewController;
  readyFile(videoUrl: string): LocalPlaybackFile | null;
  reconcileDownloadRecordFileState(record: DownloadRecord): DownloadRecord;
};

type LocalPlaybackServer = {
  handleRequest(request: Request): Promise<Response>;
  source(value: unknown): LocalPlaybackSourceResult;
};

const LOCAL_PLAYBACK_TOKEN_TTL_MS = 30 * 60 * 1000;

export function createLocalPlaybackServer(options: LocalPlaybackServerOptions): LocalPlaybackServer {
  const localPlaybackTokens = new Map<string, { videoUrl: string; expiresAt: number }>();

  function unavailable(videoUrl: string | null, reason: LocalPlaybackUnavailableReason): LocalPlaybackSourceResult {
    return {
      available: false,
      videoUrl: videoUrl,
      reason: reason
    };
  }

  function tokenUrl(token: string): string {
    return options.localPlaybackScheme + '://play/' + token + '.mp4';
  }

  function purgeExpiredTokens(now = Date.now()) {
    for (const entry of localPlaybackTokens) {
      if (entry[1].expiresAt <= now) localPlaybackTokens.delete(entry[0]);
    }
  }

  function createToken(videoUrl: string): string {
    purgeExpiredTokens();
    const token = nodeCrypto.randomBytes(18).toString('base64url');
    localPlaybackTokens.set(token, {
      videoUrl: videoUrl,
      expiresAt: Date.now() + LOCAL_PLAYBACK_TOKEN_TTL_MS
    });
    return token;
  }

  function requestTargetFromUrl(value: unknown): LocalPlaybackRequestTarget | null {
    try {
      const parsed = new URL(String(value || ''));
      if (parsed.protocol !== options.localPlaybackScheme + ':') return null;

      if (parsed.hostname === 'play') {
        const match = parsed.pathname.match(/^\/([A-Za-z0-9_-]+)\.mp4$/);
        return match
          ? {
              type: 'video',
              token: match[1]
            }
          : null;
      }

      if (parsed.hostname === 'thumb') {
        const vttMatch = parsed.pathname.match(/^\/([A-Za-z0-9_-]+)\/thumb\.vtt$/);
        if (vttMatch) {
          return {
            type: 'preview-vtt',
            token: vttMatch[1]
          };
        }

        const imageMatch = parsed.pathname.match(/^\/([A-Za-z0-9_-]+)\/(thumb-\d{6}\.jpg)$/);
        return imageMatch
          ? {
              type: 'preview-image',
              token: imageMatch[1],
              fileName: imageMatch[2]
            }
          : null;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  function videoUrlForToken(token: string): string | null {
    const entry = localPlaybackTokens.get(token);
    const now = Date.now();
    if (!entry || entry.expiresAt <= now) {
      localPlaybackTokens.delete(token);
      return null;
    }

    entry.expiresAt = now + LOCAL_PLAYBACK_TOKEN_TTL_MS;
    return entry.videoUrl;
  }

  function normalizeSourceRequest(value: unknown): LocalPlaybackSourceRequest {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as {
        videoUrl?: unknown;
        sourcePageChineseSubtitleNotice?: unknown;
      };
      const notice =
        typeof record.sourcePageChineseSubtitleNotice === 'boolean' ? record.sourcePageChineseSubtitleNotice : null;
      return {
        videoUrl: options.canonicalVideoUrl(record.videoUrl),
        sourcePageChineseSubtitleNotice: notice
      };
    }

    return {
      videoUrl: options.canonicalVideoUrl(value),
      sourcePageChineseSubtitleNotice: null
    };
  }

  function source(value: unknown): LocalPlaybackSourceResult {
    const request = normalizeSourceRequest(value);
    const videoUrl = request.videoUrl;
    if (!videoUrl) return unavailable(null, 'not_video');

    const record = options.getPersistedDownload(videoUrl);
    if (!record) return unavailable(videoUrl, 'not_ready');

    const readyRecord = options.reconcileDownloadRecordFileState(record);
    if (readyRecord.state === 'missing') return unavailable(videoUrl, 'missing');
    if (readyRecord.state !== 'ready') return unavailable(videoUrl, 'not_ready');
    if (
      request.sourcePageChineseSubtitleNotice !== null &&
      readyRecord.sourcePageChineseSubtitleNotice !== request.sourcePageChineseSubtitleNotice
    ) {
      return unavailable(videoUrl, 'source_page_changed');
    }

    const readyFile = options.readyFile(videoUrl);
    if (!readyFile) return unavailable(videoUrl, 'unavailable');

    const token = createToken(readyFile.record.videoUrl);
    const previewMetadata = options.previewController.readMetadata(readyFile);
    if (!previewMetadata) options.previewController.scheduleGeneration(readyFile);

    return {
      available: true,
      videoUrl: readyFile.record.videoUrl,
      sourceUrl: tokenUrl(token),
      thumbnailVttUrl: previewMetadata ? options.previewController.vttUrl(token) : null,
      title: readyFile.record.title,
      fileSizeBytes: readyFile.stats.size
    };
  }

  function response(status: number, body: LocalPlaybackResponseBody, headers?: LocalPlaybackResponseHeaders): Response {
    return new Response(body, {
      status: status,
      headers: headers
    });
  }

  function errorResponse(status: number, message: string): Response {
    return response(status, message, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8'
    });
  }

  function fileResponse(file: LocalPlaybackFile, request: Request): Response {
    const method = request.method.toUpperCase();
    const size = file.stats.size;
    const range = parseLocalPlaybackRangeHeader(request.headers.get('range'), size);
    const headers: Record<string, string> = {
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'content-type': 'video/mp4'
    };

    if (!range.satisfiable) {
      return response(416, null, Object.assign(headers, { 'content-range': 'bytes */' + size }));
    }

    const contentLength = size === 0 ? 0 : range.end - range.start + 1;
    headers['content-length'] = String(contentLength);
    if (range.status === 206) headers['content-range'] = 'bytes ' + range.start + '-' + range.end + '/' + size;

    if (method === 'HEAD' || contentLength === 0) {
      return response(range.status, null, headers);
    }

    const fileStream = fs.createReadStream(file.filePath, {
      start: range.start,
      end: range.end
    });
    const body = stream.Readable.toWeb(fileStream) as unknown as LocalPlaybackResponseBody;
    return response(range.status, body, headers);
  }

  function previewVttResponse(file: LocalPlaybackFile, request: Request): Response {
    const metadata = options.previewController.readMetadata(file);
    if (!metadata) return errorResponse(404, 'Not Found');

    const body = request.method.toUpperCase() === 'HEAD' ? null : options.previewController.vttText(metadata);
    return response(200, body, {
      'cache-control': 'private, max-age=1800',
      'content-type': 'text/vtt; charset=utf-8'
    });
  }

  function previewImageResponse(
    file: LocalPlaybackFile,
    target: Extract<LocalPlaybackRequestTarget, { type: 'preview-image' }>,
    request: Request
  ): Response {
    const metadata = options.previewController.readMetadata(file);
    if (
      !metadata ||
      !metadata.cues.some(function (cue) {
        return cue.fileName === target.fileName;
      })
    ) {
      return errorResponse(404, 'Not Found');
    }

    const filePath = options.previewController.imageFilePath(file, target.fileName);
    let stats: NodeFs.Stats;
    try {
      stats = fs.statSync(filePath);
      if (!stats.isFile()) return errorResponse(404, 'Not Found');
    } catch (error) {
      return errorResponse(404, 'Not Found');
    }

    const headers = {
      'cache-control': 'private, max-age=1800',
      'content-length': String(stats.size),
      'content-type': 'image/jpeg'
    };
    if (request.method.toUpperCase() === 'HEAD') return response(200, null, headers);

    const fileStream = fs.createReadStream(filePath);
    const body = stream.Readable.toWeb(fileStream) as unknown as LocalPlaybackResponseBody;
    return response(200, body, headers);
  }

  async function handleRequest(request: Request): Promise<Response> {
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return errorResponse(405, 'Method Not Allowed');
    }

    const target = requestTargetFromUrl(request.url);
    if (!target) return errorResponse(404, 'Not Found');

    const videoUrl = videoUrlForToken(target.token);
    if (!videoUrl) return errorResponse(404, 'Not Found');

    const readyFile = options.readyFile(videoUrl);
    if (!readyFile) return errorResponse(404, 'Not Found');

    if (target.type === 'preview-vtt') return previewVttResponse(readyFile, request);
    if (target.type === 'preview-image') return previewImageResponse(readyFile, target, request);
    return fileResponse(readyFile, request);
  }

  return {
    handleRequest: handleRequest,
    source: source
  };
}
