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

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : null;
}

function warnRemovalFailure(message: string, error?: unknown) {
  const code = errorCode(error);
  console.warn(code ? message + ' (' + code + ')' : message);
}

function quarantineDirectoryPath(dirPath: string, attempt: number): string {
  const suffix =
    DELETE_SUFFIX_PREFIX + String(Date.now()) + '-' + String(process.pid) + (attempt > 0 ? '-' + String(attempt) : '');
  return path.join(path.dirname(dirPath), path.basename(dirPath) + suffix);
}

function moveDirectoryOutOfWay(dirPath: string): string | null {
  for (let attempt = 0; attempt < MAX_QUARANTINE_RENAME_ATTEMPTS; attempt++) {
    try {
      const deletionPath = quarantineDirectoryPath(dirPath, attempt);
      fs.renameSync(dirPath, deletionPath);
      return deletionPath;
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT') return null;
      if (code === 'EEXIST') continue;
      warnRemovalFailure('Unable to quarantine directory for removal', error);
      return null;
    }
  }

  warnRemovalFailure('Unable to choose quarantine path for directory removal');
  return null;
}

function removeDirectoryInDetachedProcess(dirPath: string) {
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
    warnRemovalFailure('Unable to start detached directory removal', error);
  }
}

function retryRemoveDirectoryInBackground(dirPath: string, attempt: number) {
  const delayMs = REMOVE_RETRY_DELAYS_MS[attempt];
  if (typeof delayMs !== 'number') {
    warnRemovalFailure('Unable to remove directory after cleanup retries');
    return;
  }

  const timer = setTimeout(function () {
    removeDirectoryInBackground(dirPath, attempt + 1);
  }, delayMs);
  timer.unref();
}

function removeDirectoryInBackground(dirPath: string, attempt = 0) {
  if (process.platform === 'win32') {
    removeDirectoryInDetachedProcess(dirPath);
    return;
  }

  fs.rm(dirPath, { recursive: true, force: true }, function (error) {
    if (error) {
      warnRemovalFailure('Unable to remove directory in background', error);
      retryRemoveDirectoryInBackground(dirPath, attempt);
    }
  });
}

function isQuarantinedDirectoryName(name: string): boolean {
  return DELETE_SUFFIX_PATTERN.test(name);
}

export function cleanupQuarantinedDirectories(rootPath: string) {
  let entries: NodeFs.Dirent[];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (error) {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isQuarantinedDirectoryName(entry.name)) continue;
    removeDirectoryInBackground(path.join(rootPath, entry.name));
  }
}

export function removeDirectoryAfterRename(dirPath: string) {
  const deletionPath = moveDirectoryOutOfWay(dirPath);
  if (!deletionPath) return;
  removeDirectoryInBackground(deletionPath);
}
