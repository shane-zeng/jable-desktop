'use strict';

import type * as NodeCrypto from 'node:crypto';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';

const nodeCrypto: typeof NodeCrypto = require('node:crypto');
const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

export const DIAGNOSTICS_LOG_RETENTION_DAYS = 14;
export const DIAGNOSTICS_LOG_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const DIAGNOSTICS_LOG_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
export const DIAGNOSTICS_CRASH_DUMP_MAX_FILES = 10;
export const DIAGNOSTICS_LOG_DIRECTORY_NAME = 'logs';
export const DIAGNOSTICS_CRASH_DIRECTORY_NAME = 'crashes';

type DiagnosticsLevel = 'debug' | 'info' | 'warn' | 'error';
type PathToken = { label: string; value: string | null | undefined };

export type DiagnosticsClearResult = {
  canceled: boolean;
  deletedFiles: number;
  failedFiles: number;
};

export type DiagnosticsLogEntry = {
  ts: string;
  level: DiagnosticsLevel;
  process: string;
  domain: string;
  event: string;
  sessionId: string;
  message?: string;
  details?: unknown;
};

export type DiagnosticsLogger = {
  debug(message?: unknown, ...optionalParams: unknown[]): void;
  info(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
  event(level: DiagnosticsLevel, domain: string, event: string, details?: unknown): void;
  errorEvent(domain: string, event: string, error: unknown, details?: unknown): void;
  clearDiagnostics(): DiagnosticsClearResult;
  logDirectory(): string;
  crashDumpsDirectory(): string;
  prune(): void;
  sanitize(value: unknown): unknown;
  sanitizeError(error: unknown): unknown;
};

export type DiagnosticsLoggerOptions = {
  appVersion?: string | null;
  crashDumpsDirectory?: string | null;
  fileMaxBytes?: number;
  now?: () => Date;
  pathTokens?: () => PathToken[];
  processName?: string;
  retentionDays?: number;
  sessionId?: string;
  totalMaxBytes?: number;
  crashDumpMaxFiles?: number;
};

type ManagedFile = {
  filePath: string;
  mtimeMs: number;
  size: number;
};

const SENSITIVE_KEY_PATTERN =
  /cookie|authorization|password|passwd|secret|token|session|headers?|playlist|segment|key/i;
const HTTP_URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /\b[A-Za-z]:\\[^\n\r"'<>|]+/g;
const POSIX_HOME_PATH_PATTERN = /\/Users\/[^/\s"'<>]+|\/home\/[^/\s"'<>]+/g;
const MANAGED_LOG_FILE_PATTERN = /^app-\d{4}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function boundedPositiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function isoDateForFile(date: Date) {
  return date.toISOString().slice(0, 10);
}

function sha256Short(value: string): string {
  return nodeCrypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function safeStat(filePath: string): NodeFs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    return null;
  }
}

function directoryEntries(directoryPath: string): string[] {
  try {
    return fs.readdirSync(directoryPath);
  } catch (error) {
    return [];
  }
}

function ensureDirectory(directoryPath: string) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function diagnosticsFallbackConsole(level: DiagnosticsLevel, message: string, error?: unknown) {
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  try {
    target('[diagnostics] ' + message, error || '');
  } catch (consoleError) {}
}

function normalizedPathForCompare(value: string) {
  return process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const target = normalizedPathForCompare(filePath);
  const root = normalizedPathForCompare(directoryPath);
  return target === root || target.startsWith(root + path.sep);
}

function sanitizedUrlText(value: string): string {
  try {
    const parsed = new URL(value);
    return '[remote URL host=' + parsed.hostname + ' hash=' + sha256Short(parsed.href) + ']';
  } catch (error) {
    return '[remote URL hash=' + sha256Short(value) + ']';
  }
}

function pathTokenPatterns(tokenValue: string): string[] {
  const resolved = path.resolve(tokenValue);
  const patterns = [resolved];
  const winLike = resolved.replace(/\//g, '\\');
  const posixLike = resolved.replace(/\\/g, '/');
  if (patterns.indexOf(winLike) === -1) patterns.push(winLike);
  if (patterns.indexOf(posixLike) === -1) patterns.push(posixLike);
  return patterns.filter(Boolean).sort(function (a, b) {
    return b.length - a.length;
  });
}

function replaceAllLiteral(value: string, needle: string, replacement: string): string {
  if (!needle) return value;
  return value.split(needle).join(replacement);
}

function safeJsonStringify(value: unknown): string {
  const seen = new Set<unknown>();

  return JSON.stringify(value, function (_key, item) {
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return '[Circular]';
    seen.add(item);
    return item;
  });
}

export function diagnosticsLogDirectory(userDataPath: string) {
  return path.join(userDataPath, DIAGNOSTICS_LOG_DIRECTORY_NAME);
}

export function diagnosticsCrashDumpsDirectory(logDirectory: string) {
  return path.join(logDirectory, DIAGNOSTICS_CRASH_DIRECTORY_NAME);
}

export function createDiagnosticsLogger(
  logDirectory: string,
  options?: DiagnosticsLoggerOptions | null
): DiagnosticsLogger {
  const normalizedOptions = options || {};
  const crashDumpsDirectory =
    typeof normalizedOptions.crashDumpsDirectory === 'string' && normalizedOptions.crashDumpsDirectory
      ? normalizedOptions.crashDumpsDirectory
      : diagnosticsCrashDumpsDirectory(logDirectory);
  const sessionId = normalizedOptions.sessionId || nodeCrypto.randomUUID();
  const processName = normalizedOptions.processName || 'main';
  const fileMaxBytes = boundedPositiveInteger(normalizedOptions.fileMaxBytes, DIAGNOSTICS_LOG_FILE_MAX_BYTES);
  const totalMaxBytes = boundedPositiveInteger(normalizedOptions.totalMaxBytes, DIAGNOSTICS_LOG_TOTAL_MAX_BYTES);
  const retentionDays = boundedPositiveInteger(normalizedOptions.retentionDays, DIAGNOSTICS_LOG_RETENTION_DAYS);
  const crashDumpMaxFiles = boundedPositiveInteger(
    normalizedOptions.crashDumpMaxFiles,
    DIAGNOSTICS_CRASH_DUMP_MAX_FILES
  );
  const now =
    normalizedOptions.now ||
    function () {
      return new Date();
    };

  let writing = false;

  function pathTokens(): PathToken[] {
    const tokens = typeof normalizedOptions.pathTokens === 'function' ? normalizedOptions.pathTokens() : [];
    return tokens
      .concat([
        { label: 'logs', value: logDirectory },
        { label: 'crashDumps', value: crashDumpsDirectory }
      ])
      .filter(function (token) {
        return Boolean(token && token.label && token.value);
      });
  }

  function redactText(value: string): string {
    let out = value.replace(HTTP_URL_PATTERN, function (match) {
      return sanitizedUrlText(match);
    });

    const tokens = pathTokens().sort(function (a, b) {
      return String(b.value || '').length - String(a.value || '').length;
    });
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      for (const pattern of pathTokenPatterns(String(token.value || ''))) {
        out = replaceAllLiteral(out, pattern, '[' + token.label + ']');
      }
    }

    out = out.replace(WINDOWS_ABSOLUTE_PATH_PATTERN, '[local path]');
    out = out.replace(POSIX_HOME_PATH_PATTERN, '[home]');
    return out;
  }

  function sanitize(value: unknown, depth = 0, seen?: Set<unknown>): unknown {
    if (typeof value === 'string') return redactText(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || typeof value === 'undefined') {
      return value;
    }
    if (value instanceof Error) return sanitizeError(value);
    if (depth >= 5) return '[MaxDepth]';

    const localSeen = seen || new Set<unknown>();
    if (typeof value === 'object') {
      if (localSeen.has(value)) return '[Circular]';
      localSeen.add(value);
    }

    if (Array.isArray(value)) {
      return value.slice(0, 50).map(function (item) {
        return sanitize(item, depth + 1, localSeen);
      });
    }

    if (!isRecord(value)) return redactText(String(value));

    const out: Record<string, unknown> = {};
    const keys = Object.keys(value).slice(0, 50);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitize(value[key], depth + 1, localSeen);
    }
    return out;
  }

  function sanitizeError(error: unknown): unknown {
    if (!(error instanceof Error)) {
      return {
        message: redactText(String(error))
      };
    }

    return {
      name: redactText(error.name || 'Error'),
      message: redactText(error.message || ''),
      stack: error.stack ? redactText(error.stack) : null
    };
  }

  function managedLogFiles(): ManagedFile[] {
    return directoryEntries(logDirectory)
      .filter(function (name) {
        return MANAGED_LOG_FILE_PATTERN.test(name);
      })
      .map(function (name) {
        const filePath = path.join(logDirectory, name);
        const stat = safeStat(filePath);
        return stat && stat.isFile() ? { filePath: filePath, mtimeMs: stat.mtimeMs, size: stat.size } : null;
      })
      .filter(Boolean) as ManagedFile[];
  }

  function crashDumpFiles(): ManagedFile[] {
    return directoryEntries(crashDumpsDirectory)
      .map(function (name) {
        const filePath = path.join(crashDumpsDirectory, name);
        if (!isInsideDirectory(filePath, crashDumpsDirectory)) return null;
        const stat = safeStat(filePath);
        return stat && stat.isFile() ? { filePath: filePath, mtimeMs: stat.mtimeMs, size: stat.size } : null;
      })
      .filter(Boolean) as ManagedFile[];
  }

  function deleteManagedFile(filePath: string): boolean {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  function pruneByAge() {
    const cutoff = now().getTime() - retentionDays * 24 * 60 * 60 * 1000;
    for (const file of managedLogFiles()) {
      if (file.mtimeMs < cutoff) deleteManagedFile(file.filePath);
    }
  }

  function pruneByTotalSize() {
    const files = managedLogFiles().sort(function (a, b) {
      return a.mtimeMs - b.mtimeMs;
    });
    let total = files.reduce(function (sum, file) {
      return sum + file.size;
    }, 0);

    for (let i = 0; i < files.length && total > totalMaxBytes; i++) {
      if (deleteManagedFile(files[i].filePath)) total -= files[i].size;
    }
  }

  function pruneCrashDumps() {
    const files = crashDumpFiles().sort(function (a, b) {
      return b.mtimeMs - a.mtimeMs;
    });

    for (let i = crashDumpMaxFiles; i < files.length; i++) {
      deleteManagedFile(files[i].filePath);
    }
  }

  function prune() {
    try {
      ensureDirectory(logDirectory);
      ensureDirectory(crashDumpsDirectory);
      pruneByAge();
      pruneByTotalSize();
      pruneCrashDumps();
    } catch (error) {
      diagnosticsFallbackConsole('warn', 'prune failed', error);
    }
  }

  function logFilePathForEntry(lineBytes: number): string {
    const date = isoDateForFile(now());
    let sequence = 1;

    while (sequence < 10000) {
      const filename = sequence === 1 ? 'app-' + date + '.jsonl' : 'app-' + date + '-' + sequence + '.jsonl';
      const filePath = path.join(logDirectory, filename);
      const stat = safeStat(filePath);
      if (!stat || !stat.isFile() || stat.size + lineBytes <= fileMaxBytes) return filePath;
      sequence++;
    }

    return path.join(logDirectory, 'app-' + date + '-' + sequence + '.jsonl');
  }

  function writeEntry(entry: DiagnosticsLogEntry) {
    if (writing) return;

    writing = true;
    try {
      ensureDirectory(logDirectory);
      ensureDirectory(crashDumpsDirectory);
      const line = safeJsonStringify(entry) + '\n';
      fs.appendFileSync(logFilePathForEntry(Buffer.byteLength(line, 'utf8')), line, 'utf8');
    } catch (error) {
      diagnosticsFallbackConsole(entry.level, 'write failed', error);
    } finally {
      writing = false;
    }
  }

  function event(level: DiagnosticsLevel, domain: string, name: string, details?: unknown) {
    const sanitizedDetails = typeof details === 'undefined' ? undefined : sanitize(details);
    const message =
      typeof sanitizedDetails === 'string'
        ? sanitizedDetails
        : isRecord(sanitizedDetails) && typeof sanitizedDetails.message === 'string'
          ? sanitizedDetails.message
          : undefined;

    writeEntry({
      ts: now().toISOString(),
      level: level,
      process: processName,
      domain: domain,
      event: name,
      sessionId: sessionId,
      message: message,
      details: sanitizedDetails
    });
  }

  function consoleEvent(level: DiagnosticsLevel, message?: unknown, optionalParams?: unknown[]) {
    const details = {
      message: message,
      params: optionalParams && optionalParams.length ? optionalParams : undefined
    };
    event(level, 'console', 'console.' + level, details);
  }

  function errorEvent(domain: string, name: string, error: unknown, details?: unknown) {
    event('error', domain, name, {
      error: sanitizeError(error),
      details: typeof details === 'undefined' ? undefined : details
    });
  }

  function clearDiagnostics(): DiagnosticsClearResult {
    let deletedFiles = 0;
    let failedFiles = 0;
    const files = managedLogFiles().concat(crashDumpFiles());

    for (let i = 0; i < files.length; i++) {
      if (deleteManagedFile(files[i].filePath)) deletedFiles++;
      else failedFiles++;
    }

    return {
      canceled: false,
      deletedFiles: deletedFiles,
      failedFiles: failedFiles
    };
  }

  prune();

  return {
    debug: function (message?: unknown, ...optionalParams: unknown[]) {
      consoleEvent('debug', message, optionalParams);
    },
    info: function (message?: unknown, ...optionalParams: unknown[]) {
      consoleEvent('info', message, optionalParams);
    },
    warn: function (message?: unknown, ...optionalParams: unknown[]) {
      consoleEvent('warn', message, optionalParams);
    },
    error: function (message?: unknown, ...optionalParams: unknown[]) {
      consoleEvent('error', message, optionalParams);
    },
    event: event,
    errorEvent: errorEvent,
    clearDiagnostics: clearDiagnostics,
    logDirectory: function () {
      return logDirectory;
    },
    crashDumpsDirectory: function () {
      return crashDumpsDirectory;
    },
    prune: prune,
    sanitize: function (value: unknown) {
      return sanitize(value);
    },
    sanitizeError: sanitizeError
  };
}
