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
  RevealDownloadFileResult,
  VideoMetadataRefreshPayload
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
type HlsPlaybackCapturePlan = {
  videoUrl: string;
  playlistUrl: string;
  segmentCount: number;
  segments: Array<{
    url: string;
    filePath: string;
  }>;
};
type HlsPlaybackCapturePreparePayload = {
  videoUrl: string;
  pageLoadId?: string | null;
  title: string | null;
  views: number | null;
  likes: number | null;
  img: string | null;
  preview: string | null;
  playlistUrl: string;
  playlistText: string;
};
type HlsPlaybackCaptureSegmentPayload = {
  videoUrl: string;
  pageLoadId?: string | null;
  filePath: string;
};
type HlsPlaybackCaptureCompletePayload = {
  videoUrl: string;
  pageLoadId?: string | null;
};
type DownloadDataStore = {
  listDownloadAssets(): DownloadRecord[];
  getDownloadAsset(videoUrl: string): DownloadRecord | null;
  upsertVideoMetadata(payload: VideoMetadataRefreshPayload): { updated: boolean; url: string };
  upsertDownloadAsset(patch: DownloadRecordPatch): DownloadRecord;
  removeDownloadAsset(videoUrl: string): boolean;
};
type LocalPlaybackFile = {
  record: DownloadRecord;
  filePath: string;
  stats: NodeFs.Stats;
};
type LocalPlaybackSourceRequest = {
  videoUrl: string | null;
  sourcePageChineseSubtitleNotice: boolean | null;
};
type SourcePageChineseSubtitleNotice = {
  sourcePageChineseSubtitleNotice: boolean;
  sourcePageSubtitleNoticeText: string | null;
};
type LocalPlaybackPreviewCue = {
  start: number;
  end: number;
  fileName: string;
};
type LocalPlaybackPreviewMetadata = {
  version: 1;
  intervalSeconds: number;
  width: number;
  height: number;
  fileSizeBytes: number;
  mtimeMs: number;
  cues: LocalPlaybackPreviewCue[];
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
  completeHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): void;
  prepareHlsPlaybackCapture(value: HlsPlaybackCapturePreparePayload): HlsPlaybackCapturePlan | null;
  pauseDownloadsForShutdown(): Promise<void>;
  processQueue(): void;
  recordHlsPlaybackCaptureSegment(value: HlsPlaybackCaptureSegmentPayload): void;
  shouldProxyHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): boolean;
  shouldContinueHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload): boolean;
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
const LOCAL_PLAYBACK_PREVIEW_INTERVAL_SECONDS = 60;
const LOCAL_PLAYBACK_PREVIEW_WIDTH = 213;
const LOCAL_PLAYBACK_PREVIEW_HEIGHT = 120;
const CHINESE_SUBTITLE_NOTICE_TOKEN = '中文字幕版';
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
const localPlaybackPreviewQueue: string[] = [];
const localPlaybackPreviewQueuedUrls = new Set<string>();
const localPlaybackPreviewFailedKeys = new Set<string>();
const hlsPlaybackCaptureProgressNotifications = new Map<
  string,
  { captured: number; notifiedAt: number; total: number }
>();
const hlsPlaybackCaptureActiveDownloadUrls = new Set<string>();
const hlsPlaybackCaptureActivePageLoadIds = new Map<string, string>();
const hlsPlaybackCaptureAutoQueuedUrls = new Set<string>();
const hlsPlaybackCaptureRuntimeProgress = new Map<string, number>();
const hlsPlaybackCaptureSuppressedPageLoadIds = new Map<string, string | null>();
let activeLocalPlaybackPreviewTask: Promise<void> | null = null;

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

function upsertDownloadVideoMetadata(payload: DownloadRequestPayload) {
  getDatabase().upsertVideoMetadata({
    url: payload.video.url,
    title: payload.video.title,
    views: payload.video.views,
    likes: payload.video.likes,
    img: payload.video.img,
    preview: payload.video.preview
  });
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
  const isCapturingPlayback = hlsPlaybackCaptureActiveDownloadUrls.has(fileRecord.videoUrl);
  const isQueued = downloadQueue.indexOf(fileRecord.videoUrl) !== -1;
  if (isActive || isCapturingPlayback || isQueued) return fileRecord;

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

  const hlsPlaybackProgress = hlsPlaybackCaptureRuntimeProgress.get(record.videoUrl);
  if (typeof hlsPlaybackProgress === 'number') {
    return Object.assign({}, record, {
      progress: hlsPlaybackProgress
    });
  }

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

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, function (_match, entity) {
    const normalized = String(entity).toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    if (normalized === 'nbsp') return ' ';

    const radix = normalized.startsWith('#x') ? 16 : 10;
    const text = normalized.startsWith('#x') ? normalized.slice(2) : normalized.slice(1);
    const codePoint = parseInt(text, radix);
    if (!Number.isFinite(codePoint)) return _match;

    try {
      return String.fromCodePoint(codePoint);
    } catch (error) {
      return _match;
    }
  });
}

