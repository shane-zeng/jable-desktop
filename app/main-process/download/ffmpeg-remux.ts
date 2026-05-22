'use strict';

import type * as NodeChildProcess from 'node:child_process';
import type * as NodeFs from 'node:fs';
import { DownloadCanceledError, FfmpegDownloadError, mainErrorMessage } from './errors';

export type FfmpegRemuxRuntime = {
  process: NodeChildProcess.ChildProcess | null;
};

type FfmpegRemuxOptions = {
  downloadCanceledError(): Error;
  downloadFileSystemError(error: unknown): Error;
  downloadPausedError(): Error;
  isCanceled(videoUrl: string): boolean;
  isPaused(videoUrl: string): boolean;
  reportError?(event: string, error: unknown, details?: unknown): void;
  throwIfDownloadCanceled(videoUrl: string): void;
  updateDownloadRuntimeProgress(videoUrl: string, downloadedBytes: number): void;
};

const childProcess: typeof NodeChildProcess = require('node:child_process');
const fs: typeof NodeFs = require('node:fs');

function shouldRunCommandThroughShell(command: string): boolean {
  return process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(command);
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : null;
}

function reportFfmpegError(
  reportError: FfmpegRemuxOptions['reportError'],
  event: string,
  error: unknown,
  details?: unknown
) {
  if (!reportError) return;
  try {
    reportError(event, error, details);
  } catch {}
}

function removePartialDownloadFile(
  outputPath: string,
  videoUrl: string,
  reportError?: FfmpegRemuxOptions['reportError']
) {
  try {
    fs.unlinkSync(outputPath + '.part');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    reportFfmpegError(reportError, 'ffmpeg-partial-remove-failed', error, {
      videoUrl: videoUrl
    });
  }
}

function handleFfmpegProgressLine(
  videoUrl: string,
  line: string,
  updateDownloadRuntimeProgress: FfmpegRemuxOptions['updateDownloadRuntimeProgress']
) {
  const separatorIndex = line.indexOf('=');
  if (separatorIndex === -1) return;

  const key = line.slice(0, separatorIndex);
  if (key !== 'total_size') return;

  const downloadedBytes = Number(line.slice(separatorIndex + 1));
  updateDownloadRuntimeProgress(videoUrl, downloadedBytes);
}

function handleFfmpegProgressChunk(
  videoUrl: string,
  chunk: Buffer,
  readRemainder: () => string,
  writeRemainder: (value: string) => void,
  updateDownloadRuntimeProgress: FfmpegRemuxOptions['updateDownloadRuntimeProgress']
) {
  const text = readRemainder() + String(chunk);
  const lines = text.split(/\r?\n/);
  writeRemainder(lines.pop() || '');

  for (const line of lines) {
    handleFfmpegProgressLine(videoUrl, line, updateDownloadRuntimeProgress);
  }
}

export function runFfmpegRemux(
  command: string,
  inputPlaylistPath: string,
  videoUrl: string,
  outputPath: string,
  runtime: FfmpegRemuxRuntime,
  options: FfmpegRemuxOptions
): Promise<void> {
  return new Promise(function (resolve, reject) {
    const tempPath = outputPath + '.part';
    let progressRemainder = '';
    try {
      fs.unlinkSync(tempPath);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        reportFfmpegError(options.reportError, 'ffmpeg-stale-partial-remove-failed', error, {
          videoUrl: videoUrl
        });
      }
    }

    try {
      options.throwIfDownloadCanceled(videoUrl);
    } catch (error) {
      reject(error);
      return;
    }

    const child = childProcess.spawn(
      command,
      [
        '-y',
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-progress',
        'pipe:1',
        '-allowed_extensions',
        'ALL',
        '-protocol_whitelist',
        'file,crypto',
        '-i',
        inputPlaylistPath,
        '-c',
        'copy',
        '-bsf:a',
        'aac_adtstoasc',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        tempPath
      ],
      {
        shell: shouldRunCommandThroughShell(command),
        windowsHide: true
      }
    );
    let stderr = '';

    runtime.process = child;
    child.stdout?.on('data', function (chunk: Buffer) {
      handleFfmpegProgressChunk(
        videoUrl,
        chunk,
        function () {
          return progressRemainder;
        },
        function (value) {
          progressRemainder = value;
        },
        options.updateDownloadRuntimeProgress
      );
    });
    child.stderr.on('data', function (chunk) {
      stderr = (stderr + String(chunk)).slice(-4000);
    });
    child.on('error', function (error) {
      if (runtime.process === child) runtime.process = null;
      reject(new FfmpegDownloadError(mainErrorMessage(error)));
    });
    child.on('close', function (code) {
      if (runtime.process === child) runtime.process = null;

      if (options.isPaused(videoUrl)) {
        removePartialDownloadFile(outputPath, videoUrl, options.reportError);
        reject(options.downloadPausedError());
        return;
      }

      if (options.isCanceled(videoUrl)) {
        removePartialDownloadFile(outputPath, videoUrl, options.reportError);
        reject(options.downloadCanceledError());
        return;
      }

      if (code !== 0) {
        removePartialDownloadFile(outputPath, videoUrl, options.reportError);
        reject(new FfmpegDownloadError(stderr.trim() || 'FFmpeg exited with code ' + code));
        return;
      }

      try {
        options.throwIfDownloadCanceled(videoUrl);
        fs.renameSync(tempPath, outputPath);
        resolve();
      } catch (error) {
        reject(error instanceof DownloadCanceledError ? error : options.downloadFileSystemError(error));
      }
    });
  });
}
