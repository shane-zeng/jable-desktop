'use strict';

import type * as Electron from 'electron';
import type * as NodeChildProcess from 'node:child_process';
import type * as NodeCrypto from 'node:crypto';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type * as NodeStream from 'node:stream';
import type { NativeDownloadEngineModule } from '../download/native-download-engine';
import type {
  AppSettings,
  AppSettingsPatch,
  BulkDownloadActionResult,
  CancelDownloadResult,
  DeleteDownloadResult,
  DeleteDownloadsResult,
  DownloadRecord,
  DownloadRecordPatch,
  DownloadRequestPayload,
  DownloadRootInfo,
  DownloadRootSelectionResult,
  DownloadSpeedMode,
  EnqueueDownloadResult,
  FfmpegPathSelectionResult,
  FfmpegStatus,
  LocalPlaybackSourceResult,
  LocalPlaybackUnavailableReason,
  OpenDownloadFileResult,
  PauseDownloadResult,
  RevealDownloadFileResult
} from '../types/jable';
import {
  DownloadCanceledError,
  DownloadFileSystemError,
  DownloadHttpError,
  DownloadPausedError,
  DownloadSegmentError,
  FfmpegDownloadError,
  HlsPlaylistNotFoundError,
  HlsPlaylistUnsupportedError,
  downloadErrorMessage as formatDownloadErrorMessage,
  downloadFailureCode,
  isDownloadPausedError,
  isSegmentRefreshCandidate,
  mainErrorMessage,
  sanitizeDownloadErrorDetail
} from './download-errors';
import { normalizeCollectionKey, requiredRecord, requiredStringValue } from './ipc-normalizers';
import { parseLocalPlaybackRangeHeader } from './local-playback';

export {
  downloadFailureCode,
  downloadHttpStatusFromMessage,
  isSegmentRefreshCandidate,
  sanitizeDownloadErrorDetail
} from './download-errors';
export { parseLocalPlaybackRangeHeader } from './local-playback';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type DownloadRuntimeProgress = {
  downloadedBytes: number | null;
  downloadSpeedBytesPerSecond: number | null;
  lastBytes: number | null;
  lastSampledAt: number | null;
  lastNotifiedAt: number | null;
};
type ActiveDownloadRuntime = {
  abortController: AbortController;
  process: NodeChildProcess.ChildProcess | null;
  nativeId: string | null;
};
type DownloadFailurePhase = 'ffmpeg_check' | 'video_page' | 'playlist' | 'segments' | 'remux' | 'file';
type HlsKey = {
  method: string;
  uri: string | null;
  iv: string | null;
};
type HlsSegment = {
  url: string;
  duration: number | null;
  key: HlsKey | null;
};
type HlsPlaylist = {
  variants: Array<{ url: string; bandwidth: number | null }>;
  segments: HlsSegment[];
  targetDuration: number | null;
};
type DownloadHelpersModule = {
  extractHlsPlaylistUrl(html: string, pageUrl: string): string | null;
  parseHlsPlaylist(content: string, playlistUrl: string): HlsPlaylist;
  videoPageRequestHeaders(videoUrl: string, cookieHeader: string): Record<string, string>;
  hlsRequestHeaders(videoUrl: string, cookieHeader: string): Record<string, string>;
};
type NativeDownloadEngineInstance = InstanceType<NativeDownloadEngineModule['JableDownloadEngine']>;
type NativeDownloadSegmentsResult = {
  playlistPath: string;
  downloadedBytes: number;
};
type DownloadDataStore = {
  listDownloadAssets(): DownloadRecord[];
  getDownloadAsset(videoUrl: string): DownloadRecord | null;
  upsertDownloadAsset(patch: DownloadRecordPatch): DownloadRecord;
  removeDownloadAsset(videoUrl: string): boolean;
};
type LocalPlaybackFile = {
  record: DownloadRecord;
  filePath: string;
  stats: NodeFs.Stats;
};
type LocalPlaybackResponseBody = ConstructorParameters<typeof Response>[0];
type LocalPlaybackResponseHeaders = NonNullable<ConstructorParameters<typeof Response>[1]>['headers'];

export type DownloadManagerContext = {
  app: Electron.App;
  dialog: typeof Electron.dialog;
  getAppSettings(): AppSettings;
  getDatabase(): DownloadDataStore;
  getMainWindow(): Electron.BrowserWindow | null;
  forwardBrowserMessage(channel: string, payload: unknown): void;
  sendToAllBrowserTabs(channel: string, payload: unknown): void;
  session: typeof Electron.session;
  shell: typeof Electron.shell;
  showAppDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue>;
  t(key: string, params?: TranslationParams | null): string;
  updateAppSettings(patch: AppSettingsPatch): AppSettings;
};

export type DownloadManager = {
  cancelDownload(value: unknown): CancelDownloadResult;
  cancelQueuedDownloads(): BulkDownloadActionResult;
  chooseDownloadRoot(): Promise<DownloadRootSelectionResult>;
  chooseFfmpegPath(): Promise<FfmpegPathSelectionResult>;
  clearDownloadRoot(): DownloadRootInfo;
  clearFfmpegPath(): Promise<FfmpegStatus>;
  confirmPauseDownloadsBeforeClose(): Promise<boolean>;
  deleteDownload(value: unknown): Promise<DeleteDownloadResult>;
  deleteDownloads(value: unknown): Promise<DeleteDownloadsResult>;
  getDownloadRoot(): DownloadRootInfo;
  getFfmpegStatus(): Promise<FfmpegStatus>;
  handleLocalPlaybackRequest(request: Request): Promise<Response>;
  hasQueuedOrActiveDownloads(): boolean;
  localPlaybackSource(value: unknown): LocalPlaybackSourceResult;
  listDownloads(): DownloadRecord[];
  openDownloadFile(value: unknown): Promise<OpenDownloadFileResult>;
  openDownloadRoot(): Promise<{ opened: boolean; path: string }>;
  pauseDownload(value: unknown): PauseDownloadResult;
  pauseAllDownloads(): BulkDownloadActionResult;
  pauseDownloadsForShutdown(): Promise<void>;
  processQueue(): void;
  resumeDownload(value: unknown): Promise<EnqueueDownloadResult>;
  resumePausedDownloads(): Promise<BulkDownloadActionResult>;
  retryDownload(value: unknown): Promise<EnqueueDownloadResult>;
  retryFailedDownloads(): Promise<BulkDownloadActionResult>;
  revealDownloadFile(value: unknown): RevealDownloadFileResult;
  setDownloadRoot(value: unknown): DownloadRootInfo;
  setFfmpegPath(value: unknown): Promise<FfmpegStatus>;
  enqueueDownload(value: unknown): Promise<EnqueueDownloadResult>;
};

const childProcess: typeof NodeChildProcess = require('node:child_process');
const nodeCrypto: typeof NodeCrypto = require('node:crypto');
const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');
const stream: typeof NodeStream = require('node:stream');
const downloadHelpers = require('../download/download-helpers') as DownloadHelpersModule;
const nativeDownloadEngineModule = require('../download/native-download-engine') as {
  loadNativeDownloadEngine(): NativeDownloadEngineModule;
};
const urlPolicy = require('../browser/url-policy') as {
  canonicalJableVideoUrl(value: unknown): string | null;
};

const JABLE_SESSION_PARTITION = 'persist:jable-session';
export const LOCAL_PLAYBACK_SCHEME = 'jable-local-video';
const FFMPEG_CHECK_TIMEOUT_MS = 5000;
const FFMPEG_COMMAND = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const DOWNLOAD_PROGRESS_NOTIFY_INTERVAL_MS = 1000;
const DOWNLOAD_SEGMENT_SAMPLE_COUNT = 3;
const DOWNLOAD_SEGMENT_RETRY_LIMIT = 3;
const LOCAL_PLAYBACK_TOKEN_TTL_MS = 30 * 60 * 1000;
const DOWNLOAD_SPEED_MODE_SEGMENT_CONCURRENCY: Record<DownloadSpeedMode, { min: number; max: number }> = {
  stable: { min: 4, max: 8 },
  balanced: { min: 8, max: 32 },
  fast: { min: 16, max: 32 }
};

