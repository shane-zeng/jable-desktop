'use strict';

import type * as NodeCrypto from 'node:crypto';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type * as NodeStream from 'node:stream';
import {
  hlsPlaylistProxyAssetFetchHeaders,
  hlsPlaylistProxyResponseHeaders,
  hlsPlaylistProxyUserAgent
} from './proxy-headers';
import {
  HLS_PLAYBACK_CAPTURE_PREFETCH_CONCURRENCY,
  hlsPlaybackDebugLog,
  hlsPlaybackErrorLog,
  mainErrorMessage,
  type HlsPlaybackCaptureContext,
  type HlsPlaylistProxyAsset,
  type HlsPlaylistProxyResponseBody,
  type HlsPlaylistProxyToken
} from './shared';

const nodeCrypto: typeof NodeCrypto = require('node:crypto');
const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');
const stream: typeof NodeStream = require('node:stream');

class HlsPlaybackCaptureStoppedError extends Error {
  constructor() {
    super('playback capture stopped');
    this.name = 'HlsPlaybackCaptureStoppedError';
  }
}

function isHlsPlaybackCaptureStoppedError(error: unknown): boolean {
  return error instanceof HlsPlaybackCaptureStoppedError;
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

function hlsPlaybackCaptureLogDetails(entry: HlsPlaylistProxyToken, asset: HlsPlaylistProxyAsset) {
  return {
    host: asset.host,
    pathHash: asset.pathHash,
    tabId: entry.tabId,
    videoUrl: entry.videoUrl
  };
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

async function hlsPlaybackCaptureCommitTempFile(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  asset: HlsPlaylistProxyAsset,
  tempPath: string,
  filePath: string
): Promise<boolean> {
  try {
    if (hlsPlaybackCaptureFileExists(filePath)) return false;
    // Link-then-remove gives competing capture paths an atomic winner without
    // truncating a segment another request already committed.
    await fs.promises.link(tempPath, filePath);
    return true;
  } catch (error) {
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null;
    if (code === 'EEXIST') return false;
    throw error;
  } finally {
    try {
      await fs.promises.rm(tempPath, { force: true });
    } catch (removeError) {
      hlsPlaybackErrorLog(
        context,
        'capture-temp-remove-failed',
        removeError,
        hlsPlaybackCaptureLogDetails(entry, asset)
      );
    }
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
    committed = await hlsPlaybackCaptureCommitTempFile(context, entry, asset, tempPath, asset.captureFilePath);
    if (!committed) return false;
    if (entry.videoUrl && context.recordHlsPlaybackCaptureSegment) {
      context.recordHlsPlaybackCaptureSegment({
        videoUrl: entry.videoUrl,
        pageLoadId: entry.pageLoadId,
        filePath: asset.captureFilePath
      });
    }

    hlsPlaybackDebugLog(
      context,
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
      } catch (cancelError) {
        hlsPlaybackErrorLog(
          context,
          'capture-reader-cancel-failed',
          cancelError,
          hlsPlaybackCaptureLogDetails(entry, asset)
        );
      }
    }
    try {
      if (handle) await handle.close();
    } catch (closeError) {
      hlsPlaybackErrorLog(context, 'capture-file-close-failed', closeError, hlsPlaybackCaptureLogDetails(entry, asset));
    }
    try {
      await fs.promises.rm(tempPath, { force: true });
    } catch (removeError) {
      hlsPlaybackErrorLog(
        context,
        'capture-temp-remove-failed',
        removeError,
        hlsPlaybackCaptureLogDetails(entry, asset)
      );
    }
    hlsPlaybackDebugLog(
      context,
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
  body: ReadableStream<Uint8Array>,
  activeFiles: Map<string, Promise<boolean>>
): Promise<boolean> {
  if (!asset.captureFilePath) return Promise.resolve(false);
  if (hlsPlaybackCaptureFileExists(asset.captureFilePath)) return Promise.resolve(false);
  if (!hlsPlaybackCaptureCanContinue(context, entry)) return Promise.resolve(false);

  // Active writes are keyed by final path so playback and prefetch requests share
  // the same in-flight file instead of racing duplicate temp files.
  const active = activeFiles.get(asset.captureFilePath);
  if (active) return active;

  const promise = hlsPlaybackCaptureWriteStreamToFile(context, entry, asset, body);
  activeFiles.set(asset.captureFilePath, promise);
  return promise.finally(function () {
    if (asset.captureFilePath && activeFiles.get(asset.captureFilePath) === promise) {
      activeFiles.delete(asset.captureFilePath);
    }
  });
}

async function hlsPlaybackCaptureFetchAsset(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  asset: HlsPlaylistProxyAsset,
  activeFiles: Map<string, Promise<boolean>>,
  signal?: AbortSignal | null
): Promise<boolean> {
  if (!asset.captureFilePath) return false;
  if (hlsPlaybackCaptureFileExists(asset.captureFilePath)) return false;
  if (!hlsPlaybackCaptureCanContinue(context, entry, signal)) return false;

  // Prefetch uses the same activeFiles gate as streamed playback so the first
  // request to commit the segment wins regardless of source.
  const active = activeFiles.get(asset.captureFilePath);
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
        headers: hlsPlaylistProxyAssetFetchHeaders(
          entry,
          new Request(asset.sourceUrl),
          hlsPlaylistProxyUserAgent(context, entry)
        ),
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
        hlsPlaybackDebugLog(
          context,
          '[hls-capture] prefetch stopped',
          'host=' + asset.host,
          'pathHash=' + asset.pathHash,
          'tabId=' + String(entry.tabId)
        );
        return false;
      }
      hlsPlaybackDebugLog(
        context,
        '[hls-capture] prefetch failed',
        'host=' + asset.host,
        'pathHash=' + asset.pathHash,
        'tabId=' + String(entry.tabId),
        'error=' + mainErrorMessage(error)
      );
      hlsPlaybackErrorLog(context, 'capture-prefetch-failed', error, hlsPlaybackCaptureLogDetails(entry, asset));
      return false;
    } finally {
      if (signal) signal.removeEventListener('abort', abortFromSignal);
    }
  })();

  activeFiles.set(asset.captureFilePath, promise);
  return promise.finally(function () {
    if (asset.captureFilePath && activeFiles.get(asset.captureFilePath) === promise) {
      activeFiles.delete(asset.captureFilePath);
    }
  });
}

