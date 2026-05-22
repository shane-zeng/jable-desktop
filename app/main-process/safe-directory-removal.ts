'use strict';

import type * as NodeChildProcess from 'node:child_process';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';

const childProcess: typeof NodeChildProcess = require('node:child_process');
const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

const DELETE_SUFFIX_PREFIX = '.delete-';
const DELETE_SUFFIX_PATTERN = /\.delete-\d+-\d+(?:-\d+)?$/;
const MAX_QUARANTINE_RENAME_ATTEMPTS = 10;
const REMOVE_RETRY_DELAYS_MS = [2000, 10000, 30000, 120000, 300000];
const WINDOWS_REMOVE_ATTEMPTS = 60;
const WINDOWS_REMOVE_RETRY_DELAY_SECONDS = 10;

type DirectoryQuarantineResult = { status: 'moved'; path: string } | { status: 'missing' } | { status: 'failed' };
export type DirectoryRemovalReportError = (event: string, error: unknown, details?: unknown) => void;

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : null;
}

function warnRemovalFailure(
  reportError: DirectoryRemovalReportError | null | undefined,
  event: string,
  message: string,
  error?: unknown
) {
  if (reportError) {
    reportError(event, error || new Error(message), { message: message });
    return;
  }

  const code = errorCode(error);
  console.warn(code ? message + ' (' + code + ')' : message);
}

function quarantineDirectoryPath(dirPath: string, attempt: number): string {
  const suffix =
    DELETE_SUFFIX_PREFIX + String(Date.now()) + '-' + String(process.pid) + (attempt > 0 ? '-' + String(attempt) : '');
  return path.join(path.dirname(dirPath), path.basename(dirPath) + suffix);
}

function moveDirectoryOutOfWay(
  dirPath: string,
  reportError?: DirectoryRemovalReportError | null
): DirectoryQuarantineResult {
  for (let attempt = 0; attempt < MAX_QUARANTINE_RENAME_ATTEMPTS; attempt++) {
    try {
      const deletionPath = quarantineDirectoryPath(dirPath, attempt);
      fs.renameSync(dirPath, deletionPath);
      return { status: 'moved', path: deletionPath };
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT') return { status: 'missing' };
      if (code === 'EEXIST') continue;
      warnRemovalFailure(
        reportError,
        'directory-quarantine-failed',
        'Unable to quarantine directory for removal',
        error
      );
      return { status: 'failed' };
    }
  }

  warnRemovalFailure(
    reportError,
    'directory-quarantine-path-exhausted',
    'Unable to choose quarantine path for directory removal'
  );
  return { status: 'failed' };
}

function removeDirectoryInDetachedProcess(dirPath: string, reportError?: DirectoryRemovalReportError | null) {
  const command = [
    '$path = $env:JABLE_DELETE_DIR',
    'for ($attempt = 0; $attempt -lt ' + String(WINDOWS_REMOVE_ATTEMPTS) + '; $attempt++) {',
    'Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue',
    'if (-not (Test-Path -LiteralPath $path)) { exit 0 }',
    'Start-Sleep -Seconds ' + String(WINDOWS_REMOVE_RETRY_DELAY_SECONDS),
    '}'
  ].join('; ');

  try {
    const child = childProcess.spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        detached: true,
        env: Object.assign({}, process.env, { JABLE_DELETE_DIR: dirPath }),
        stdio: 'ignore',
        windowsHide: true
      }
    );
    child.unref();
  } catch (error) {
    warnRemovalFailure(
      reportError,
      'detached-directory-removal-start-failed',
      'Unable to start detached directory removal',
      error
    );
  }
}

function retryRemoveDirectoryInBackground(
  dirPath: string,
  attempt: number,
  reportError?: DirectoryRemovalReportError | null
) {
  const delayMs = REMOVE_RETRY_DELAYS_MS[attempt];
  if (typeof delayMs !== 'number') {
    warnRemovalFailure(
      reportError,
      'directory-removal-retries-exhausted',
      'Unable to remove directory after cleanup retries'
    );
    return;
  }

  const timer = setTimeout(function () {
    removeDirectoryInBackground(dirPath, attempt + 1, reportError);
  }, delayMs);
  timer.unref();
}

function removeDirectoryInBackground(dirPath: string, attempt = 0, reportError?: DirectoryRemovalReportError | null) {
  if (process.platform === 'win32') {
    removeDirectoryInDetachedProcess(dirPath, reportError);
    return;
  }

  fs.rm(dirPath, { recursive: true, force: true }, function (error) {
    if (error) {
      warnRemovalFailure(reportError, 'directory-removal-failed', 'Unable to remove directory in background', error);
      retryRemoveDirectoryInBackground(dirPath, attempt, reportError);
    }
  });
}

function isQuarantinedDirectoryName(name: string): boolean {
  return DELETE_SUFFIX_PATTERN.test(name);
}

export function cleanupQuarantinedDirectories(rootPath: string, reportError?: DirectoryRemovalReportError | null) {
  let entries: NodeFs.Dirent[];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (error) {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isQuarantinedDirectoryName(entry.name)) continue;
    removeDirectoryInBackground(path.join(rootPath, entry.name), 0, reportError);
  }
}

export function removeDirectoryAfterRename(dirPath: string, reportError?: DirectoryRemovalReportError | null) {
  const result = moveDirectoryOutOfWay(dirPath, reportError);
  if (result.status === 'moved') {
    removeDirectoryInBackground(result.path, 0, reportError);
    return;
  }
  if (result.status === 'failed' && process.platform === 'win32') {
    removeDirectoryInBackground(dirPath, 0, reportError);
  }
}