let app: Electron.App;
let dialog: typeof Electron.dialog;
let session: typeof Electron.session;
let shell: typeof Electron.shell;
let getAppSettings: () => AppSettings;
let getDatabase: () => DownloadDataStore;
let getMainWindow: () => Electron.BrowserWindow | null;
let forwardBrowserMessage: (channel: string, payload: unknown) => void;
let sendToAllBrowserTabs: (channel: string, payload: unknown) => void;
let showAppDialog: (options: Electron.MessageBoxOptions) => Promise<Electron.MessageBoxReturnValue>;
let translate: (key: string, params?: TranslationParams | null) => string;
let updateAppSettings: (patch: AppSettingsPatch) => AppSettings;
let downloadEngine: NativeDownloadEngineInstance | null = null;
let downloadClosePromptInFlight = false;
const downloadQueue: string[] = [];
const canceledDownloadUrls = new Set<string>();
const pausedDownloadUrls = new Set<string>();
const resumedDownloadUrls = new Set<string>();
const downloadRuntimeProgress = new Map<string, DownloadRuntimeProgress>();
const activeDownloads = new Map<string, ActiveDownloadRuntime>();
const activeDownloadTasks = new Map<string, Promise<void>>();
const localPlaybackTokens = new Map<string, { videoUrl: string; expiresAt: number }>();

function t(key: string, params?: TranslationParams | null): string {
  return translate(key, params);
}

function maxConcurrentDownloads() {
  return getAppSettings().maxConcurrentDownloads;
}

export function downloadSegmentConcurrencyForSpeedMode(mode: DownloadSpeedMode | string | null | undefined): {
  min: number;
  max: number;
} {
  if (mode === 'stable' || mode === 'fast') return DOWNLOAD_SPEED_MODE_SEGMENT_CONCURRENCY[mode];
  return DOWNLOAD_SPEED_MODE_SEGMENT_CONCURRENCY.balanced;
}

function currentDownloadSegmentConcurrency() {
  return downloadSegmentConcurrencyForSpeedMode(getAppSettings().downloadSpeedMode);
}

function sanitizedDownloadErrorDetail(error: unknown): string {
  return sanitizeDownloadErrorDetail(mainErrorMessage(error), getDownloadRoot().path);
}

function downloadCanceledError() {
  return new DownloadCanceledError(t('status.downloadCanceled'));
}

function downloadPausedError() {
  return new DownloadPausedError(t('status.downloadPaused'));
}

function throwIfDownloadCanceled(videoUrl: string) {
  if (pausedDownloadUrls.has(videoUrl)) throw downloadPausedError();
  if (canceledDownloadUrls.has(videoUrl)) throw downloadCanceledError();
}

function downloadFileSystemError(error: unknown) {
  return new DownloadFileSystemError(error);
}

function downloadErrorMessage(error: unknown): string {
  return formatDownloadErrorMessage(error, t, getDownloadRoot().path);
}

function ffmpegVersion(command: string): Promise<{ version: string; path: string }> {
  return new Promise(function (resolve, reject) {
    childProcess.execFile(
      command,
      ['-version'],
      {
        timeout: FFMPEG_CHECK_TIMEOUT_MS,
        windowsHide: true
      },
      function (error, stdout) {
        if (error) {
          reject(error);
          return;
        }

        const firstLine = String(stdout || '').split(/\r?\n/)[0] || 'ffmpeg';
        resolve({
          version: firstLine,
          path: command
        });
      }
    );
  });
}

function ffmpegPathErrorStatus(filePath: string, error: unknown): FfmpegStatus {
  return {
    state: 'invalid_path',
    source: 'manual',
    path: filePath,
    version: null,
    error: mainErrorMessage(error)
  };
}

async function getFfmpegStatus(): Promise<FfmpegStatus> {
  const manualPath = getAppSettings().ffmpegPath;

  if (manualPath) {
    const resolvedPath = path.resolve(manualPath);

    try {
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) return ffmpegPathErrorStatus(resolvedPath, new Error('Selected path is not a file'));
    } catch (error) {
      return ffmpegPathErrorStatus(resolvedPath, error);
    }

    try {
      const result = await ffmpegVersion(resolvedPath);
      return {
        state: 'detected',
        source: 'manual',
        path: result.path,
        version: result.version,
        error: null
      };
    } catch (error) {
      return {
        state: 'unsupported',
        source: 'manual',
        path: resolvedPath,
        version: null,
        error: mainErrorMessage(error)
      };
    }
  }

  try {
    const result = await ffmpegVersion(FFMPEG_COMMAND);
    return {
      state: 'detected',
      source: 'path',
      path: result.path,
      version: result.version,
      error: null
    };
  } catch (error) {
    return {
      state: 'missing',
      source: null,
      path: null,
      version: null,
      error: mainErrorMessage(error)
    };
  }
}

function setFfmpegPath(value: unknown): Promise<FfmpegStatus> {
  const filePath = typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : null;
  updateAppSettings({ ffmpegPath: filePath });
  return getFfmpegStatus();
}

function clearFfmpegPath(): Promise<FfmpegStatus> {
  updateAppSettings({ ffmpegPath: null });
  return getFfmpegStatus();
}