function normalizeSourcePageText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function classAttributeHasNoticeClasses(attrs: string): boolean {
  const match = attrs.match(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!match) return false;

  const classes = match[2].split(/\s+/);
  return classes.indexOf('desc') !== -1 && classes.indexOf('h6-md') !== -1;
}

export function sourcePageChineseSubtitleNoticeTextFromHtml(html: string): string | null {
  const h5Pattern = /<h5\b([^>]*)>([\s\S]*?)<\/h5>/gi;
  let match: RegExpExecArray | null;

  while ((match = h5Pattern.exec(html))) {
    if (!classAttributeHasNoticeClasses(match[1])) continue;

    const text = normalizeSourcePageText(match[2]);
    if (text.indexOf(CHINESE_SUBTITLE_NOTICE_TOKEN) !== -1) return text;
  }

  return null;
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

function localPlaybackPreviewDirectory(outputPath: string): string {
  return outputPath + '.preview';
}

function localPlaybackPreviewTempDirectory(outputPath: string): string {
  return outputPath + '.preview.tmp';
}

function localPlaybackPreviewMetadataPath(previewDir: string): string {
  return path.join(previewDir, 'metadata.json');
}

function isLocalPlaybackPreviewImageFileName(value: string): boolean {
  return /^thumb-\d{6}\.jpg$/.test(value);
}

function removeDirectoryIfPresent(dirPath: string) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (error) {}
}

function removeLocalPlaybackPreviewFiles(record: DownloadRecord) {
  const outputPath = resolveManagedDownloadPath(record.localPath);
  if (!outputPath) return;
  removeDirectoryIfPresent(localPlaybackPreviewDirectory(outputPath));
  removeDirectoryIfPresent(localPlaybackPreviewTempDirectory(outputPath));
}

function localPlaybackPreviewIdentity(file: LocalPlaybackFile) {
  return {
    fileSizeBytes: file.stats.size,
    mtimeMs: Math.trunc(file.stats.mtimeMs)
  };
}

function localPlaybackPreviewGenerationKey(file: LocalPlaybackFile): string {
  const identity = localPlaybackPreviewIdentity(file);
  return [file.record.videoUrl, file.filePath, identity.fileSizeBytes, identity.mtimeMs].join('\n');
}

function localPlaybackPreviewMetadataMatchesFile(
  metadata: LocalPlaybackPreviewMetadata,
  file: LocalPlaybackFile
): boolean {
  const identity = localPlaybackPreviewIdentity(file);
  return metadata.fileSizeBytes === identity.fileSizeBytes && metadata.mtimeMs === identity.mtimeMs;
}

function localPlaybackFileMatchesPreviewSource(file: LocalPlaybackFile): boolean {
  const current = localPlaybackReadyFile(file.record.videoUrl);
  if (!current || current.filePath !== file.filePath) return false;

  const original = localPlaybackPreviewIdentity(file);
  const latest = localPlaybackPreviewIdentity(current);
  return original.fileSizeBytes === latest.fileSizeBytes && original.mtimeMs === latest.mtimeMs;
}

