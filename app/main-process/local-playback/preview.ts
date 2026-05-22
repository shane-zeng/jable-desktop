'use strict';

import type * as NodeChildProcess from 'node:child_process';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type { DownloadRecord } from '../../types/jable';
import { FfmpegDownloadError, mainErrorMessage } from '../download/errors';
import { removeDirectoryAfterRename } from '../safe-directory-removal';

const childProcess: typeof NodeChildProcess = require('node:child_process');
const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

export type LocalPlaybackFile = {
  record: DownloadRecord;
  filePath: string;
  stats: NodeFs.Stats;
};

export type LocalPlaybackPreviewCue = {
  start: number;
  end: number;
  fileName: string;
};

export type LocalPlaybackPreviewMetadata = {
  version: 1;
  intervalSeconds: number;
  width: number;
  height: number;
  fileSizeBytes: number;
  mtimeMs: number;
  cues: LocalPlaybackPreviewCue[];
};

type LocalPlaybackPreviewControllerOptions = {
  ffmpegCommandForDownload(): Promise<string>;
  localPlaybackReadyFile(videoUrl: string): LocalPlaybackFile | null;
  localPlaybackScheme: string;
  notifyDownloadsChanged(): void;
  reportError?(event: string, error: unknown, details?: unknown): void;
  resolveManagedDownloadPath(fileRelativePath: string | null): string | null;
};

type ActivePreviewGeneration = {
  videoUrl: string;
  filePath: string;
  child: NodeChildProcess.ChildProcess | null;
  canceled: boolean;
};

export type LocalPlaybackPreviewController = {
  imageFilePath(file: LocalPlaybackFile, fileName: string): string;
  readMetadata(file: LocalPlaybackFile): LocalPlaybackPreviewMetadata | null;
  removeFiles(record: DownloadRecord): void;
  removeQueuedGeneration(videoUrl: string): void;
  scheduleGeneration(file: LocalPlaybackFile): void;
  vttText(metadata: LocalPlaybackPreviewMetadata): string;
  vttUrl(token: string): string;
};

const LOCAL_PLAYBACK_PREVIEW_INTERVAL_SECONDS = 60;
const LOCAL_PLAYBACK_PREVIEW_WIDTH = 213;
const LOCAL_PLAYBACK_PREVIEW_HEIGHT = 120;