async function chooseFfmpegPath(): Promise<FfmpegPathSelectionResult> {
  const dialogOptions = {
    title: t('dialog.chooseFfmpeg'),
    properties: ['openFile'] as Electron.OpenDialogOptions['properties'],
    filters:
      process.platform === 'win32'
        ? [
            { name: 'FFmpeg', extensions: ['exe'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        : [{ name: 'All Files', extensions: ['*'] }]
  };
  const mainWindow = getMainWindow();
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || !result.filePaths.length) {
    return Object.assign(await getFfmpegStatus(), { canceled: true });
  }

  return setFfmpegPath(result.filePaths[0]);
}

function defaultDownloadRootPath(): string {
  return path.join(app.getPath('userData'), 'downloads');
}

function getDownloadRoot(): DownloadRootInfo {
  const manualRoot = getAppSettings().downloadRoot;
  const rootPath = manualRoot ? path.resolve(manualRoot) : defaultDownloadRootPath();
  let exists = false;

  try {
    exists = fs.statSync(rootPath).isDirectory();
  } catch (error) {
    exists = false;
  }

  return {
    source: manualRoot ? 'manual' : 'default',
    path: rootPath,
    exists: exists
  };
}

function ensureDownloadRootReady() {
  const root = getDownloadRoot();

  try {
    fs.mkdirSync(root.path, { recursive: true });
    if (!fs.statSync(root.path).isDirectory()) {
      throw new Error('Download location is not a directory');
    }
    fs.accessSync(root.path, fs.constants.W_OK);
  } catch (error) {
    throw new Error(t('status.downloadErrorFileSystem', { error: sanitizedDownloadErrorDetail(error) }));
  }
}

function setDownloadRoot(value: unknown): DownloadRootInfo {
  const rootPath = typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : null;
  updateAppSettings({ downloadRoot: rootPath });
  return getDownloadRoot();
}

function clearDownloadRoot(): DownloadRootInfo {
  updateAppSettings({ downloadRoot: null });
  return getDownloadRoot();
}

async function chooseDownloadRoot(): Promise<DownloadRootSelectionResult> {
  const dialogOptions = {
    title: t('dialog.chooseDownloadRoot'),
    defaultPath: getDownloadRoot().path,
    properties: ['openDirectory', 'createDirectory'] as Electron.OpenDialogOptions['properties']
  };
  const mainWindow = getMainWindow();
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || !result.filePaths.length) {
    return Object.assign(getDownloadRoot(), { canceled: true });
  }

  return setDownloadRoot(result.filePaths[0]);
}

function openDownloadRoot(): Promise<{ opened: boolean; path: string }> {
  const root = getDownloadRoot();
  fs.mkdirSync(root.path, { recursive: true });

  return shell.openPath(root.path).then(function (errorMessage: string) {
    if (errorMessage) throw new Error(errorMessage);
    return {
      opened: true,
      path: root.path
    };
  });
}

function shouldBypassShellOpenForTests(): boolean {
  return process.env.JABLE_DESKTOP_TEST_BYPASS_SHELL_OPEN === '1';
}

function openShellPath(filePath: string): Promise<void> {
  if (shouldBypassShellOpenForTests()) return Promise.resolve();

  return shell.openPath(filePath).then(function (errorMessage: string) {
    if (errorMessage) throw new Error(errorMessage);
  });
}

function revealShellPath(filePath: string) {
  if (shouldBypassShellOpenForTests()) return;
  shell.showItemInFolder(filePath);
}

function listPersistedDownloads(): DownloadRecord[] {
  return getDatabase().listDownloadAssets();
}

function getPersistedDownload(videoUrl: string): DownloadRecord | null {
  return getDatabase().getDownloadAsset(videoUrl);
}

function upsertPersistedDownload(patch: DownloadRecordPatch): DownloadRecord {
  return getDatabase().upsertDownloadAsset(patch);
}

function removePersistedDownload(videoUrl: string): boolean {
  return getDatabase().removeDownloadAsset(videoUrl);
}

function downloadRecordFileStats(record: DownloadRecord): NodeFs.Stats | null {
  const filePath = resolveManagedDownloadPath(record.localPath);
  if (!filePath) return null;
  try {
    return fs.statSync(filePath);
  } catch (error) {
    return null;
  }
}

function downloadRecordWithFileState(record: DownloadRecord): DownloadRecord {
  if (record.state !== 'ready' && record.state !== 'missing') return record;

  const stats = downloadRecordFileStats(record);
  const exists = Boolean(stats && stats.isFile());
  if (record.state === 'ready' && !exists) {
    return Object.assign({}, record, {
      state: 'missing' as const,
      fileSizeBytes: null,
      error: null
    });
  }
  if (record.state === 'missing' && exists) {
    return Object.assign({}, record, {
      state: 'ready' as const,
      error: null,
      fileSizeBytes: stats ? stats.size : record.fileSizeBytes
    });
  }
  if (record.state === 'ready' && exists && stats && record.fileSizeBytes !== stats.size) {
    return Object.assign({}, record, {
      fileSizeBytes: stats.size
    });
  }

  return record;
}

function downloadRecordWithRuntimeState(record: DownloadRecord): DownloadRecord {
  const fileRecord = downloadRecordWithFileState(record);
  if (fileRecord.state !== 'queued' && fileRecord.state !== 'downloading') return fileRecord;

  const isActive = activeDownloads.has(fileRecord.videoUrl);
  const isQueued = downloadQueue.indexOf(fileRecord.videoUrl) !== -1;
  if (isActive || isQueued) return fileRecord;

  return Object.assign({}, fileRecord, {
    state: 'paused' as const,
    progress: null,
    error: t('status.downloadPausedAfterRestart'),
    failurePhase: null,
    failureCode: null,
    lastErrorAt: null
  });
}

function downloadRecordWithRuntimeProgress(record: DownloadRecord): DownloadRecord {
  if (record.state !== 'downloading') return record;

  const runtimeProgress = downloadRuntimeProgress.get(record.videoUrl);
  if (!runtimeProgress) return record;

  return Object.assign({}, record, {
    downloadedBytes: runtimeProgress.downloadedBytes,
    downloadSpeedBytesPerSecond: runtimeProgress.downloadSpeedBytesPerSecond
  });
}

function reconcileDownloadRecordFileState(record: DownloadRecord): DownloadRecord {
  const next = downloadRecordWithFileState(record);
  if (!downloadRecordNeedsPersistence(record, next)) return next;

  const persisted = upsertPersistedDownload({
    videoUrl: next.videoUrl,
    state: next.state,
    progress: next.progress,
    error: next.error,
    fileSizeBytes: next.fileSizeBytes,
    failurePhase: next.failurePhase,
    failureCode: next.failureCode,
    lastErrorAt: next.lastErrorAt
  });
  notifyDownloadsChanged();
  return persisted;
}

function downloadRecordNeedsPersistence(current: DownloadRecord, next: DownloadRecord): boolean {
  return (
    current.state !== next.state ||
    current.progress !== next.progress ||
    current.error !== next.error ||
    current.fileSizeBytes !== next.fileSizeBytes ||
    current.failurePhase !== next.failurePhase ||
    current.failureCode !== next.failureCode ||
    current.lastErrorAt !== next.lastErrorAt
  );
}

function listDownloads(): DownloadRecord[] {
  return listPersistedDownloads().map(function (record) {
    const next = downloadRecordWithRuntimeState(record);
    if (!downloadRecordNeedsPersistence(record, next)) return downloadRecordWithRuntimeProgress(next);

    const persisted = upsertPersistedDownload({
      videoUrl: next.videoUrl,
      state: next.state,
      progress: next.progress,
      error: next.error,
      fileSizeBytes: next.fileSizeBytes,
      failurePhase: next.failurePhase,
      failureCode: next.failureCode,
      lastErrorAt: next.lastErrorAt
    });
    return downloadRecordWithRuntimeProgress(persisted);
  });
}

function notifyDownloadsChanged() {
  const records = listDownloads();
  forwardBrowserMessage('downloads-changed', records);
  sendToAllBrowserTabs('downloads-changed', records);
}

function downloadTimestamp() {
  return new Date().toISOString();
}

function normalizeDownloadVideoUrl(value: unknown, field: string, channel: string): string {
  const videoUrl = urlPolicy.canonicalJableVideoUrl(requiredStringValue(value, field, channel));
  if (!videoUrl) throw new Error(t('errors.untrustedDownloadUrl'));
  return videoUrl;
}

function normalizeDownloadVideoUrls(value: unknown, channel: string): string[] {
  if (!Array.isArray(value)) throw new Error('Invalid IPC payload for ' + channel + ': videoUrls');
  const urls: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const videoUrl = normalizeDownloadVideoUrl(value[index], 'videoUrls[' + index + ']', channel);
    if (seen.has(videoUrl)) continue;
    seen.add(videoUrl);
    urls.push(videoUrl);
  }
  return urls;
}

function normalizeDownloadRequestPayload(value: unknown): DownloadRequestPayload {
  const channel = 'download:enqueue';
  const payload = requiredRecord(value, channel);
  const video = requiredRecord(payload.video, channel);

  return {
    collectionKey: normalizeCollectionKey(payload.collectionKey, channel),
    video: {
      title: typeof video.title === 'string' ? video.title : null,
      url: normalizeDownloadVideoUrl(video.url, 'video.url', channel),
      views: null,
      likes: null,
      img: typeof video.img === 'string' ? video.img : null,
      preview: typeof video.preview === 'string' ? video.preview : null
    }
  };
}

function sanitizeDownloadFileName(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*]/g, ' ')
    .split('')
    .map(function (character) {
      return character.charCodeAt(0) < 32 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return (sanitized || 'video').slice(0, 120);
}

function videoUrlSlug(videoUrl: string): string {
  try {
    const parts = new URL(videoUrl).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'video';
  } catch (error) {
    return 'video';
  }
}

function usedDownloadRelativePaths(excludeVideoUrl: string): Set<string> {
  const used = new Set<string>();
  const records = listPersistedDownloads();

  for (const record of records) {
    if (record.videoUrl === excludeVideoUrl || !record.localPath) continue;
    used.add(path.normalize(record.localPath));
  }

  return used;
}

function downloadOutputRelativePath(payload: DownloadRequestPayload): string {
  const name = sanitizeDownloadFileName(payload.video.title || videoUrlSlug(payload.video.url));
  const usedPaths = usedDownloadRelativePaths(payload.video.url);

  for (let index = 1; index <= 9999; index++) {
    const candidateName = index === 1 ? name : name + ' (' + index + ')';
    const relativePath = candidateName + '.mp4';
    const filePath = resolveManagedDownloadPath(relativePath);
    if (!filePath) continue;
    if (usedPaths.has(path.normalize(relativePath))) continue;
    if (fs.existsSync(filePath) || fs.existsSync(filePath + '.part')) continue;
    return relativePath;
  }

  throw new Error('Unable to choose a download filename');
}

function resolveManagedDownloadPath(fileRelativePath: string | null): string | null {
  if (!fileRelativePath || path.isAbsolute(fileRelativePath)) return null;

  const downloadRootPath = getDownloadRoot().path;
  const filePath = path.resolve(downloadRootPath, fileRelativePath);
  if (!isPathInsideDirectory(filePath, downloadRootPath)) return null;

  return filePath;
}

function localPlaybackUnavailable(
  videoUrl: string | null,
  reason: LocalPlaybackUnavailableReason
): LocalPlaybackSourceResult {
  return {
    available: false,
    videoUrl: videoUrl,
    reason: reason
  };
}

function localPlaybackTokenUrl(token: string): string {
  return LOCAL_PLAYBACK_SCHEME + '://play/' + token + '.mp4';
}

function purgeExpiredLocalPlaybackTokens(now = Date.now()) {
  for (const entry of localPlaybackTokens) {
    if (entry[1].expiresAt <= now) localPlaybackTokens.delete(entry[0]);
  }
}

function createLocalPlaybackToken(videoUrl: string): string {
  purgeExpiredLocalPlaybackTokens();
  const token = nodeCrypto.randomBytes(18).toString('base64url');
  localPlaybackTokens.set(token, {
    videoUrl: videoUrl,
    expiresAt: Date.now() + LOCAL_PLAYBACK_TOKEN_TTL_MS
  });
  return token;
}

function localPlaybackTokenFromRequestUrl(value: unknown): string | null {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== LOCAL_PLAYBACK_SCHEME + ':' || parsed.hostname !== 'play') return null;
    const match = parsed.pathname.match(/^\/([A-Za-z0-9_-]+)\.mp4$/);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

function videoUrlForLocalPlaybackToken(token: string): string | null {
  const entry = localPlaybackTokens.get(token);
  const now = Date.now();
  if (!entry || entry.expiresAt <= now) {
    localPlaybackTokens.delete(token);
    return null;
  }

  entry.expiresAt = now + LOCAL_PLAYBACK_TOKEN_TTL_MS;
  return entry.videoUrl;
}

function localPlaybackReadyFile(videoUrl: string): LocalPlaybackFile | null {
  const record = getPersistedDownload(videoUrl);
  const readyRecord = record ? reconcileDownloadRecordFileState(record) : null;
  if (!readyRecord || readyRecord.state !== 'ready' || !readyRecord.localPath) return null;

  const filePath = resolveManagedDownloadPath(readyRecord.localPath);
  if (!filePath) return null;

  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) return null;
    return {
      record: readyRecord,
      filePath: filePath,
      stats: stats
    };
  } catch (error) {
    return null;
  }
}