function normalizeLocalPlaybackPreviewMetadata(value: unknown): LocalPlaybackPreviewMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const metadata = value as Partial<LocalPlaybackPreviewMetadata>;
  if (metadata.version !== 1) return null;
  if (metadata.intervalSeconds !== LOCAL_PLAYBACK_PREVIEW_INTERVAL_SECONDS) return null;
  if (metadata.width !== LOCAL_PLAYBACK_PREVIEW_WIDTH || metadata.height !== LOCAL_PLAYBACK_PREVIEW_HEIGHT) return null;
  if (typeof metadata.fileSizeBytes !== 'number' || typeof metadata.mtimeMs !== 'number') return null;
  if (!Array.isArray(metadata.cues) || !metadata.cues.length) return null;

  const cues: LocalPlaybackPreviewCue[] = [];
  for (const cue of metadata.cues) {
    if (!cue || typeof cue !== 'object') return null;
    const candidate = cue as Partial<LocalPlaybackPreviewCue>;
    if (typeof candidate.start !== 'number' || typeof candidate.end !== 'number') return null;
    if (typeof candidate.fileName !== 'string' || !isLocalPlaybackPreviewImageFileName(candidate.fileName)) {
      return null;
    }
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

function readLocalPlaybackPreviewMetadata(file: LocalPlaybackFile): LocalPlaybackPreviewMetadata | null {
  let metadata: LocalPlaybackPreviewMetadata | null;
  const previewDir = localPlaybackPreviewDirectory(file.filePath);

  try {
    metadata = normalizeLocalPlaybackPreviewMetadata(
      JSON.parse(fs.readFileSync(localPlaybackPreviewMetadataPath(previewDir), 'utf8'))
    );
  } catch (error) {
    return null;
  }

  if (!metadata || !localPlaybackPreviewMetadataMatchesFile(metadata, file)) return null;

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

function localPlaybackPreviewVttText(metadata: LocalPlaybackPreviewMetadata): string {
  const lines = ['WEBVTT', ''];
  for (const cue of metadata.cues) {
    lines.push(formatVttTimestamp(cue.start) + ' --> ' + formatVttTimestamp(cue.end));
    lines.push(cue.fileName);
    lines.push('');
  }
  return lines.join('\n');
}

function localPlaybackPreviewVttUrl(token: string): string {
  return LOCAL_PLAYBACK_SCHEME + '://thumb/' + token + '/thumb.vtt';
}

function localPlaybackPreviewMetadataForFiles(
  file: LocalPlaybackFile,
  fileNames: string[]
): LocalPlaybackPreviewMetadata {
  const identity = localPlaybackPreviewIdentity(file);
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

function generatedLocalPlaybackPreviewFiles(tempDir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(tempDir);
  } catch (error) {
    return [];
  }

  return entries.filter(isLocalPlaybackPreviewImageFileName).sort();
}

function writeLocalPlaybackPreviewMetadata(file: LocalPlaybackFile, tempDir: string, fileNames: string[]) {
  const metadata = localPlaybackPreviewMetadataForFiles(file, fileNames);
  fs.writeFileSync(localPlaybackPreviewMetadataPath(tempDir), JSON.stringify(metadata, null, 2));
}

function generateLocalPlaybackPreviewFiles(command: string, file: LocalPlaybackFile): Promise<void> {
  return new Promise(function (resolve, reject) {
    const tempDir = localPlaybackPreviewTempDirectory(file.filePath);
    const previewDir = localPlaybackPreviewDirectory(file.filePath);
    removeDirectoryIfPresent(tempDir);
    fs.mkdirSync(tempDir, { recursive: true });

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
    let stderr = '';

    child.stderr.on('data', function (chunk) {
      stderr = (stderr + String(chunk)).slice(-4000);
    });
    child.on('error', function (error) {
      removeDirectoryIfPresent(tempDir);
      reject(new FfmpegDownloadError(mainErrorMessage(error)));
    });
    child.on('close', function (code) {
      if (code !== 0) {
        removeDirectoryIfPresent(tempDir);
        reject(new FfmpegDownloadError(stderr.trim() || 'FFmpeg exited with code ' + code));
        return;
      }

      try {
        const fileNames = generatedLocalPlaybackPreviewFiles(tempDir);
        if (!fileNames.length) throw new FfmpegDownloadError('FFmpeg did not generate playback preview thumbnails');
        if (!localPlaybackFileMatchesPreviewSource(file)) {
          removeDirectoryIfPresent(tempDir);
          resolve();
          return;
        }

        writeLocalPlaybackPreviewMetadata(file, tempDir, fileNames);
        removeDirectoryIfPresent(previewDir);
        fs.renameSync(tempDir, previewDir);
        resolve();
      } catch (error) {
        removeDirectoryIfPresent(tempDir);
        reject(error);
      }
    });
  });
}

function localPlaybackFileLooksLikeMp4(filePath: string): boolean {
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

async function runLocalPlaybackPreviewGeneration(videoUrl: string): Promise<void> {
  const readyFile = localPlaybackReadyFile(videoUrl);
  if (!readyFile || readLocalPlaybackPreviewMetadata(readyFile)) return;
  if (!localPlaybackFileLooksLikeMp4(readyFile.filePath)) return;

  const generationKey = localPlaybackPreviewGenerationKey(readyFile);
  if (localPlaybackPreviewFailedKeys.has(generationKey)) return;

  try {
    const command = await ffmpegCommandForDownload();
    await generateLocalPlaybackPreviewFiles(command, readyFile);
    localPlaybackPreviewFailedKeys.delete(generationKey);
    notifyDownloadsChanged();
  } catch (error) {
    localPlaybackPreviewFailedKeys.add(generationKey);
    console.warn('[local-playback-preview] ' + mainErrorMessage(error));
  }
}

function processLocalPlaybackPreviewQueue() {
  if (activeLocalPlaybackPreviewTask) return;

  const videoUrl = localPlaybackPreviewQueue.shift();
  if (!videoUrl) return;

  activeLocalPlaybackPreviewTask = runLocalPlaybackPreviewGeneration(videoUrl).finally(function () {
    localPlaybackPreviewQueuedUrls.delete(videoUrl);
    activeLocalPlaybackPreviewTask = null;
    processLocalPlaybackPreviewQueue();
  });
}

function scheduleLocalPlaybackPreviewGeneration(file: LocalPlaybackFile) {
  const videoUrl = file.record.videoUrl;
  if (localPlaybackPreviewQueuedUrls.has(videoUrl)) return;
  if (!localPlaybackFileLooksLikeMp4(file.filePath)) return;
  if (localPlaybackPreviewFailedKeys.has(localPlaybackPreviewGenerationKey(file))) return;

  localPlaybackPreviewQueuedUrls.add(videoUrl);
  localPlaybackPreviewQueue.push(videoUrl);
  processLocalPlaybackPreviewQueue();
}

function removeQueuedLocalPlaybackPreviewGeneration(videoUrl: string) {
  const queueIndex = localPlaybackPreviewQueue.indexOf(videoUrl);
  if (queueIndex !== -1) localPlaybackPreviewQueue.splice(queueIndex, 1);
  if (queueIndex !== -1 || !activeLocalPlaybackPreviewTask) localPlaybackPreviewQueuedUrls.delete(videoUrl);

  for (const key of localPlaybackPreviewFailedKeys) {
    if (key.startsWith(videoUrl + '\n')) localPlaybackPreviewFailedKeys.delete(key);
  }
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

function localPlaybackRequestTargetFromUrl(value: unknown): LocalPlaybackRequestTarget | null {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== LOCAL_PLAYBACK_SCHEME + ':') return null;

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

function normalizeLocalPlaybackSourceRequest(value: unknown): LocalPlaybackSourceRequest {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as {
      videoUrl?: unknown;
      sourcePageChineseSubtitleNotice?: unknown;
    };
    const notice =
      typeof record.sourcePageChineseSubtitleNotice === 'boolean' ? record.sourcePageChineseSubtitleNotice : null;
    return {
      videoUrl: urlPolicy.canonicalJableVideoUrl(record.videoUrl),
      sourcePageChineseSubtitleNotice: notice
    };
  }

  return {
    videoUrl: urlPolicy.canonicalJableVideoUrl(value),
    sourcePageChineseSubtitleNotice: null
  };
}

function localPlaybackSource(value: unknown): LocalPlaybackSourceResult {
  const request = normalizeLocalPlaybackSourceRequest(value);
  const videoUrl = request.videoUrl;
  if (!videoUrl) return localPlaybackUnavailable(null, 'not_video');

  const record = getPersistedDownload(videoUrl);
  if (!record) return localPlaybackUnavailable(videoUrl, 'not_ready');

  const readyRecord = reconcileDownloadRecordFileState(record);
  if (readyRecord.state === 'missing') return localPlaybackUnavailable(videoUrl, 'missing');
  if (readyRecord.state !== 'ready') return localPlaybackUnavailable(videoUrl, 'not_ready');
  if (
    request.sourcePageChineseSubtitleNotice !== null &&
    readyRecord.sourcePageChineseSubtitleNotice !== request.sourcePageChineseSubtitleNotice
  ) {
    return localPlaybackUnavailable(videoUrl, 'source_page_changed');
  }

  const readyFile = localPlaybackReadyFile(videoUrl);
  if (!readyFile) return localPlaybackUnavailable(videoUrl, 'unavailable');

  const token = createLocalPlaybackToken(readyFile.record.videoUrl);
  const previewMetadata = readLocalPlaybackPreviewMetadata(readyFile);
  if (!previewMetadata) scheduleLocalPlaybackPreviewGeneration(readyFile);

  return {
    available: true,
    videoUrl: readyFile.record.videoUrl,
    sourceUrl: localPlaybackTokenUrl(token),
    thumbnailVttUrl: previewMetadata ? localPlaybackPreviewVttUrl(token) : null,
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

function localPlaybackPreviewVttResponse(file: LocalPlaybackFile, request: Request): Response {
  const metadata = readLocalPlaybackPreviewMetadata(file);
  if (!metadata) return localPlaybackErrorResponse(404, 'Not Found');

  const body = request.method.toUpperCase() === 'HEAD' ? null : localPlaybackPreviewVttText(metadata);
  return localPlaybackResponse(200, body, {
    'cache-control': 'private, max-age=1800',
    'content-type': 'text/vtt; charset=utf-8'
  });
}

function localPlaybackPreviewImageResponse(
  file: LocalPlaybackFile,
  target: Extract<LocalPlaybackRequestTarget, { type: 'preview-image' }>,
  request: Request
): Response {
  const metadata = readLocalPlaybackPreviewMetadata(file);
  if (
    !metadata ||
    !metadata.cues.some(function (cue) {
      return cue.fileName === target.fileName;
    })
  ) {
    return localPlaybackErrorResponse(404, 'Not Found');
  }

  const filePath = path.join(localPlaybackPreviewDirectory(file.filePath), target.fileName);
  let stats: NodeFs.Stats;
  try {
    stats = fs.statSync(filePath);
    if (!stats.isFile()) return localPlaybackErrorResponse(404, 'Not Found');
  } catch (error) {
    return localPlaybackErrorResponse(404, 'Not Found');
  }

  const headers = {
    'cache-control': 'private, max-age=1800',
    'content-length': String(stats.size),
    'content-type': 'image/jpeg'
  };
  if (request.method.toUpperCase() === 'HEAD') return localPlaybackResponse(200, null, headers);

  const fileStream = fs.createReadStream(filePath);
  const body = stream.Readable.toWeb(fileStream) as unknown as LocalPlaybackResponseBody;
  return localPlaybackResponse(200, body, headers);
}

async function handleLocalPlaybackRequest(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return localPlaybackErrorResponse(405, 'Method Not Allowed');
  }

  const target = localPlaybackRequestTargetFromUrl(request.url);
  if (!target) return localPlaybackErrorResponse(404, 'Not Found');

  const videoUrl = videoUrlForLocalPlaybackToken(target.token);
  if (!videoUrl) return localPlaybackErrorResponse(404, 'Not Found');

  const readyFile = localPlaybackReadyFile(videoUrl);
  if (!readyFile) return localPlaybackErrorResponse(404, 'Not Found');

  if (target.type === 'preview-vtt') return localPlaybackPreviewVttResponse(readyFile, request);
  if (target.type === 'preview-image') return localPlaybackPreviewImageResponse(readyFile, target, request);
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

function playbackCaptureDownloadPayload(
  videoUrl: string,
  metadata: {
    title: string | null;
    views: number | null;
    likes: number | null;
    img: string | null;
    preview: string | null;
  }
): DownloadRequestPayload {
  const cleanTitle = playbackCaptureCleanTitle(metadata.title);

  return {
    collectionKey: 'favourites',
    video: {
      title: cleanTitle || videoUrlSlug(videoUrl),
      url: videoUrl,
      views: metadata.views,
      likes: metadata.likes,
      img: metadata.img,
      preview: metadata.preview
    }
  };
}

function playbackCaptureCleanTitle(value: string | null): string | null {
  if (!value) return null;
  const title = value
    .replace(/\s+/g, ' ')
    .replace(/\s*[-|]\s*Jable\.TV\b.*$/i, '')
    .trim();
  return title || null;
}

function playbackCaptureMetadata(value: Partial<HlsPlaybackCapturePreparePayload> | null | undefined) {
  return {
    title: typeof value?.title === 'string' && value.title.trim() ? value.title.trim() : null,
    views: typeof value?.views === 'number' && Number.isFinite(value.views) ? value.views : null,
    likes: typeof value?.likes === 'number' && Number.isFinite(value.likes) ? value.likes : null,
    img: typeof value?.img === 'string' && value.img.trim() ? value.img.trim() : null,
    preview: typeof value?.preview === 'string' && value.preview.trim() ? value.preview.trim() : null
  };
}

function playbackCapturePageLoadId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function playbackCaptureSegmentFiles(outputPath: string, playlist: HlsPlaylist): HlsPlaybackCapturePlan['segments'] {
  const tempDir = downloadSegmentTempDirectory(outputPath);
  return playlist.segments.map(function (segment, index) {
    return {
      url: segment.url,
      filePath: path.join(tempDir, segmentFileName(index, segment.url))
    };
  });
}

function suppressHlsPlaybackCapture(videoUrl: string) {
  hlsPlaybackCaptureActiveDownloadUrls.delete(videoUrl);
  hlsPlaybackCaptureRuntimeProgress.delete(videoUrl);
  hlsPlaybackCaptureProgressNotifications.delete(videoUrl);
  hlsPlaybackCaptureSuppressedPageLoadIds.set(videoUrl, hlsPlaybackCaptureActivePageLoadIds.get(videoUrl) || null);
}

function allowHlsPlaybackCapture(videoUrl: string) {
  hlsPlaybackCaptureSuppressedPageLoadIds.delete(videoUrl);
}

function hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl: string, pageLoadId: string | null): boolean {
  if (!hlsPlaybackCaptureSuppressedPageLoadIds.has(videoUrl)) return false;

  const suppressedPageLoadId = hlsPlaybackCaptureSuppressedPageLoadIds.get(videoUrl) || null;
  if (!suppressedPageLoadId) {
    hlsPlaybackCaptureSuppressedPageLoadIds.delete(videoUrl);
    return false;
  }
  if (!pageLoadId) return true;
  if (suppressedPageLoadId === pageLoadId) return true;

  hlsPlaybackCaptureSuppressedPageLoadIds.delete(videoUrl);
  return false;
}

function prepareHlsPlaybackCapture(value: HlsPlaybackCapturePreparePayload): HlsPlaybackCapturePlan | null {
  const videoUrl = urlPolicy.canonicalJableVideoUrl(value && value.videoUrl);
  const pageLoadId = playbackCapturePageLoadId(value && value.pageLoadId);
  const playlistUrl = typeof value.playlistUrl === 'string' ? value.playlistUrl : '';
  const playlistText = typeof value.playlistText === 'string' ? value.playlistText : '';
  const metadata = playbackCaptureMetadata(value);
  if (!videoUrl || !playlistUrl || !playlistText) return null;
  if (hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, pageLoadId)) return null;

  let playlist: HlsPlaylist;
  try {
    playlist = downloadHelpers.parseHlsPlaylist(playlistText, playlistUrl);
  } catch (error) {
    return null;
  }
  if (!playlist.segments.length) return null;

  const existing = getPersistedDownload(videoUrl);
  const existingRecord = existing ? downloadRecordWithRuntimeState(existing) : null;
  if (
    existingRecord &&
    (existingRecord.state === 'queued' || existingRecord.state === 'downloading' || existingRecord.state === 'ready')
  ) {
    return null;
  }

  try {
    ensureDownloadRootReady();
  } catch (error) {
    return null;
  }

  const localPath =
    existingRecord && existingRecord.localPath && resolveManagedDownloadPath(existingRecord.localPath)
      ? existingRecord.localPath
      : downloadOutputRelativePath(playbackCaptureDownloadPayload(videoUrl, metadata));
  const outputPath = resolveManagedDownloadPath(localPath);
  if (!outputPath) return null;

  try {
    prepareDownloadSegmentTempDirectory(outputPath, playlist, true);
  } catch (error) {
    return null;
  }

  const payload = playbackCaptureDownloadPayload(videoUrl, metadata);
  const activePlaybackDownload = Boolean(getAppSettings().autoDownloadOnPlayback);
  if (pageLoadId) hlsPlaybackCaptureActivePageLoadIds.set(videoUrl, pageLoadId);
  if (activePlaybackDownload) hlsPlaybackCaptureActiveDownloadUrls.add(videoUrl);
  upsertDownloadVideoMetadata(payload);
  upsertPersistedDownload({
    videoUrl: videoUrl,
    title:
      existingRecord && existingRecord.title
        ? playbackCaptureCleanTitle(existingRecord.title) || payload.video.title
        : payload.video.title,
    img: payload.video.img || (existingRecord ? existingRecord.img : null),
    preview: payload.video.preview || (existingRecord ? existingRecord.preview : null),
    localPath: localPath,
    state: activePlaybackDownload ? 'downloading' : 'paused',
    progress: existingRecord && typeof existingRecord.progress === 'number' ? existingRecord.progress : 0,
    error: null,
    failurePhase: null,
    failureCode: null,
    lastStartedAt: activePlaybackDownload
      ? existingRecord && existingRecord.lastStartedAt
        ? existingRecord.lastStartedAt
        : downloadTimestamp()
      : existingRecord
        ? existingRecord.lastStartedAt
        : null,
    completedAt: null
  });
  notifyDownloadsChanged();

  return {
    videoUrl: videoUrl,
    playlistUrl: playlistUrl,
    segmentCount: playlist.segments.length,
    segments: playbackCaptureSegmentFiles(outputPath, playlist)
  };
}

function capturedPlaybackSegmentCount(outputPath: string): number {
  return reusableSegmentFileCount(outputPath, {
    variants: [],
    segments: playbackCaptureSegmentUrlsFromResumeManifest(outputPath),
    targetDuration: null
  });
}

function playbackCaptureSegmentUrlsFromResumeManifest(outputPath: string): HlsSegment[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(downloadResumeManifestPath(outputPath), 'utf8'));
  } catch (error) {
    return [];
  }

  const segments = manifest && typeof manifest === 'object' ? (manifest as { segments?: unknown }).segments : null;
  if (!Array.isArray(segments)) return [];

  return segments.map(function (segment, index) {
    const record = segment && typeof segment === 'object' ? (segment as { extension?: unknown }) : {};
    const extension = typeof record.extension === 'string' && record.extension ? record.extension : 'ts';
    return {
      url: 'playback-capture-segment-' + String(index + 1) + '.' + extension,
      duration: null,
      key: null
    };
  });
}

function shouldNotifyHlsPlaybackCaptureProgress(videoUrl: string, captured: number, total: number): boolean {
  const now = Date.now();
  const previous = hlsPlaybackCaptureProgressNotifications.get(videoUrl) || null;
  const shouldNotify =
    !previous ||
    captured >= total ||
    total !== previous.total ||
    now - previous.notifiedAt >= DOWNLOAD_PROGRESS_NOTIFY_INTERVAL_MS;
  if (!shouldNotify) return false;

  hlsPlaybackCaptureProgressNotifications.set(videoUrl, {
    captured: captured,
    notifiedAt: now,
    total: total
  });
  return true;
}

function queueCompletedHlsPlaybackCapture(record: DownloadRecord, captured: number, total: number) {
  if (!getAppSettings().autoDownloadOnPlayback) return;
  if (captured < total || (record.state !== 'paused' && record.state !== 'downloading')) return;
  if (hlsPlaybackCaptureAutoQueuedUrls.has(record.videoUrl)) return;
  if (downloadQueue.indexOf(record.videoUrl) !== -1 || activeDownloads.has(record.videoUrl)) return;

  hlsPlaybackCaptureAutoQueuedUrls.add(record.videoUrl);
  hlsPlaybackCaptureActiveDownloadUrls.delete(record.videoUrl);
  hlsPlaybackCaptureRuntimeProgress.delete(record.videoUrl);
  hlsPlaybackCaptureProgressNotifications.delete(record.videoUrl);
  resumedDownloadUrls.add(record.videoUrl);
  const queued = upsertPersistedDownload({
    videoUrl: record.videoUrl,
    state: 'queued',
    progress: null,
    error: null,
    failurePhase: null,
    failureCode: null,
    completedAt: null
  });
  queueDownloadRecord(queued);
}

function recordHlsPlaybackCaptureSegment(value: HlsPlaybackCaptureSegmentPayload) {
  const videoUrl = urlPolicy.canonicalJableVideoUrl(value && value.videoUrl);
  const pageLoadId = playbackCapturePageLoadId(value && value.pageLoadId);
  const filePath = typeof value.filePath === 'string' ? value.filePath : '';
  if (!videoUrl || !filePath) return;
  if (hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, pageLoadId)) return;

  const record = getPersistedDownload(videoUrl);
  if (!record || !record.localPath) return;

  const outputPath = resolveManagedDownloadPath(record.localPath);
  if (!outputPath) return;

  const tempDir = downloadSegmentTempDirectory(outputPath);
  if (!isPathInsideDirectory(filePath, tempDir)) return;

  const segments = playbackCaptureSegmentUrlsFromResumeManifest(outputPath);
  if (!segments.length) return;

  const captured = capturedPlaybackSegmentCount(outputPath);
  const progress = Math.max(0, Math.min(1, captured / segments.length));
  if (record.state === 'downloading' && hlsPlaybackCaptureActiveDownloadUrls.has(videoUrl)) {
    hlsPlaybackCaptureRuntimeProgress.set(videoUrl, progress);
    if (shouldNotifyHlsPlaybackCaptureProgress(videoUrl, captured, segments.length)) notifyDownloadsChanged();
    queueCompletedHlsPlaybackCapture(downloadRecordWithRuntimeProgress(record), captured, segments.length);
    return;
  }

  const updated = upsertPersistedDownload({
    videoUrl: videoUrl,
    state: record.state === 'failed' || record.state === 'missing' ? 'paused' : record.state,
    progress: progress,
    error: null,
    failurePhase: null,
    failureCode: null
  });

  if (shouldNotifyHlsPlaybackCaptureProgress(videoUrl, captured, segments.length)) notifyDownloadsChanged();
  queueCompletedHlsPlaybackCapture(updated, captured, segments.length);
}

function completeHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload) {
  const videoUrl = urlPolicy.canonicalJableVideoUrl(value && value.videoUrl);
  const pageLoadId = playbackCapturePageLoadId(value && value.pageLoadId);
  if (!videoUrl) return;

  hlsPlaybackCaptureActiveDownloadUrls.delete(videoUrl);
  hlsPlaybackCaptureRuntimeProgress.delete(videoUrl);
  hlsPlaybackCaptureProgressNotifications.delete(videoUrl);
  if (hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, pageLoadId)) return;

  const record = getPersistedDownload(videoUrl);
  if (!record || !record.localPath) return;

  const outputPath = resolveManagedDownloadPath(record.localPath);
  if (!outputPath) return;

  const segments = playbackCaptureSegmentUrlsFromResumeManifest(outputPath);
  if (!segments.length) return;

  const captured = capturedPlaybackSegmentCount(outputPath);
  const progress = Math.max(0, Math.min(1, captured / segments.length));
  const current = getPersistedDownload(videoUrl);
  if (!current) return;

  if (captured >= segments.length) {
    queueCompletedHlsPlaybackCapture(current, captured, segments.length);
    return;
  }

  upsertPersistedDownload({
    videoUrl: videoUrl,
    state: 'paused',
    progress: progress,
    error: null,
    failurePhase: null,
    failureCode: null
  });
  notifyDownloadsChanged();
}

function shouldContinueHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload) {
  const videoUrl = urlPolicy.canonicalJableVideoUrl(value && value.videoUrl);
  const pageLoadId = playbackCapturePageLoadId(value && value.pageLoadId);
  if (!videoUrl || hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, pageLoadId)) return false;

  const record = getPersistedDownload(videoUrl);
  if (!record || !record.localPath) return false;
  return record.state === 'downloading' || hlsPlaybackCaptureActiveDownloadUrls.has(videoUrl);
}

function shouldProxyHlsPlaybackCapture(value: HlsPlaybackCaptureCompletePayload) {
  const videoUrl = urlPolicy.canonicalJableVideoUrl(value && value.videoUrl);
  const pageLoadId = playbackCapturePageLoadId(value && value.pageLoadId);
  if (!videoUrl) return false;
  return !hlsPlaybackCaptureIsSuppressedForPageLoad(videoUrl, pageLoadId);
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
  throwIfDownloadCanceled(videoUrl);
  if (setFailurePhase) setFailurePhase('playlist');
  const playlistUrl = downloadHelpers.extractHlsPlaylistUrl(html, videoUrl);
  if (!playlistUrl) throw new HlsPlaylistNotFoundError();
  throwIfDownloadCanceled(videoUrl);
  const playlist = await resolveHlsMediaPlaylist(playlistUrl, videoUrl, cookieHeader, signal);
  return {
    cookieHeader: cookieHeader,
    playlist: playlist,
    sourcePageChineseSubtitleNotice: sourcePageNotice.sourcePageChineseSubtitleNotice,
    sourcePageSubtitleNoticeText: sourcePageNotice.sourcePageSubtitleNoticeText
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
    const source = await resolveDownloadHlsSource(
      record.videoUrl,
      abortController.signal,
      function (phase) {
        failurePhase = phase;
      },
      function (notice) {
        upsertPersistedDownload({
          videoUrl: record.videoUrl,
          sourcePageChineseSubtitleNotice: notice.sourcePageChineseSubtitleNotice,
          sourcePageSubtitleNoticeText: notice.sourcePageSubtitleNoticeText
        });
        notifyDownloadsChanged();
      }
    );
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
      sourcePageChineseSubtitleNotice: source.sourcePageChineseSubtitleNotice,
      sourcePageSubtitleNoticeText: source.sourcePageSubtitleNoticeText,
      failurePhase: null,
      failureCode: null,
      lastErrorAt: null,
      completedAt: downloadTimestamp()
    });
    notifyDownloadsChanged();

    const readyFile = localPlaybackReadyFile(record.videoUrl);
    if (readyFile) scheduleLocalPlaybackPreviewGeneration(readyFile);
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
    hlsPlaybackCaptureRuntimeProgress.delete(record.videoUrl);
    hlsPlaybackCaptureProgressNotifications.delete(record.videoUrl);
    canceledDownloadUrls.delete(record.videoUrl);
    pausedDownloadUrls.delete(record.videoUrl);
    resumedDownloadUrls.delete(record.videoUrl);
    hlsPlaybackCaptureActiveDownloadUrls.delete(record.videoUrl);
    hlsPlaybackCaptureAutoQueuedUrls.delete(record.videoUrl);
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
  allowHlsPlaybackCapture(payload.video.url);
  const existing = getPersistedDownload(payload.video.url);
  const existingRecord = existing ? downloadRecordWithRuntimeState(existing) : null;
  const existingState = existingRecord ? existingRecord.state : null;

  if (existingRecord && (existingState === 'queued' || existingState === 'downloading' || existingState === 'ready')) {
    return {
      record: existingRecord,
      queued: false
    };
  }
  if (existingState === 'paused') return resumeDownload(payload.video.url);

  await ffmpegCommandForDownload();
  ensureDownloadRootReady();

  upsertDownloadVideoMetadata(payload);
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
  if (videoUrl) allowHlsPlaybackCapture(videoUrl);
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
  if (videoUrl) allowHlsPlaybackCapture(videoUrl);
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
  const isPlaybackCaptureActive = hlsPlaybackCaptureActiveDownloadUrls.has(videoUrl);
  const isQueued = removeQueuedDownload(videoUrl);
  if (!isActive && !isPlaybackCaptureActive && !isQueued && currentRecord.state !== 'paused') {
    throw new Error(t('status.downloadPauseUnavailable'));
  }

  canceledDownloadUrls.delete(videoUrl);
  pausedDownloadUrls.add(videoUrl);
  suppressHlsPlaybackCapture(videoUrl);

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
  } else if (isPlaybackCaptureActive) {
    hlsPlaybackCaptureActiveDownloadUrls.delete(videoUrl);
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
  const isPlaybackCaptureActive = hlsPlaybackCaptureActiveDownloadUrls.has(videoUrl);
  if (!isActive && !isPlaybackCaptureActive && currentRecord.state !== 'queued') {
    throw new Error(t('status.downloadCancelUnavailable'));
  }

  removeQueuedDownload(videoUrl);
  if (isActive) canceledDownloadUrls.add(videoUrl);
  pausedDownloadUrls.delete(videoUrl);
  resumedDownloadUrls.delete(videoUrl);
  suppressHlsPlaybackCapture(videoUrl);

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
  suppressHlsPlaybackCapture(visibleRecord.videoUrl);
  removeQueuedLocalPlaybackPreviewGeneration(visibleRecord.videoUrl);

  const deleted = deleteManagedDownloadFile(visibleRecord);
  removeDownloadWorkingFiles(visibleRecord);
  removeLocalPlaybackPreviewFiles(visibleRecord);
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
  if (visibleRecord.state === 'downloading' && !hlsPlaybackCaptureActiveDownloadUrls.has(videoUrl)) {
    throw new Error(t('status.downloadDeleteActiveBlocked'));
  }

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
    completeHlsPlaybackCapture: completeHlsPlaybackCapture,
    prepareHlsPlaybackCapture: prepareHlsPlaybackCapture,
    pauseDownloadsForShutdown: pauseDownloadsForShutdown,
    processQueue: processDownloadQueue,
    recordHlsPlaybackCaptureSegment: recordHlsPlaybackCaptureSegment,
    shouldProxyHlsPlaybackCapture: shouldProxyHlsPlaybackCapture,
    shouldContinueHlsPlaybackCapture: shouldContinueHlsPlaybackCapture,
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