export async function hlsPlaylistProxyCapturedAssetResponse(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  asset: HlsPlaylistProxyAsset,
  request: Request,
  activeFiles: Map<string, Promise<boolean>>
): Promise<Response | null> {
  if (!asset.captureFilePath) return null;
  if (!hlsPlaybackCaptureCanContinue(context, entry)) return null;

  const cached = hlsPlaylistProxyCapturedAssetFileResponse(entry, asset, request);
  if (cached) return cached;
  if (request.method !== 'GET') return null;

  await hlsPlaybackCaptureFetchAsset(context, entry, asset, activeFiles);
  return hlsPlaylistProxyCapturedAssetFileResponse(entry, asset, request);
}

export function hlsPlaylistProxyAssetBody(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  asset: HlsPlaylistProxyAsset,
  body: ReadableStream<Uint8Array> | null,
  activeFiles: Map<string, Promise<boolean>>
): ReadableStream<Uint8Array> | null {
  if (
    !body ||
    !asset.captureFilePath ||
    !hlsPlaybackCaptureCanContinue(context, entry) ||
    hlsPlaybackCaptureFileExists(asset.captureFilePath) ||
    activeFiles.has(asset.captureFilePath)
  ) {
    return body;
  }

  // tee() lets Chromium keep consuming the original media response while the
  // second branch opportunistically writes a resumable segment.
  const streams = body.tee();
  writeHlsPlaybackCaptureStream(context, entry, asset, streams[1], activeFiles).catch(function (error) {
    hlsPlaybackDebugLog(
      context,
      '[hls-capture] segment unhandled',
      'host=' + asset.host,
      'pathHash=' + asset.pathHash,
      'tabId=' + String(entry.tabId),
      'error=' + mainErrorMessage(error)
    );
    hlsPlaybackErrorLog(context, 'capture-segment-unhandled', error, hlsPlaybackCaptureLogDetails(entry, asset));
  });
  return streams[0];
}

async function runHlsPlaybackCapturePrefetch(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  assets: HlsPlaylistProxyAsset[],
  activeFiles: Map<string, Promise<boolean>>,
  signal?: AbortSignal | null
) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < assets.length) {
      const asset = assets[nextIndex++];
      if (!hlsPlaybackCaptureCanContinue(context, entry, signal)) return;
      if (!asset || !asset.captureFilePath) continue;
      await hlsPlaybackCaptureFetchAsset(context, entry, asset, activeFiles, signal);
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
  activeFiles: Map<string, Promise<boolean>>,
  activePrefetches: Set<string>,
  signal?: AbortSignal | null
) {
  const key = String(entry.videoUrl || '') + '\n' + entry.playlistUrl;
  if (activePrefetches.has(key)) return;

  activePrefetches.add(key);
  try {
    await runHlsPlaybackCapturePrefetch(context, entry, assets, activeFiles, signal);
  } catch (error) {
    hlsPlaybackDebugLog(
      context,
      '[hls-capture] prefetch failed',
      'host=' + entry.host,
      'pathHash=' + entry.pathHash,
      'tabId=' + String(entry.tabId),
      'error=' + mainErrorMessage(error)
    );
    hlsPlaybackErrorLog(context, 'capture-prefetch-run-failed', error, {
      host: entry.host,
      pathHash: entry.pathHash,
      tabId: entry.tabId,
      videoUrl: entry.videoUrl
    });
  } finally {
    activePrefetches.delete(key);
    // Completion is tied to the playlist prefetch run, not individual segment
    // success, so normal download queueing can decide how to resume gaps.
    if (entry.videoUrl && context.completeHlsPlaybackCapture) {
      context.completeHlsPlaybackCapture({ videoUrl: entry.videoUrl, pageLoadId: entry.pageLoadId });
    }
  }
}

export function startHlsPlaybackCapturePrefetch(
  context: HlsPlaybackCaptureContext,
  entry: HlsPlaylistProxyToken,
  activeFiles: Map<string, Promise<boolean>>,
  activePrefetches: Set<string>
) {
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
        return runHlsPlaybackCapturePrefetchWithCompletion(
          context,
          entry,
          assets,
          activeFiles,
          activePrefetches,
          signal
        );
      }
    });
    return;
  }

  runHlsPlaybackCapturePrefetchWithCompletion(context, entry, assets, activeFiles, activePrefetches).catch(
    function (error) {
      hlsPlaybackDebugLog(
        context,
        '[hls-capture] prefetch failed',
        'host=' + entry.host,
        'pathHash=' + entry.pathHash,
        'tabId=' + String(entry.tabId),
        'error=' + mainErrorMessage(error)
      );
      hlsPlaybackErrorLog(context, 'capture-prefetch-unhandled', error, {
        host: entry.host,
        pathHash: entry.pathHash,
        tabId: entry.tabId,
        videoUrl: entry.videoUrl
      });
    }
  );
}