function localPlaybackSource(value: unknown): LocalPlaybackSourceResult {
  const videoUrl = urlPolicy.canonicalJableVideoUrl(value);
  if (!videoUrl) return localPlaybackUnavailable(null, 'not_video');

  const record = getPersistedDownload(videoUrl);
  if (!record) return localPlaybackUnavailable(videoUrl, 'not_ready');

  const readyRecord = reconcileDownloadRecordFileState(record);
  if (readyRecord.state === 'missing') return localPlaybackUnavailable(videoUrl, 'missing');
  if (readyRecord.state !== 'ready') return localPlaybackUnavailable(videoUrl, 'not_ready');

  const readyFile = localPlaybackReadyFile(videoUrl);
  if (!readyFile) return localPlaybackUnavailable(videoUrl, 'unavailable');

  return {
    available: true,
    videoUrl: readyFile.record.videoUrl,
    sourceUrl: localPlaybackTokenUrl(createLocalPlaybackToken(readyFile.record.videoUrl)),
    title: readyFile.record.title,
    fileSizeBytes: readyFile.stats.size
  };
}

function localPlaybackResponse(
  status: number,
  body: LocalPlaybackResponseBody,
  headers?: LocalPlaybackResponseHeaders
): Response {
  return new Response(body, {
    status: status,
    headers: headers
  });
}

function localPlaybackErrorResponse(status: number, message: string): Response {
  return localPlaybackResponse(status, message, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8'
  });
}

function localPlaybackFileResponse(file: LocalPlaybackFile, request: Request): Response {
  const method = request.method.toUpperCase();
  const size = file.stats.size;
  const range = parseLocalPlaybackRangeHeader(request.headers.get('range'), size);
  const headers: Record<string, string> = {
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-type': 'video/mp4'
  };

  if (!range.satisfiable) {
    return localPlaybackResponse(416, null, Object.assign(headers, { 'content-range': 'bytes */' + size }));
  }

  const contentLength = size === 0 ? 0 : range.end - range.start + 1;
  headers['content-length'] = String(contentLength);
  if (range.status === 206) headers['content-range'] = 'bytes ' + range.start + '-' + range.end + '/' + size;

  if (method === 'HEAD' || contentLength === 0) {
    return localPlaybackResponse(range.status, null, headers);
  }

  const fileStream = fs.createReadStream(file.filePath, {
    start: range.start,
    end: range.end
  });
  const body = stream.Readable.toWeb(fileStream) as unknown as LocalPlaybackResponseBody;
  return localPlaybackResponse(range.status, body, headers);
}

async function handleLocalPlaybackRequest(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return localPlaybackErrorResponse(405, 'Method Not Allowed');
  }

  const token = localPlaybackTokenFromRequestUrl(request.url);
  if (!token) return localPlaybackErrorResponse(404, 'Not Found');

  const videoUrl = videoUrlForLocalPlaybackToken(token);
  if (!videoUrl) return localPlaybackErrorResponse(404, 'Not Found');

  const readyFile = localPlaybackReadyFile(videoUrl);
  if (!readyFile) return localPlaybackErrorResponse(404, 'Not Found');

  return localPlaybackFileResponse(readyFile, request);
}

async function cookieHeaderForUrl(targetUrl: string): Promise<string> {
  const origin = new URL(targetUrl).origin;
  const cookies = await session.fromPartition(JABLE_SESSION_PARTITION).cookies.get({ url: origin });
  return cookies
    .map(function (cookie) {
      return cookie.name + '=' + cookie.value;
    })
    .join('; ');
}

async function fetchVideoPageHtml(videoUrl: string, signal?: AbortSignal | null): Promise<string> {
  const cookieHeader = await cookieHeaderForUrl(videoUrl);
  const headers = downloadHelpers.videoPageRequestHeaders(videoUrl, cookieHeader);

  const response = await fetch(videoUrl, { headers: headers, signal: signal || undefined });
  if (!response.ok) throw new DownloadHttpError(response.status);
  return response.text();
}

async function ffmpegCommandForDownload(): Promise<string> {
  const status = await getFfmpegStatus();
  if (status.state !== 'detected') throw new Error(t('status.ffmpegMissing'));
  return status.path || FFMPEG_COMMAND;
}

function removePartialDownloadFile(outputPath: string) {
  try {
    fs.unlinkSync(outputPath + '.part');
  } catch (error) {}
}

function updateDownloadRuntimeProgress(videoUrl: string, downloadedBytes: number) {
  if (!Number.isFinite(downloadedBytes) || downloadedBytes < 0) return;

  const now = Date.now();
  const current = downloadRuntimeProgress.get(videoUrl) || {
    downloadedBytes: null,
    downloadSpeedBytesPerSecond: null,
    lastBytes: null,
    lastSampledAt: null,
    lastNotifiedAt: null
  };
  const nextDownloadedBytes =
    typeof current.downloadedBytes === 'number' ? Math.max(downloadedBytes, current.downloadedBytes) : downloadedBytes;
  let speedBytesPerSecond = current.downloadSpeedBytesPerSecond;
  let lastBytes = current.lastBytes;
  let lastSampledAt = current.lastSampledAt;
  const shouldNotify =
    current.lastNotifiedAt === null || now - current.lastNotifiedAt >= DOWNLOAD_PROGRESS_NOTIFY_INTERVAL_MS;

  if (shouldNotify) {
    if (
      typeof current.lastBytes === 'number' &&
      typeof current.lastSampledAt === 'number' &&
      nextDownloadedBytes >= current.lastBytes &&
      now > current.lastSampledAt
    ) {
      speedBytesPerSecond = Math.round(
        ((nextDownloadedBytes - current.lastBytes) * 1000) / (now - current.lastSampledAt)
      );
    }
    lastBytes = nextDownloadedBytes;
    lastSampledAt = now;
  }

  downloadRuntimeProgress.set(videoUrl, {
    downloadedBytes: nextDownloadedBytes,
    downloadSpeedBytesPerSecond: speedBytesPerSecond,
    lastBytes: lastBytes,
    lastSampledAt: lastSampledAt,
    lastNotifiedAt: shouldNotify ? now : current.lastNotifiedAt
  });

  if (shouldNotify) notifyDownloadsChanged();
}

function handleFfmpegProgressLine(videoUrl: string, line: string) {
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
  writeRemainder: (value: string) => void
) {
  const text = readRemainder() + String(chunk);
  const lines = text.split(/\r?\n/);
  writeRemainder(lines.pop() || '');

  for (const line of lines) {
    handleFfmpegProgressLine(videoUrl, line);
  }
}

function downloadSegmentTempDirectory(outputPath: string): string {
  return outputPath + '.segments';
}

function downloadResumeManifestPath(outputPath: string): string {
  return path.join(downloadSegmentTempDirectory(outputPath), 'resume.json');
}

function removeDownloadSegmentTempDirectory(outputPath: string) {
  try {
    fs.rmSync(downloadSegmentTempDirectory(outputPath), { recursive: true, force: true });
  } catch (error) {}
}