export function createLocalPlaybackPreviewController(
  options: LocalPlaybackPreviewControllerOptions
): LocalPlaybackPreviewController {
  const previewQueue: string[] = [];
  const previewQueuedUrls = new Set<string>();
  const previewCanceledUrls = new Set<string>();
  const previewFailedKeys = new Set<string>();
  let activePreviewTask: Promise<void> | null = null;
  let activePreviewUrl: string | null = null;
  let activePreviewGeneration: ActivePreviewGeneration | null = null;

  function previewDirectory(outputPath: string): string {
    return outputPath + '.preview';
  }

  function previewTempDirectory(outputPath: string): string {
    return outputPath + '.preview.tmp';
  }

  function previewMetadataPath(previewDir: string): string {
    return path.join(previewDir, 'metadata.json');
  }

  function isPreviewImageFileName(value: string): boolean {
    return /^thumb-\d{6}\.jpg$/.test(value);
  }

  function removeDirectoryIfPresent(dirPath: string) {
    removeDirectoryAfterRename(dirPath);
  }

  function cancelActivePreviewGeneration(active: ActivePreviewGeneration) {
    active.canceled = true;
    if (active.child && !active.child.killed) active.child.kill('SIGTERM');
  }

  function removeFiles(record: DownloadRecord) {
    const outputPath = options.resolveManagedDownloadPath(record.localPath);
    if (!outputPath) return;
    removeDirectoryIfPresent(previewDirectory(outputPath));

    if (activePreviewGeneration && activePreviewGeneration.filePath === outputPath) {
      cancelActivePreviewGeneration(activePreviewGeneration);
      return;
    }

    removeDirectoryIfPresent(previewTempDirectory(outputPath));
  }

  function previewIdentity(file: LocalPlaybackFile) {
    return {
      fileSizeBytes: file.stats.size,
      mtimeMs: Math.trunc(file.stats.mtimeMs)
    };
  }

  function previewGenerationKey(file: LocalPlaybackFile): string {
    const identity = previewIdentity(file);
    return [file.record.videoUrl, file.filePath, identity.fileSizeBytes, identity.mtimeMs].join('\n');
  }

  function previewMetadataMatchesFile(metadata: LocalPlaybackPreviewMetadata, file: LocalPlaybackFile): boolean {
    const identity = previewIdentity(file);
    return metadata.fileSizeBytes === identity.fileSizeBytes && metadata.mtimeMs === identity.mtimeMs;
  }

  function localPlaybackFileMatchesPreviewSource(file: LocalPlaybackFile): boolean {
    const current = options.localPlaybackReadyFile(file.record.videoUrl);
    if (!current || current.filePath !== file.filePath) return false;

    const original = previewIdentity(file);
    const latest = previewIdentity(current);
    return original.fileSizeBytes === latest.fileSizeBytes && original.mtimeMs === latest.mtimeMs;
  }

  function normalizePreviewMetadata(value: unknown): LocalPlaybackPreviewMetadata | null {
    if (!value || typeof value !== 'object') return null;
    const metadata = value as Partial<LocalPlaybackPreviewMetadata>;
    if (metadata.version !== 1) return null;
    if (metadata.intervalSeconds !== LOCAL_PLAYBACK_PREVIEW_INTERVAL_SECONDS) return null;
    if (metadata.width !== LOCAL_PLAYBACK_PREVIEW_WIDTH || metadata.height !== LOCAL_PLAYBACK_PREVIEW_HEIGHT) {
      return null;
    }
    if (typeof metadata.fileSizeBytes !== 'number' || typeof metadata.mtimeMs !== 'number') return null;
    if (!Array.isArray(metadata.cues) || !metadata.cues.length) return null;

    const cues: LocalPlaybackPreviewCue[] = [];
    for (const cue of metadata.cues) {
      if (!cue || typeof cue !== 'object') return null;
      const candidate = cue as Partial<LocalPlaybackPreviewCue>;
      if (typeof candidate.start !== 'number' || typeof candidate.end !== 'number') return null;
      if (typeof candidate.fileName !== 'string' || !isPreviewImageFileName(candidate.fileName)) return null;
      if (candidate.start < 0 || candidate.end <= candidate.start) return null;
      cues.push({
        start: candidate.start,
        end: candidate.end,
        fileName: candidate.fileName
      });
    }

    return {
      version: 1,
      intervalSeconds: metadata.intervalSeconds,
      width: metadata.width,
      height: metadata.height,
      fileSizeBytes: metadata.fileSizeBytes,
      mtimeMs: Math.trunc(metadata.mtimeMs),
      cues: cues
    };
  }

  function readMetadata(file: LocalPlaybackFile): LocalPlaybackPreviewMetadata | null {
    let metadata: LocalPlaybackPreviewMetadata | null;
    const previewDir = previewDirectory(file.filePath);

    try {
      metadata = normalizePreviewMetadata(JSON.parse(fs.readFileSync(previewMetadataPath(previewDir), 'utf8')));
    } catch (error) {
      return null;
    }

    if (!metadata || !previewMetadataMatchesFile(metadata, file)) return null;

    try {
      for (const cue of metadata.cues) {
        if (!fs.statSync(path.join(previewDir, cue.fileName)).isFile()) return null;
      }
    } catch (error) {
      return null;
    }

    return metadata;
  }

  function formatVttTimestamp(seconds: number): string {
    const safeSeconds = Math.max(0, seconds);
    const wholeSeconds = Math.floor(safeSeconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainingSeconds = wholeSeconds % 60;

    return (
      String(hours).padStart(2, '0') +
      ':' +
      String(minutes).padStart(2, '0') +
      ':' +
      String(remainingSeconds).padStart(2, '0') +
      '.000'
    );
  }

  function vttText(metadata: LocalPlaybackPreviewMetadata): string {
    const lines = ['WEBVTT', ''];
    for (const cue of metadata.cues) {
      lines.push(formatVttTimestamp(cue.start) + ' --> ' + formatVttTimestamp(cue.end));
      lines.push(cue.fileName);
      lines.push('');
    }
    return lines.join('\n');
  }

  function vttUrl(token: string): string {
    return options.localPlaybackScheme + '://thumb/' + token + '/thumb.vtt';
  }

  function metadataForFiles(file: LocalPlaybackFile, fileNames: string[]): LocalPlaybackPreviewMetadata {
    const identity = previewIdentity(file);
    return {
      version: 1,
      intervalSeconds: LOCAL_PLAYBACK_PREVIEW_INTERVAL_SECONDS,
      width: LOCAL_PLAYBACK_PREVIEW_WIDTH,
      height: LOCAL_PLAYBACK_PREVIEW_HEIGHT,
      fileSizeBytes: identity.fileSizeBytes,
      mtimeMs: identity.mtimeMs,
      cues: fileNames.map(function (fileName, index) {
        const start = index * LOCAL_PLAYBACK_PREVIEW_INTERVAL_SECONDS;
        return {
          start: start,
          end: start + LOCAL_PLAYBACK_PREVIEW_INTERVAL_SECONDS,
          fileName: fileName
        };
      })
    };
  }

  function generatedPreviewFiles(tempDir: string): string[] {
    let entries: string[];
    try {
      entries = fs.readdirSync(tempDir);
    } catch (error) {
      return [];
    }

    return entries.filter(isPreviewImageFileName).sort();
  }

  function writeMetadata(file: LocalPlaybackFile, tempDir: string, fileNames: string[]) {
    const metadata = metadataForFiles(file, fileNames);
    fs.writeFileSync(previewMetadataPath(tempDir), JSON.stringify(metadata, null, 2));
  }

  function generateFiles(command: string, file: LocalPlaybackFile): Promise<boolean> {
    return new Promise(function (resolve, reject) {
      const tempDir = previewTempDirectory(file.filePath);
      const previewDir = previewDirectory(file.filePath);
      removeDirectoryIfPresent(tempDir);
      fs.mkdirSync(tempDir, { recursive: true });
      const activeGeneration: ActivePreviewGeneration = {
        videoUrl: file.record.videoUrl,
        filePath: file.filePath,
        child: null,
        canceled: false
      };

      const child = childProcess.spawn(
        command,
        [
          '-y',
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-threads',
          '1',
          '-i',
          file.filePath,
          '-vf',
          'fps=1/' +
            LOCAL_PLAYBACK_PREVIEW_INTERVAL_SECONDS +
            ',scale=' +
            LOCAL_PLAYBACK_PREVIEW_WIDTH +
            ':' +
            LOCAL_PLAYBACK_PREVIEW_HEIGHT +
            ':force_original_aspect_ratio=decrease:force_divisible_by=2,pad=' +
            LOCAL_PLAYBACK_PREVIEW_WIDTH +
            ':' +
            LOCAL_PLAYBACK_PREVIEW_HEIGHT +
            ':(ow-iw)/2:(oh-ih)/2',
          '-q:v',
          '5',
          path.join(tempDir, 'thumb-%06d.jpg')
        ],
        {
          windowsHide: true
        }
      );
      activeGeneration.child = child;
      activePreviewGeneration = activeGeneration;
      let stderr = '';

      function finishActiveGeneration() {
        if (activePreviewGeneration === activeGeneration) activePreviewGeneration = null;
      }

      child.stderr.on('data', function (chunk) {
        stderr = (stderr + String(chunk)).slice(-4000);
      });
      child.on('error', function (error) {
        removeDirectoryIfPresent(tempDir);
        finishActiveGeneration();
        if (activeGeneration.canceled) {
          resolve(false);
          return;
        }
        reject(new FfmpegDownloadError(mainErrorMessage(error)));
      });
      child.on('close', function (code) {
        finishActiveGeneration();
        if (activeGeneration.canceled) {
          removeDirectoryIfPresent(tempDir);
          resolve(false);
          return;
        }

        if (code !== 0) {
          removeDirectoryIfPresent(tempDir);
          reject(new FfmpegDownloadError(stderr.trim() || 'FFmpeg exited with code ' + code));
          return;
        }

        try {
          const fileNames = generatedPreviewFiles(tempDir);
          if (!fileNames.length) throw new FfmpegDownloadError('FFmpeg did not generate playback preview thumbnails');
          if (!localPlaybackFileMatchesPreviewSource(file)) {
            removeDirectoryIfPresent(tempDir);
            resolve(false);
            return;
          }

          writeMetadata(file, tempDir, fileNames);
          removeDirectoryIfPresent(previewDir);
          fs.renameSync(tempDir, previewDir);
          resolve(true);
        } catch (error) {
          removeDirectoryIfPresent(tempDir);
          reject(error);
        }
      });
    });
  }

  function fileLooksLikeMp4(filePath: string): boolean {
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const header = Buffer.alloc(32);
        const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
        return header.subarray(0, bytesRead).includes(Buffer.from('ftyp'));
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      return false;
    }
  }

  async function runGeneration(videoUrl: string): Promise<void> {
    if (previewCanceledUrls.has(videoUrl)) return;

    const readyFile = options.localPlaybackReadyFile(videoUrl);
    if (!readyFile || readMetadata(readyFile)) return;
    if (!fileLooksLikeMp4(readyFile.filePath)) return;

    const generationKey = previewGenerationKey(readyFile);
    if (previewFailedKeys.has(generationKey)) return;

    try {
      const command = await options.ffmpegCommandForDownload();
      if (previewCanceledUrls.has(videoUrl)) return;

      const generated = await generateFiles(command, readyFile);
      if (generated) {
        previewFailedKeys.delete(generationKey);
        options.notifyDownloadsChanged();
      }
    } catch (error) {
      previewFailedKeys.add(generationKey);
      if (options.reportError) {
        options.reportError('local-playback-preview-generation-failed', error, {
          videoUrl: videoUrl
        });
      }
      console.warn('[local-playback-preview] ' + mainErrorMessage(error));
    }
  }

  function processQueue() {
    if (activePreviewTask) return;

    const videoUrl = previewQueue.shift();
    if (!videoUrl) return;

    activePreviewUrl = videoUrl;
    activePreviewTask = runGeneration(videoUrl).finally(function () {
      previewCanceledUrls.delete(videoUrl);
      previewQueuedUrls.delete(videoUrl);
      if (activePreviewUrl === videoUrl) activePreviewUrl = null;
      activePreviewTask = null;
      processQueue();
    });
  }

  function scheduleGeneration(file: LocalPlaybackFile) {
    const videoUrl = file.record.videoUrl;
    if (previewQueuedUrls.has(videoUrl)) return;
    if (!fileLooksLikeMp4(file.filePath)) return;
    if (previewFailedKeys.has(previewGenerationKey(file))) return;

    previewQueuedUrls.add(videoUrl);
    previewQueue.push(videoUrl);
    processQueue();
  }

  function removeQueuedGeneration(videoUrl: string) {
    const queueIndex = previewQueue.indexOf(videoUrl);
    if (queueIndex !== -1) previewQueue.splice(queueIndex, 1);
    if (activePreviewUrl === videoUrl) previewCanceledUrls.add(videoUrl);
    if (queueIndex !== -1 || !activePreviewTask) previewQueuedUrls.delete(videoUrl);
    if (activePreviewGeneration && activePreviewGeneration.videoUrl === videoUrl) {
      cancelActivePreviewGeneration(activePreviewGeneration);
    }

    for (const key of previewFailedKeys) {
      if (key.startsWith(videoUrl + '\n')) previewFailedKeys.delete(key);
    }
  }

  function imageFilePath(file: LocalPlaybackFile, fileName: string): string {
    return path.join(previewDirectory(file.filePath), fileName);
  }

  return {
    imageFilePath: imageFilePath,
    readMetadata: readMetadata,
    removeFiles: removeFiles,
    removeQueuedGeneration: removeQueuedGeneration,
    scheduleGeneration: scheduleGeneration,
    vttText: vttText,
    vttUrl: vttUrl
  };
}