function roundedDuration(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function segmentResumeExtension(url: string): 'aac' | 'm4s' | 'mp4' | 'ts' {
  const withoutQuery = url.split('?')[0] || url;
  const fileName = withoutQuery.split('/').filter(Boolean).pop() || '';
  const extension = fileName.includes('.') ? fileName.split('.').pop() || '' : '';

  if (extension === 'aac' || extension === 'm4s' || extension === 'mp4' || extension === 'ts') return extension;
  return 'ts';
}

function segmentFileName(index: number, url: string): string {
  return 'segment-' + String(index + 1).padStart(6, '0') + '.' + segmentResumeExtension(url);
}

function playlistResumeIdentity(playlist: HlsPlaylist) {
  return {
    version: 2,
    targetDuration: roundedDuration(playlist.targetDuration),
    segments: playlist.segments.map(function (segment) {
      return {
        extension: segmentResumeExtension(segment.url),
        duration: roundedDuration(segment.duration),
        key: segment.key
          ? {
              method: segment.key.method,
              iv: segment.key.iv || null
            }
          : null
      };
    })
  };
}

function resumeManifestMatches(outputPath: string, playlist: HlsPlaylist): boolean {
  let current: unknown;
  try {
    current = JSON.parse(fs.readFileSync(downloadResumeManifestPath(outputPath), 'utf8'));
  } catch (error) {
    return false;
  }

  return JSON.stringify(current) === JSON.stringify(playlistResumeIdentity(playlist));
}

function reusableSegmentFileCount(outputPath: string, playlist: HlsPlaylist): number {
  const tempDir = downloadSegmentTempDirectory(outputPath);
  let count = 0;

  for (let index = 0; index < playlist.segments.length; index++) {
    const segment = playlist.segments[index];
    if (!segment) continue;

    try {
      const stats = fs.statSync(path.join(tempDir, segmentFileName(index, segment.url)));
      if (stats.isFile() && stats.size > 0) count++;
    } catch (error) {}
  }

  return count;
}

function shouldReuseDownloadSegmentTempDirectory(
  outputPath: string,
  playlist: HlsPlaylist,
  reuseExistingSegments: boolean
): boolean {
  if (!reuseExistingSegments) return false;
  if (resumeManifestMatches(outputPath, playlist)) return true;

  // Signed HLS URLs can change after pause. Existing complete segment files are
  // still reusable when their stable local index/extension names match.
  return reusableSegmentFileCount(outputPath, playlist) > 0;
}

function prepareDownloadSegmentTempDirectory(
  outputPath: string,
  playlist: HlsPlaylist,
  reuseExistingSegments: boolean
) {
  if (!shouldReuseDownloadSegmentTempDirectory(outputPath, playlist, reuseExistingSegments)) {
    removeDownloadSegmentTempDirectory(outputPath);
  }

  const tempDir = downloadSegmentTempDirectory(outputPath);
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(downloadResumeManifestPath(outputPath), JSON.stringify(playlistResumeIdentity(playlist), null, 2));
}

function removeDownloadWorkingFiles(record: DownloadRecord) {
  const outputPath = resolveManagedDownloadPath(record.localPath);
  if (!outputPath) return;
  removePartialDownloadFile(outputPath);
  removeDownloadSegmentTempDirectory(outputPath);
}

function removePartialDownloadFileForRecord(record: DownloadRecord) {
  const outputPath = resolveManagedDownloadPath(record.localPath);
  if (!outputPath) return;
  removePartialDownloadFile(outputPath);
}

async function fetchHlsText(
  playlistUrl: string,
  videoUrl: string,
  cookieHeader: string,
  signal: AbortSignal
): Promise<string> {
  const response = await fetch(playlistUrl, {
    headers: downloadHelpers.hlsRequestHeaders(videoUrl, cookieHeader),
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
    throwIfDownloadCanceled(videoUrl);
    const content = await fetchHlsText(currentPlaylistUrl, videoUrl, cookieHeader, signal);
    const playlist = downloadHelpers.parseHlsPlaylist(content, currentPlaylistUrl);
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
  setFailurePhase?: (phase: DownloadFailurePhase) => void
): Promise<{ cookieHeader: string; playlist: HlsPlaylist }> {
  if (setFailurePhase) setFailurePhase('video_page');
  const cookieHeader = await cookieHeaderForUrl(videoUrl);
  const html = await fetchVideoPageHtml(videoUrl, signal);
  throwIfDownloadCanceled(videoUrl);
  if (setFailurePhase) setFailurePhase('playlist');
  const playlistUrl = downloadHelpers.extractHlsPlaylistUrl(html, videoUrl);
  if (!playlistUrl) throw new HlsPlaylistNotFoundError();
  throwIfDownloadCanceled(videoUrl);
  const playlist = await resolveHlsMediaPlaylist(playlistUrl, videoUrl, cookieHeader, signal);
  return {
    cookieHeader: cookieHeader,
    playlist: playlist
  };
}

function refreshedPlaylistMatchesDownloadWork(outputPath: string, playlist: HlsPlaylist): boolean {
  return (
    resumeManifestMatches(outputPath, playlist) ||
    (playlist.segments.length > 0 && reusableSegmentFileCount(outputPath, playlist) === playlist.segments.length)
  );
}

function downloadSegmentDirectorySize(tempDir: string): number {
  let total = 0;
  let entries: NodeFs.Dirent[];
  try {
    entries = fs.readdirSync(tempDir, { withFileTypes: true });
  } catch (error) {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/^segment-\d{6}\.(aac|m4s|mp4|ts)$/.test(entry.name)) continue;
    try {
      total += fs.statSync(path.join(tempDir, entry.name)).size;
    } catch (error) {}
  }

  return total;
}

function startNativeDownloadProgress(videoUrl: string, tempDir: string): ReturnType<typeof setInterval> {
  return setInterval(function () {
    updateDownloadRuntimeProgress(videoUrl, downloadSegmentDirectorySize(tempDir));
  }, DOWNLOAD_PROGRESS_NOTIFY_INTERVAL_MS);
}

function parseNativeDownloadSegmentsResult(value: string): NativeDownloadSegmentsResult {
  const result = JSON.parse(value) as Partial<NativeDownloadSegmentsResult>;
  if (typeof result.playlistPath !== 'string' || !result.playlistPath) {
    throw new DownloadSegmentError('native download engine did not return playlistPath');
  }
  return {
    playlistPath: result.playlistPath,
    downloadedBytes:
      typeof result.downloadedBytes === 'number' && Number.isFinite(result.downloadedBytes) ? result.downloadedBytes : 0
  };
}

function nativeDownloadError(error: unknown): Error {
  const message = mainErrorMessage(error);
  if (/download canceled|AbortError/i.test(message)) return downloadCanceledError();
  if (/unsupported HLS key method/i.test(message)) return new HlsPlaylistUnsupportedError(message);
  return new DownloadSegmentError(message);
}

async function downloadHlsSegmentsWithNative(
  playlist: HlsPlaylist,
  videoUrl: string,
  cookieHeader: string,
  outputPath: string,
  signal: AbortSignal,
  runtime: ActiveDownloadRuntime,
  reuseExistingSegments: boolean
): Promise<string> {
  const tempDir = downloadSegmentTempDirectory(outputPath);
  const headers = downloadHelpers.hlsRequestHeaders(videoUrl, cookieHeader);
  const downloadId = videoUrl;
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  try {
    throwIfDownloadCanceled(videoUrl);
    try {
      prepareDownloadSegmentTempDirectory(outputPath, playlist, reuseExistingSegments);
    } catch (error) {
      throw downloadFileSystemError(error);
    }
    runtime.nativeId = downloadId;
    updateDownloadRuntimeProgress(videoUrl, downloadSegmentDirectorySize(tempDir));
    progressTimer = startNativeDownloadProgress(videoUrl, tempDir);
    const concurrency = currentDownloadSegmentConcurrency();
    const result = parseNativeDownloadSegmentsResult(
      await getDownloadEngine().downloadHlsSegments(
        JSON.stringify({
          downloadId: downloadId,
          tempDir: tempDir,
          headers: headers,
          minConcurrency: concurrency.min,
          maxConcurrency: concurrency.max,
          sampleSegmentCount: DOWNLOAD_SEGMENT_SAMPLE_COUNT,
          retryLimit: DOWNLOAD_SEGMENT_RETRY_LIMIT,
          targetDuration: playlist.targetDuration,
          segments: playlist.segments
        })
      )
    );
    throwIfDownloadCanceled(videoUrl);
    updateDownloadRuntimeProgress(videoUrl, result.downloadedBytes);
    return result.playlistPath;
  } catch (error) {
    if (pausedDownloadUrls.has(videoUrl)) throw downloadPausedError();
    if (signal.aborted || canceledDownloadUrls.has(videoUrl)) throw downloadCanceledError();
    throw nativeDownloadError(error);
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    if (runtime.nativeId === downloadId) runtime.nativeId = null;
  }
}

async function downloadHlsSegmentsWithPlaylistRefresh(
  playlist: HlsPlaylist,
  videoUrl: string,
  cookieHeader: string,
  outputPath: string,
  signal: AbortSignal,
  runtime: ActiveDownloadRuntime,
  reuseExistingSegments: boolean
): Promise<string> {
  try {
    return await downloadHlsSegmentsWithNative(
      playlist,
      videoUrl,
      cookieHeader,
      outputPath,
      signal,
      runtime,
      reuseExistingSegments
    );
  } catch (error) {
    if (!isSegmentRefreshCandidate(error)) throw error;
    throwIfDownloadCanceled(videoUrl);

    let refreshed: { cookieHeader: string; playlist: HlsPlaylist };
    try {
      refreshed = await resolveDownloadHlsSource(videoUrl, signal);
    } catch (refreshError) {
      void refreshError;
      throw error;
    }
    throwIfDownloadCanceled(videoUrl);

    if (!refreshedPlaylistMatchesDownloadWork(outputPath, refreshed.playlist)) throw error;

    return downloadHlsSegmentsWithNative(
      refreshed.playlist,
      videoUrl,
      refreshed.cookieHeader,
      outputPath,
      signal,
      runtime,
      true
    );
  }
}

function runFfmpegRemux(
  command: string,
  inputPlaylistPath: string,
  videoUrl: string,
  outputPath: string,
  runtime: ActiveDownloadRuntime
): Promise<void> {
  return new Promise(function (resolve, reject) {
    const tempPath = outputPath + '.part';
    let progressRemainder = '';
    try {
      fs.unlinkSync(tempPath);
    } catch (error) {}

    try {
      throwIfDownloadCanceled(videoUrl);
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
        }
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

      if (pausedDownloadUrls.has(videoUrl)) {
        removePartialDownloadFile(outputPath);
        reject(downloadPausedError());
        return;
      }

      if (canceledDownloadUrls.has(videoUrl)) {
        removePartialDownloadFile(outputPath);
        reject(downloadCanceledError());
        return;
      }

      if (code !== 0) {
        removePartialDownloadFile(outputPath);
        reject(new FfmpegDownloadError(stderr.trim() || 'FFmpeg exited with code ' + code));
        return;
      }

      try {
        throwIfDownloadCanceled(videoUrl);
        fs.renameSync(tempPath, outputPath);
        resolve();
      } catch (error) {
        reject(error instanceof DownloadCanceledError ? error : downloadFileSystemError(error));
      }
    });
  });
}

async function runQueuedDownload(record: DownloadRecord) {
  const outputPath = resolveManagedDownloadPath(record.localPath);
  const reuseExistingSegments = resumedDownloadUrls.has(record.videoUrl);
  let failurePhase: DownloadFailurePhase = 'ffmpeg_check';
  const abortController = new AbortController();
  const runtime: ActiveDownloadRuntime = {
    abortController: abortController,
    process: null,
    nativeId: null
  };
  activeDownloads.set(record.videoUrl, runtime);

  upsertPersistedDownload({
    videoUrl: record.videoUrl,
    state: 'downloading',
    progress: null,
    error: null,
    localPath: record.localPath,
    failurePhase: null,
    failureCode: null,
    attemptCount: Math.max(0, record.attemptCount || 0) + 1,
    lastStartedAt: downloadTimestamp(),
    lastErrorAt: null
  });
  notifyDownloadsChanged();

  try {
    failurePhase = 'file';
    if (!outputPath) throw new Error(t('status.downloadFileUnavailable'));
    throwIfDownloadCanceled(record.videoUrl);
    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    } catch (error) {
      throw downloadFileSystemError(error);
    }
    failurePhase = 'ffmpeg_check';
    const command = await ffmpegCommandForDownload();
    throwIfDownloadCanceled(record.videoUrl);
    const source = await resolveDownloadHlsSource(record.videoUrl, abortController.signal, function (phase) {
      failurePhase = phase;
    });
    throwIfDownloadCanceled(record.videoUrl);
    failurePhase = 'segments';
    const localPlaylistPath = await downloadHlsSegmentsWithPlaylistRefresh(
      source.playlist,
      record.videoUrl,
      source.cookieHeader,
      outputPath,
      abortController.signal,
      runtime,
      reuseExistingSegments
    );
    throwIfDownloadCanceled(record.videoUrl);

    failurePhase = 'remux';
    await runFfmpegRemux(command, localPlaylistPath, record.videoUrl, outputPath, runtime);
    throwIfDownloadCanceled(record.videoUrl);
    let stats: NodeFs.Stats;
    try {
      failurePhase = 'file';
      stats = fs.statSync(outputPath);
    } catch (error) {
      throw downloadFileSystemError(error);
    }

    upsertPersistedDownload({
      videoUrl: record.videoUrl,
      state: 'ready',
      progress: 1,
      error: null,
      localPath: record.localPath,
      fileSizeBytes: stats.isFile() ? stats.size : null,
      failurePhase: null,
      failureCode: null,
      lastErrorAt: null,
      completedAt: downloadTimestamp()
    });
    notifyDownloadsChanged();
  } catch (error) {
    const paused = pausedDownloadUrls.has(record.videoUrl) || isDownloadPausedError(error);
    upsertPersistedDownload({
      videoUrl: record.videoUrl,
      state: paused ? 'paused' : 'failed',
      progress: null,
      error: paused ? t('status.downloadPaused') : downloadErrorMessage(error),
      failurePhase: paused ? null : failurePhase,
      failureCode: paused ? null : downloadFailureCode(error),
      lastErrorAt: paused ? null : downloadTimestamp()
    });
    notifyDownloadsChanged();
  } finally {
    const paused = pausedDownloadUrls.has(record.videoUrl);
    if (outputPath) {
      removePartialDownloadFile(outputPath);
      if (!paused) removeDownloadSegmentTempDirectory(outputPath);
    }
    downloadRuntimeProgress.delete(record.videoUrl);
    canceledDownloadUrls.delete(record.videoUrl);
    pausedDownloadUrls.delete(record.videoUrl);
    resumedDownloadUrls.delete(record.videoUrl);
    activeDownloads.delete(record.videoUrl);
  }
}

function processDownloadQueue() {
  while (activeDownloads.size < maxConcurrentDownloads()) {
    const nextUrl = downloadQueue.shift();
    if (!nextUrl) return;

    const record = getPersistedDownload(nextUrl);
    if (!record || record.state !== 'queued') continue;

    const task = runQueuedDownload(record)
      .catch(function (error) {
        console.error(error);
      })
      .finally(function () {
        activeDownloadTasks.delete(record.videoUrl);
        processDownloadQueue();
      });
    activeDownloadTasks.set(record.videoUrl, task);
  }
}

function queueDownloadRecord(record: DownloadRecord) {
  if (downloadQueue.indexOf(record.videoUrl) === -1 && !activeDownloads.has(record.videoUrl)) {
    downloadQueue.push(record.videoUrl);
  }
  notifyDownloadsChanged();
  processDownloadQueue();
}

async function enqueueDownload(value: unknown): Promise<EnqueueDownloadResult> {
  const payload = normalizeDownloadRequestPayload(value);
  const existing = getPersistedDownload(payload.video.url);
  const existingRecord = existing ? downloadRecordWithRuntimeState(existing) : null;
  const existingState = existingRecord ? existingRecord.state : null;

  if (existingRecord && (existingState === 'queued' || existingState === 'downloading' || existingState === 'ready')) {
    return {
      record: existingRecord,
      queued: false
    };
  }

  await ffmpegCommandForDownload();
  ensureDownloadRootReady();

  const record = upsertPersistedDownload({
    videoUrl: payload.video.url,
    title: payload.video.title,
    img: payload.video.img,
    preview: payload.video.preview,
    localPath: downloadOutputRelativePath(payload),
    state: 'queued',
    progress: null,
    error: null,
    completedAt: null
  });

  queueDownloadRecord(record);

  return {
    record: record,
    queued: true
  };
}

async function retryDownload(value: unknown): Promise<EnqueueDownloadResult> {
  const videoUrl = normalizeDownloadVideoUrl(value, 'videoUrl', 'download:retry');
  const existing = videoUrl ? getPersistedDownload(videoUrl) : null;
  const existingRecord = existing ? downloadRecordWithRuntimeState(existing) : null;
  const existingState = existingRecord ? existingRecord.state : null;

  if (!existing) throw new Error(t('status.downloadFileUnavailable'));
  if (existingRecord && (existingState === 'queued' || existingState === 'downloading' || existingState === 'ready')) {
    return {
      record: existingRecord,
      queued: false
    };
  }
  if (existingState === 'paused') return resumeDownload(videoUrl);

  await ffmpegCommandForDownload();
  ensureDownloadRootReady();

  const record = upsertPersistedDownload({
    videoUrl: existing.videoUrl,
    state: 'queued',
    progress: null,
    error: null,
    completedAt: null
  });
  queueDownloadRecord(record);

  return {
    record: record,
    queued: true
  };
}

async function retryFailedDownloads(): Promise<BulkDownloadActionResult> {
  const records = listDownloads().filter(function (record) {
    return record.state === 'failed' || record.state === 'missing';
  });
  const result: BulkDownloadActionResult = {
    requested: records.length,
    affected: 0,
    skipped: 0,
    failed: 0
  };

  for (const record of records) {
    try {
      const queued = await retryDownload(record.videoUrl);
      if (queued.queued) result.affected += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      console.error(error);
    }
  }

  return result;
}

function removeQueuedDownload(videoUrl: string): boolean {
  const queueIndex = downloadQueue.indexOf(videoUrl);
  if (queueIndex === -1) return false;
  downloadQueue.splice(queueIndex, 1);
  return true;
}

async function resumeDownload(value: unknown): Promise<EnqueueDownloadResult> {
  const videoUrl = normalizeDownloadVideoUrl(value, 'videoUrl', 'download:resume');
  const existing = videoUrl ? getPersistedDownload(videoUrl) : null;
  const existingRecord = existing ? downloadRecordWithRuntimeState(existing) : null;
  const existingState = existingRecord ? existingRecord.state : null;

  if (!existingRecord) throw new Error(t('status.downloadFileUnavailable'));
  if (existingState === 'queued' || existingState === 'downloading' || existingState === 'ready') {
    return {
      record: existingRecord,
      queued: false
    };
  }
  if (existingState !== 'paused') throw new Error(t('status.downloadResumeUnavailable'));

  await ffmpegCommandForDownload();
  ensureDownloadRootReady();

  canceledDownloadUrls.delete(videoUrl);
  pausedDownloadUrls.delete(videoUrl);
  resumedDownloadUrls.add(videoUrl);

  const record = upsertPersistedDownload({
    videoUrl: existingRecord.videoUrl,
    state: 'queued',
    progress: null,
    error: null,
    completedAt: null
  });
  queueDownloadRecord(record);

  return {
    record: record,
    queued: true
  };
}

async function resumePausedDownloads(): Promise<BulkDownloadActionResult> {
  const records = listDownloads().filter(function (record) {
    return record.state === 'paused';
  });
  const result: BulkDownloadActionResult = {
    requested: records.length,
    affected: 0,
    skipped: 0,
    failed: 0
  };

  for (const record of records) {
    try {
      const resumed = await resumeDownload(record.videoUrl);
      if (resumed.queued) result.affected += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      console.error(error);
    }
  }

  return result;
}

function pauseDownload(value: unknown): PauseDownloadResult {
  const videoUrl = normalizeDownloadVideoUrl(value, 'videoUrl', 'download:pause');
  const existing = videoUrl ? getPersistedDownload(videoUrl) : null;
  const currentRecord = existing ? downloadRecordWithRuntimeState(existing) : null;
  if (!currentRecord) throw new Error(t('status.downloadPauseUnavailable'));

  const runtime = activeDownloads.get(videoUrl) || null;
  const isActive = Boolean(runtime);
  const isQueued = removeQueuedDownload(videoUrl);
  if (!isActive && !isQueued && currentRecord.state !== 'paused') {
    throw new Error(t('status.downloadPauseUnavailable'));
  }

  canceledDownloadUrls.delete(videoUrl);
  pausedDownloadUrls.add(videoUrl);

  const record = upsertPersistedDownload({
    videoUrl: videoUrl,
    state: 'paused',
    progress: null,
    error: t('status.downloadPaused'),
    failurePhase: null,
    failureCode: null,
    lastErrorAt: null,
    completedAt: null
  });

  if (runtime) {
    runtime.abortController.abort();
    if (runtime.nativeId) getDownloadEngine().cancelDownload(runtime.nativeId);
    if (runtime.process) runtime.process.kill('SIGTERM');
  } else {
    removePartialDownloadFileForRecord(record);
  }

  notifyDownloadsChanged();

  return {
    paused: currentRecord.state !== 'paused',
    record: record
  };
}

function pauseAllDownloads(): BulkDownloadActionResult {
  const records = listDownloads().filter(function (record) {
    return record.state === 'queued' || record.state === 'downloading';
  });
  const result: BulkDownloadActionResult = {
    requested: records.length,
    affected: 0,
    skipped: 0,
    failed: 0
  };

  for (const record of records) {
    try {
      const paused = pauseDownload(record.videoUrl);
      if (paused.paused) result.affected += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      console.error(error);
    }
  }

  return result;
}

function cancelDownload(value: unknown): CancelDownloadResult {
  const videoUrl = normalizeDownloadVideoUrl(value, 'videoUrl', 'download:cancel');
  if (!videoUrl) throw new Error(t('status.downloadCancelUnavailable'));

  const existing = getPersistedDownload(videoUrl);
  const currentRecord = existing ? downloadRecordWithRuntimeState(existing) : null;
  if (!currentRecord) throw new Error(t('status.downloadCancelUnavailable'));

  const runtime = activeDownloads.get(videoUrl) || null;
  const isActive = Boolean(runtime);
  if (!isActive && currentRecord.state !== 'queued') throw new Error(t('status.downloadCancelUnavailable'));

  removeQueuedDownload(videoUrl);
  if (isActive) canceledDownloadUrls.add(videoUrl);
  pausedDownloadUrls.delete(videoUrl);
  resumedDownloadUrls.delete(videoUrl);

  const record = upsertPersistedDownload({
    videoUrl: videoUrl,
    state: 'failed',
    progress: null,
    error: t('status.downloadCanceled'),
    failurePhase: null,
    failureCode: 'download_canceled',
    lastErrorAt: downloadTimestamp(),
    completedAt: null
  });

  if (runtime) {
    runtime.abortController.abort();
    if (runtime.nativeId) getDownloadEngine().cancelDownload(runtime.nativeId);
    if (runtime.process) runtime.process.kill('SIGTERM');
  } else {
    removeDownloadWorkingFiles(currentRecord);
  }
  notifyDownloadsChanged();

  return {
    canceled: true,
    record: record
  };
}

function cancelQueuedDownloads(): BulkDownloadActionResult {
  const records = listDownloads().filter(function (record) {
    return record.state === 'queued';
  });
  const result: BulkDownloadActionResult = {
    requested: records.length,
    affected: 0,
    skipped: 0,
    failed: 0
  };

  for (const record of records) {
    try {
      cancelDownload(record.videoUrl);
      result.affected += 1;
    } catch (error) {
      result.failed += 1;
      console.error(error);
    }
  }

  return result;
}

function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  const targetPath = path.resolve(filePath);
  const rootPath = path.resolve(directoryPath);
  const normalizedTarget = process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
  const normalizedRoot = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath;

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
}

function deleteManagedDownloadFile(record: DownloadRecord): boolean {
  if (!record.localPath) return false;
  const filePath = resolveManagedDownloadPath(record.localPath);
  if (!filePath) throw new Error(t('status.downloadFileOutsideRoot'));

  let stats: NodeFs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch (error) {
    return false;
  }

  if (!stats.isFile()) throw new Error(t('status.downloadFileUnavailable'));

  fs.unlinkSync(filePath);
  return true;
}

function downloadRecordHasManagedFile(record: DownloadRecord): boolean {
  if (!record.localPath) return false;
  const filePath = resolveManagedDownloadPath(record.localPath);
  if (!filePath) return false;

  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

function confirmDeleteDownload(hasManagedFile: boolean): Promise<boolean> {
  return showAppDialog({
    type: 'warning',
    buttons: [t('dialog.deleteDownloadConfirm'), t('dialog.cancel')],
    defaultId: 1,
    cancelId: 1,
    title: t('dialog.deleteDownloadTitle'),
    message: hasManagedFile ? t('dialog.deleteDownloadMessage') : t('dialog.deleteDownloadRecordMessage')
  }).then(function (dialogResult: Electron.MessageBoxReturnValue) {
    return dialogResult.response === 0;
  });
}

function confirmDeleteDownloads(): Promise<boolean> {
  return showAppDialog({
    type: 'warning',
    buttons: [t('dialog.deleteDownloadsConfirm'), t('dialog.cancel')],
    defaultId: 1,
    cancelId: 1,
    title: t('dialog.deleteDownloadsTitle'),
    message: t('dialog.deleteDownloadsMessage')
  }).then(function (dialogResult: Electron.MessageBoxReturnValue) {
    return dialogResult.response === 0;
  });
}

function deleteDownloadRecord(visibleRecord: DownloadRecord): { deleted: boolean; removed: boolean } {
  const queueIndex = downloadQueue.indexOf(visibleRecord.videoUrl);
  if (queueIndex !== -1) downloadQueue.splice(queueIndex, 1);
  canceledDownloadUrls.delete(visibleRecord.videoUrl);
  pausedDownloadUrls.delete(visibleRecord.videoUrl);
  resumedDownloadUrls.delete(visibleRecord.videoUrl);

  const deleted = deleteManagedDownloadFile(visibleRecord);
  removeDownloadWorkingFiles(visibleRecord);
  const removed = removePersistedDownload(visibleRecord.videoUrl);

  return {
    deleted: deleted,
    removed: removed
  };
}

async function deleteDownload(value: unknown): Promise<DeleteDownloadResult> {
  const videoUrl = normalizeDownloadVideoUrl(value, 'videoUrl', 'download:delete');
  if (!videoUrl) throw new Error(t('status.downloadFileUnavailable'));

  if (activeDownloads.has(videoUrl)) throw new Error(t('status.downloadDeleteActiveBlocked'));

  const record = getPersistedDownload(videoUrl);
  const visibleRecord = record ? downloadRecordWithRuntimeState(record) : null;
  if (!visibleRecord) throw new Error(t('status.downloadFileUnavailable'));
  if (visibleRecord.state === 'downloading') throw new Error(t('status.downloadDeleteActiveBlocked'));

  const confirmed = await confirmDeleteDownload(downloadRecordHasManagedFile(visibleRecord));
  if (!confirmed) {
    return {
      deleted: false,
      removed: false,
      canceled: true
    };
  }

  const result = deleteDownloadRecord(visibleRecord);
  notifyDownloadsChanged();

  return {
    deleted: result.deleted,
    removed: result.removed
  };
}

async function deleteDownloads(value: unknown): Promise<DeleteDownloadsResult> {
  const videoUrls = normalizeDownloadVideoUrls(value, 'download:delete-many');
  const confirmed = await confirmDeleteDownloads();
  const result: DeleteDownloadsResult = {
    requested: videoUrls.length,
    deletedFiles: 0,
    removedRecords: 0,
    skipped: 0,
    failed: 0
  };

  if (!confirmed) {
    return Object.assign(result, {
      canceled: true
    });
  }

  for (const videoUrl of videoUrls) {
    if (activeDownloads.has(videoUrl)) {
      result.skipped += 1;
      continue;
    }

    const record = getPersistedDownload(videoUrl);
    const visibleRecord = record ? downloadRecordWithRuntimeState(record) : null;
    if (
      !visibleRecord ||
      (visibleRecord.state !== 'ready' &&
        visibleRecord.state !== 'paused' &&
        visibleRecord.state !== 'failed' &&
        visibleRecord.state !== 'missing')
    ) {
      result.skipped += 1;
      continue;
    }

    try {
      const deleted = deleteDownloadRecord(visibleRecord);
      if (deleted.deleted) result.deletedFiles += 1;
      if (deleted.removed) result.removedRecords += 1;
    } catch (error) {
      result.failed += 1;
      console.error(error);
    }
  }

  notifyDownloadsChanged();

  return result;
}

function openDownloadFile(value: unknown): Promise<OpenDownloadFileResult> {
  const videoUrl = normalizeDownloadVideoUrl(value, 'videoUrl', 'download:open-file');
  if (!videoUrl) throw new Error(t('status.downloadFileUnavailable'));

  const record = getPersistedDownload(videoUrl);
  const readyRecord = record ? reconcileDownloadRecordFileState(record) : null;
  if (!readyRecord || readyRecord.state !== 'ready' || !readyRecord.localPath) {
    throw new Error(t('status.downloadFileUnavailable'));
  }
  const filePath = resolveManagedDownloadPath(readyRecord.localPath);
  if (!filePath) throw new Error(t('status.downloadFileUnavailable'));

  return openShellPath(filePath).then(function () {
    return {
      opened: true,
      path: filePath
    };
  });
}

function revealDownloadFile(value: unknown): RevealDownloadFileResult {
  const videoUrl = normalizeDownloadVideoUrl(value, 'videoUrl', 'download:reveal-file');
  if (!videoUrl) throw new Error(t('status.downloadFileUnavailable'));

  const record = getPersistedDownload(videoUrl);
  const readyRecord = record ? reconcileDownloadRecordFileState(record) : null;
  if (!readyRecord || readyRecord.state !== 'ready' || !readyRecord.localPath) {
    throw new Error(t('status.downloadFileUnavailable'));
  }
  const filePath = resolveManagedDownloadPath(readyRecord.localPath);
  if (!filePath) throw new Error(t('status.downloadFileUnavailable'));

  revealShellPath(filePath);
  return {
    revealed: true,
    path: filePath
  };
}

function getDownloadEngine(): NativeDownloadEngineInstance {
  if (!downloadEngine) {
    const nativeModule = nativeDownloadEngineModule.loadNativeDownloadEngine();
    downloadEngine = new nativeModule.JableDownloadEngine();
  }

  return downloadEngine;
}

function hasQueuedOrActiveDownloads(): boolean {
  return downloadQueue.length > 0 || activeDownloads.size > 0;
}

function waitForActiveDownloadTasks(): Promise<void> {
  const tasks = Array.from(activeDownloadTasks.values());
  if (!tasks.length) return Promise.resolve();

  return Promise.all(
    tasks.map(function (task) {
      return task.catch(function () {});
    })
  ).then(function () {});
}

function pauseDownloadsForShutdown(): Promise<void> {
  const queuedUrls = downloadQueue.splice(0);

  for (const videoUrl of queuedUrls) {
    const record = getPersistedDownload(videoUrl);
    if (!record) continue;
    pausedDownloadUrls.add(videoUrl);
    upsertPersistedDownload({
      videoUrl: videoUrl,
      state: 'paused',
      progress: null,
      error: t('status.downloadPaused'),
      failurePhase: null,
      failureCode: null,
      lastErrorAt: null,
      completedAt: null
    });
  }

  for (const [videoUrl, runtime] of activeDownloads) {
    pausedDownloadUrls.add(videoUrl);
    upsertPersistedDownload({
      videoUrl: videoUrl,
      state: 'paused',
      progress: null,
      error: t('status.downloadPaused'),
      failurePhase: null,
      failureCode: null,
      lastErrorAt: null,
      completedAt: null
    });
    runtime.abortController.abort();
    if (runtime.nativeId && downloadEngine) downloadEngine.cancelDownload(runtime.nativeId);
    if (runtime.process) runtime.process.kill('SIGTERM');
  }

  if (queuedUrls.length || activeDownloads.size) notifyDownloadsChanged();
  return waitForActiveDownloadTasks();
}

function confirmPauseDownloadsBeforeClose(): Promise<boolean> {
  if (downloadClosePromptInFlight) return Promise.resolve(false);
  downloadClosePromptInFlight = true;

  return showAppDialog({
    type: 'warning',
    buttons: [t('dialog.pauseDownloadsAndClose'), t('dialog.returnToApp')],
    defaultId: 0,
    cancelId: 1,
    title: t('dialog.pauseDownloadsBeforeQuitTitle'),
    message: t('dialog.pauseDownloadsBeforeQuitMessage')
  })
    .then(function (dialogResult: Electron.MessageBoxReturnValue) {
      return dialogResult.response === 0;
    })
    .finally(function () {
      downloadClosePromptInFlight = false;
    });
}

export function createDownloadManager(context: DownloadManagerContext): DownloadManager {
  app = context.app;
  dialog = context.dialog;
  session = context.session;
  shell = context.shell;
  getAppSettings = context.getAppSettings;
  getDatabase = context.getDatabase;
  getMainWindow = context.getMainWindow;
  forwardBrowserMessage = context.forwardBrowserMessage;
  sendToAllBrowserTabs = context.sendToAllBrowserTabs;
  showAppDialog = context.showAppDialog;
  translate = context.t;
  updateAppSettings = context.updateAppSettings;

  return {
    cancelDownload: cancelDownload,
    cancelQueuedDownloads: cancelQueuedDownloads,
    chooseDownloadRoot: chooseDownloadRoot,
    chooseFfmpegPath: chooseFfmpegPath,
    clearDownloadRoot: clearDownloadRoot,
    clearFfmpegPath: clearFfmpegPath,
    confirmPauseDownloadsBeforeClose: confirmPauseDownloadsBeforeClose,
    deleteDownload: deleteDownload,
    deleteDownloads: deleteDownloads,
    getDownloadRoot: getDownloadRoot,
    getFfmpegStatus: getFfmpegStatus,
    handleLocalPlaybackRequest: handleLocalPlaybackRequest,
    hasQueuedOrActiveDownloads: hasQueuedOrActiveDownloads,
    localPlaybackSource: localPlaybackSource,
    listDownloads: listDownloads,
    openDownloadFile: openDownloadFile,
    openDownloadRoot: openDownloadRoot,
    pauseDownload: pauseDownload,
    pauseAllDownloads: pauseAllDownloads,
    pauseDownloadsForShutdown: pauseDownloadsForShutdown,
    processQueue: processDownloadQueue,
    resumeDownload: resumeDownload,
    resumePausedDownloads: resumePausedDownloads,
    retryDownload: retryDownload,
    retryFailedDownloads: retryFailedDownloads,
    revealDownloadFile: revealDownloadFile,
    setDownloadRoot: setDownloadRoot,
    setFfmpegPath: setFfmpegPath,
    enqueueDownload: enqueueDownload
  };
}
