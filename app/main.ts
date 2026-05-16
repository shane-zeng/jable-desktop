'use strict';

import type * as Electron from 'electron';
import type * as NodeChildProcess from 'node:child_process';
import type * as NodeCrypto from 'node:crypto';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type {
  AppSettings,
  AppSettingsPatch,
  BrowserDiagnosis,
  BrowserBounds,
  BrowserNavigatePayload,
  BrowserNavigationState,
  BrowserTabKind,
  BrowserTabLockedPayload,
  BrowserTabMenuPayload,
  BrowserTabMutedPayload,
  BrowserTabsState,
  CancelDownloadResult,
  CollectionAction,
  CollectionKey,
  CreateBrowserTabPayload,
  DeleteDownloadResult,
  DownloadRecord,
  DownloadRequestPayload,
  DownloadRootInfo,
  DownloadRootSelectionResult,
  EnqueueDownloadResult,
  ExportJsonFileResult,
  ExportResource,
  FfmpegPathSelectionResult,
  FfmpegStatus,
  FinishSyncPayload,
  LibraryVideoMenuPayload,
  ListVideosOptions,
  OpenDownloadFileResult,
  PendingRemoteOperationActionResult,
  PendingRemoteOperationGroup,
  RevealDownloadFileResult,
  SupportedLocale,
  SyncBrowserCollectionOptions,
  SyncMode,
  SyncQueuedOperationFailure,
  SyncQueueProgressPayload,
  SyncPagePayload,
  SyncResult,
  SyncState,
  VideoRow
} from './types/jable';
import {
  normalizeBrowserBounds,
  normalizeBrowserNavigatePayload,
  normalizeBrowserSyncCollectionPayload,
  normalizeBrowserTabLockedPayload,
  normalizeBrowserTabMenuPayload,
  normalizeBrowserTabMutedPayload,
  normalizeBrowserTabPayload,
  normalizeCollectionKey,
  normalizeCollectionTogglePayload,
  normalizeCollectionUrlsKnownPayload,
  normalizeCreateBrowserTabPayload,
  normalizeFinishSyncPayload,
  normalizeImportJsonPayload,
  normalizeLibraryVideoMenuPayload,
  normalizeListVideosOptions,
  normalizeSyncPagePayload,
  normalizeTabIdValue,
  optionalBooleanField,
  optionalStringField,
  requiredRecord,
  requiredStringValue
} from './ipc-normalizers';
import type { CollectionTogglePayload } from './ipc-normalizers';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type BrowserBoundsState = { visible: boolean; x: number; y: number; width: number; height: number };
type BrowserLoadFailure = { url: string; errorCode: number };
type BrowserTab = {
  id: string;
  kind: BrowserTabKind;
  view: Electron.WebContentsView;
  attached: boolean;
  locked: boolean;
  title: string;
  url: string;
  favicon: string;
  loading: boolean;
  muted: boolean;
  audible: boolean;
  mediaPlaying: boolean;
  pictureInPicture: boolean;
  discarded: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  controlledLoad: boolean;
  lastMainFrameLoadFailure: BrowserLoadFailure | null;
};
type SyncWorker = {
  id: string;
  window: Electron.BrowserWindow;
  webContents: Electron.WebContents;
  collectionKey: CollectionKey;
  syncRunId: string;
  lastMainFrameLoadFailure: BrowserLoadFailure | null;
};
type ActiveSyncRun = {
  mode: SyncMode;
  mutated: boolean;
  syncRunId: string;
};
type DatabaseCollection = { key: CollectionKey; name: string; sourcePath: string };
type DatabaseListOptions = Partial<ListVideosOptions> & {
  sort?: ListVideosOptions['sort'] | 'updated_at' | 'last_seen_at';
};
type CollectionToggleResult = {
  action: 'add' | 'remove';
  changed: boolean;
  collectionKey: CollectionKey;
  queued?: boolean;
  url: string;
  visible: boolean;
};
type DeferredSyncOperation = {
  id: number;
  action: 'add' | 'remove';
  videoUrl: string;
  remoteVideoId: string | null;
  remoteFavType: string | null;
};
type PendingCollectionOperationOverlay = Omit<DeferredSyncOperation, 'id'>;
type PendingCollectionOperationOverlayState = {
  collections: Partial<Record<CollectionKey, PendingCollectionOperationOverlay[]>>;
};
type DeferredSyncOperationApplyResult = {
  applied: number[];
  failed: SyncQueuedOperationFailure[];
};
type SyncQueueProgressInput = Omit<SyncQueueProgressPayload, 'collectionKey' | 'mode' | 'syncRunId'>;
type SettingsModule = {
  AppSettingsStore: new (filePath: string) => {
    get(): AppSettings;
    update(patch: AppSettingsPatch): AppSettings;
  };
  normalizeAppSettingsPatch(value: unknown): AppSettingsPatch;
  settingsFilePath(userDataPath: string): string;
};
type DownloadsModule = {
  DownloadStore: new (filePath: string) => {
    list(): DownloadRecord[];
    get(videoUrl: string): DownloadRecord | null;
    upsert(patch: Partial<DownloadRecord> & { videoUrl: string }): DownloadRecord;
    remove(videoUrl: string): boolean;
  };
  downloadsFilePath(userDataPath: string): string;
};
type DataEngineInstance = {
  close(): void;
  listVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): VideoRow[];
  countVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): number;
  getCollectionUrls(collectionKey: CollectionKey): string[];
  allCollectionUrlsKnown(collectionKey: CollectionKey, urls?: unknown[] | null): boolean;
  saveSyncPage(payload: SyncPagePayload): { saved: number; collectionKey: CollectionKey; page: number | null };
  applyCollectionToggle(payload?: CollectionTogglePayload | null): CollectionToggleResult;
  listDeferredSyncOperations(collectionKey: CollectionKey, syncRunId: string | null): DeferredSyncOperation[];
  listDeferredSyncOutboxOperations(collectionKey: CollectionKey): DeferredSyncOperation[];
  markDeferredSyncOperationsApplied(collectionKey: CollectionKey, syncRunId: string | null, ids: unknown[]): number;
  markDeferredSyncOperationFailed(
    collectionKey: CollectionKey,
    syncRunId: string | null,
    id: unknown,
    message: unknown
  ): boolean;
  listPendingRemoteOperationGroups(): PendingRemoteOperationGroup[];
  preparePendingRemoteOperationRetry(groupId: string): PendingRemoteOperationActionResult;
  markPendingRemoteOperationGroupAdded(groupId: string): boolean;
  markPendingRemoteOperationGroupRemoved(groupId: string): boolean;
  markPendingRemoteOperationGroupResolved(groupId: string): boolean;
  markPendingRemoteOperationGroupFailed(groupId: string, message: unknown): boolean;
  finishSync(payload: FinishSyncPayload): SyncState;
  clearSyncState(collectionKey: CollectionKey): { collectionKey: CollectionKey; cleared: boolean };
  importResource(
    collectionKey: CollectionKey,
    resource: ExportResource
  ): { imported: number; collectionKey: CollectionKey };
  exportResource(collectionKey: CollectionKey): ExportResource;
  exportResourceToFile(collectionKey: CollectionKey, filePath: string): Promise<{ filePath: string; total: number }>;
};
type DataEngineModule = {
  COLLECTIONS: DatabaseCollection[];
  createDataEngine(filePath: string): DataEngineInstance;
};
type BrowserTabShortcutInput = Electron.Input & {
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
};
type SerializedMediaState = {
  muted: boolean;
  audible: boolean;
  mediaPlaying: boolean;
  pictureInPicture: boolean;
  discarded: boolean;
};
type BrowserTabPolicyModule = {
  browserTabShortcutOffset(input: BrowserTabShortcutInput | null | undefined, isMacos: boolean): number;
  browserTabWebPreferences(kind: BrowserTabKind, preloadPath: string, partition: string): Electron.WebPreferences;
  nextActiveTabIdByOffset(tabs: BrowserTab[], activeTabId: string | null, offset: number): string | null;
  nextActiveTabIdAfterClose(tabs: BrowserTab[], activeTabId: string | null, closingTabId: string): string | null;
  serializedMediaState(tab: BrowserTab): SerializedMediaState;
};
type BrowserPreloadRequest = {
  webContentsId: number;
  timer: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
};
type BrowserPreloadResponse = {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};
type I18nModule = {
  DEFAULT_LOCALE: SupportedLocale;
  normalizeLocale(value: unknown): SupportedLocale;
  t(locale: SupportedLocale, key: string, params?: TranslationParams | null): string;
};
type UpdateCheckResult = {
  available?: boolean;
  currentVersion?: string;
  latestVersion?: string;
  releaseUrl?: string;
  error?: string;
  reason?: string;
};
type UpdateCheckerModule = {
  checkLatestRelease(options: { currentVersion?: string }): Promise<UpdateCheckResult>;
};
type AdBlockerModule = {
  installJableAdBlocker(
    session: Electron.Session,
    options?: {
      enabled?: boolean;
      debug?: boolean;
      logger?: { info(message?: unknown, ...optionalParams: unknown[]): void };
    } | null
  ): { enabled: boolean; patterns: string[] };
  isAdBlockDebugEnabledByEnv(env?: Record<string, string | undefined> | null): boolean;
  isAdBlockEnabledByEnv(env?: Record<string, string | undefined> | null): boolean;
  shouldBlockAdNavigation(value: unknown): boolean;
};
type UrlPolicyModule = {
  JABLE_PRIMARY_ORIGIN: string;
  JABLE_FALLBACK_ORIGIN: string;
  fallbackJableUrl(value: unknown): string | null;
  isJableCollectionUrl(collectionKey: CollectionKey, value: unknown): boolean;
  isAllowedExternalReleaseUrl(value: unknown): boolean;
  isSafeBrowserUrl(value: unknown): boolean;
  jableCollectionUrl(collectionKey: CollectionKey, origin?: string): string;
  rewriteJableUrlOrigin(value: unknown, origin: string): string;
};
type UpdateCheckOptions = { manual?: boolean };
type PopupOptions = Parameters<Electron.Menu['popup']>[0];

const electron: typeof Electron = require('electron');
const childProcess: typeof NodeChildProcess = require('node:child_process');
const nodeCrypto: typeof NodeCrypto = require('node:crypto');
const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');
const adBlocker = require('./ad-blocker') as AdBlockerModule;
const browserTabPolicy = require('./browser-tab-policy') as BrowserTabPolicyModule;
const dataEngineModule = require('./data-engine') as DataEngineModule;
const downloadsModule = require('./downloads') as DownloadsModule;
const i18n = require('./i18n') as I18nModule;
const settingsModule = require('./settings') as SettingsModule;
const updateChecker = require('./update-checker') as UpdateCheckerModule;
const urlPolicy = require('./url-policy') as UrlPolicyModule;
const COLLECTIONS = dataEngineModule.COLLECTIONS;

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const WebContentsView = electron.WebContentsView;
const ipcMain = electron.ipcMain;
const Menu = electron.Menu;
const clipboard = electron.clipboard;
const dialog = electron.dialog;
const session = electron.session;
const shell = electron.shell;
const browserTabShortcutOffset = browserTabPolicy.browserTabShortcutOffset;
const browserTabWebPreferences = browserTabPolicy.browserTabWebPreferences;
const nextActiveTabIdByOffset = browserTabPolicy.nextActiveTabIdByOffset;
const nextActiveTabIdAfterClose = browserTabPolicy.nextActiveTabIdAfterClose;
const serializedMediaState = browserTabPolicy.serializedMediaState;

const DEFAULT_JABLE_HOME_URL = urlPolicy.JABLE_PRIMARY_ORIGIN + '/';
const JABLE_HOME_URL = configuredHomeUrl();
const JABLE_SESSION_PARTITION = 'persist:jable-session';
const BACKGROUND_UPDATE_CHECK_DELAY_MS = 5000;
const BROWSER_SYNC_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;
const BROWSER_DIAGNOSE_REQUEST_TIMEOUT_MS = 5000;
const FFMPEG_CHECK_TIMEOUT_MS = 5000;
const FFMPEG_COMMAND = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const DOWNLOAD_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari';
const IS_MACOS = process.platform === 'darwin';
const NEW_TAB_ACCELERATOR = IS_MACOS ? 'Command+T' : 'Ctrl+T';
const CLOSE_TAB_ACCELERATOR = IS_MACOS ? 'Command+W' : 'Ctrl+W';

let mainWindow: Electron.BrowserWindow | null = null;
const browserTabs: BrowserTab[] = [];
const browserTabsById: Record<string, BrowserTab> = {};
const webContentsTabIds: Record<string, string> = {};
const syncWorkersById: Record<string, SyncWorker> = {};
const activeSyncRunsByCollection: Partial<Record<CollectionKey, ActiveSyncRun>> = {};
const browserPreloadRequests: Record<string, BrowserPreloadRequest> = {};
let activeBrowserTabId: string | null = null;
let nextBrowserTabId = 1;
let nextSyncWorkerId = 1;
let nextBrowserPreloadRequestId = 1;
let activeJableOrigin = urlPolicy.JABLE_PRIMARY_ORIGIN;
let browserBounds: BrowserBoundsState = { visible: true, x: 0, y: 52, width: 900, height: 600 };
let browserHtmlFullScreenTabId: string | null = null;
let database: DataEngineInstance | null = null;
let databasePath: string | null = null;
let settingsStore: InstanceType<SettingsModule['AppSettingsStore']> | null = null;
let downloadStore: InstanceType<DownloadsModule['DownloadStore']> | null = null;
const downloadQueue: string[] = [];
const canceledDownloadUrls = new Set<string>();
let activeDownloadUrl: string | null = null;
let activeDownloadProcess: NodeChildProcess.ChildProcess | null = null;
let lastShortcutAction = { name: '', at: 0 };
let currentLocale: SupportedLocale = i18n.DEFAULT_LOCALE;
let updateCheckInFlight: Promise<UpdateCheckResult> | null = null;
let lastBackgroundUpdateVersion: string | null = null;

function t(key: string, params?: TranslationParams | null): string {
  return i18n.t(currentLocale, key, params);
}

function configuredHomeUrl() {
  const homeUrl = String(process.env.JABLE_DESKTOP_TEST_HOME_URL || '').trim();
  return homeUrl && urlPolicy.isSafeBrowserUrl(homeUrl) ? homeUrl : DEFAULT_JABLE_HOME_URL;
}

function configureAppStorageForTests() {
  const userDataDir = String(process.env.JABLE_DESKTOP_TEST_USER_DATA_DIR || '').trim();
  if (userDataDir) app.setPath('userData', path.resolve(userDataDir));
}

function shouldDenyAdNavigation(url: unknown): boolean {
  const blocked = adBlocker.shouldBlockAdNavigation(url);

  if (blocked && adBlocker.isAdBlockDebugEnabledByEnv(process.env)) {
    console.info('[ad-blocker] blocked navigation', url);
  }

  return blocked;
}

function installAdBlocker() {
  const result = adBlocker.installJableAdBlocker(session.fromPartition(JABLE_SESSION_PARTITION), {
    enabled: adBlocker.isAdBlockEnabledByEnv(process.env),
    debug: adBlocker.isAdBlockDebugEnabledByEnv(process.env)
  });

  if (result.enabled && adBlocker.isAdBlockDebugEnabledByEnv(process.env)) {
    console.info('[ad-blocker] enabled with ' + result.patterns.length + ' URL patterns');
  }
}

function mainErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function downloadErrorMessage(error: unknown): string {
  let message = mainErrorMessage(error).replace(/https?:\/\/[^\s"'<>]+/g, '[remote URL]');
  const rootPath = getDownloadRoot().path;
  if (rootPath) {
    message = message.replace(new RegExp(escapeRegExp(rootPath), 'g'), '[download root]');
  }
  return message;
}

class DownloadCanceledError extends Error {
  constructor() {
    super(t('status.downloadCanceled'));
    this.name = 'DownloadCanceledError';
  }
}

function downloadCanceledError() {
  return new DownloadCanceledError();
}

function isDownloadCanceledError(error: unknown): boolean {
  return error instanceof DownloadCanceledError;
}

function throwIfDownloadCanceled(videoUrl: string) {
  if (canceledDownloadUrls.has(videoUrl)) throw downloadCanceledError();
}

function normalizeBrowserNavigationUrl(value: unknown): string {
  const url = String(value || '').trim();
  if (!url) return '';
  if (!urlPolicy.isSafeBrowserUrl(url)) throw new Error(t('errors.unsupportedUrlProtocol'));
  return urlPolicy.rewriteJableUrlOrigin(url, activeJableOrigin);
}

function notifyJableOriginFallback(origin: string) {
  forwardBrowserMessage('jable-origin-fallback', { origin: origin });
}

function activateJableFallbackOrigin() {
  if (activeJableOrigin === urlPolicy.JABLE_FALLBACK_ORIGIN) return;
  activeJableOrigin = urlPolicy.JABLE_FALLBACK_ORIGIN;
  notifyJableOriginFallback(activeJableOrigin);
}

function fallbackUrlForLoadFailure(failure: BrowserLoadFailure | null | undefined): string | null {
  if (!failure || failure.errorCode === -3) return null;
  if (activeJableOrigin !== urlPolicy.JABLE_PRIMARY_ORIGIN) return null;
  return urlPolicy.fallbackJableUrl(failure.url);
}

function autoFallbackBrowserTab(tab: BrowserTab, failure: BrowserLoadFailure | null | undefined): boolean {
  const fallbackUrl = fallbackUrlForLoadFailure(failure);
  if (!fallbackUrl) return false;

  activateJableFallbackOrigin();
  loadTabUrl(tab, fallbackUrl, true);
  return true;
}

function browserSyncCollectionPayloadWithSettings(payload: {
  tabId: string | null;
  options: SyncBrowserCollectionOptions;
}): {
  tabId: string | null;
  options: SyncBrowserCollectionOptions;
} {
  return {
    tabId: payload.tabId,
    options: Object.assign({}, payload.options, {
      ajaxWindowSize: getAppSettings().fullSyncAjaxWindowSize
    })
  };
}

function setCurrentLocale(locale: unknown): SupportedLocale {
  currentLocale = i18n.normalizeLocale(locale);
  if (app.isReady()) installApplicationMenu();
  return currentLocale;
}

function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = new settingsModule.AppSettingsStore(settingsModule.settingsFilePath(app.getPath('userData')));
  }

  return settingsStore;
}

function getAppSettings(): AppSettings {
  return getSettingsStore().get();
}

function updateAppSettings(patch: unknown): AppSettings {
  const settings = getSettingsStore().update(settingsModule.normalizeAppSettingsPatch(patch));
  notifyBrowserTabsChanged();
  forwardBrowserMessage('settings-changed', settings);
  return settings;
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

function getDownloadStore() {
  if (!downloadStore) {
    downloadStore = new downloadsModule.DownloadStore(downloadsModule.downloadsFilePath(app.getPath('userData')));
  }

  return downloadStore;
}

function downloadRecordFileStats(record: DownloadRecord): NodeFs.Stats | null {
  if (!record.localPath) return null;
  try {
    return fs.statSync(record.localPath);
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

  const isActive = activeDownloadUrl === fileRecord.videoUrl;
  const isQueued = downloadQueue.indexOf(fileRecord.videoUrl) !== -1;
  if (isActive || isQueued) return fileRecord;

  return Object.assign({}, fileRecord, {
    state: 'failed' as const,
    progress: null,
    error: t('status.downloadInterrupted')
  });
}

function listDownloads(): DownloadRecord[] {
  return getDownloadStore().list().map(downloadRecordWithRuntimeState);
}

function notifyDownloadsChanged() {
  forwardBrowserMessage('downloads-changed', listDownloads());
}

function downloadTimestamp() {
  return new Date().toISOString();
}

function normalizeDownloadRequestPayload(value: unknown): DownloadRequestPayload {
  const channel = 'download:enqueue';
  const payload = requiredRecord(value, channel);
  const video = requiredRecord(payload.video, channel);

  return {
    collectionKey: normalizeCollectionKey(payload.collectionKey, channel),
    video: {
      title: typeof video.title === 'string' ? video.title : null,
      url: requiredStringValue(video.url, 'video.url', channel),
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

function downloadOutputPath(payload: DownloadRequestPayload): string {
  const hash = nodeCrypto.createHash('sha1').update(payload.video.url).digest('hex').slice(0, 10);
  const name = sanitizeDownloadFileName(payload.video.title || videoUrlSlug(payload.video.url));
  return path.join(getDownloadRoot().path, payload.collectionKey, name + '-' + hash + '.mp4');
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

function hlsUrlCandidate(value: string, pageUrl: string): string | null {
  const candidate = value.replace(/\\\//g, '/').replace(/&amp;/g, '&').trim();
  if (candidate.indexOf('.m3u8') === -1) return null;

  try {
    return new URL(candidate, pageUrl).toString();
  } catch (error) {
    return null;
  }
}

function extractHlsPlaylistUrl(html: string, pageUrl: string): string | null {
  const candidates = new Set<string>();
  const normalizedHtml = html.replace(/\\\//g, '/');
  const absoluteMatches = normalizedHtml.match(/https?:\/\/[^"'<>\\\s]+\.m3u8[^"'<>\\\s]*/g) || [];

  for (let i = 0; i < absoluteMatches.length; i++) {
    const candidate = hlsUrlCandidate(absoluteMatches[i], pageUrl);
    if (candidate) candidates.add(candidate);
  }

  const quotedPattern = /["']([^"']+\.m3u8[^"']*)["']/g;
  let match = quotedPattern.exec(normalizedHtml);
  while (match) {
    const candidate = hlsUrlCandidate(match[1], pageUrl);
    if (candidate) candidates.add(candidate);
    match = quotedPattern.exec(normalizedHtml);
  }

  return candidates.values().next().value || null;
}

async function fetchVideoPageHtml(videoUrl: string): Promise<string> {
  const cookieHeader = await cookieHeaderForUrl(videoUrl);
  const headers: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml',
    referer: new URL(videoUrl).origin + '/',
    'user-agent': DOWNLOAD_USER_AGENT
  };
  if (cookieHeader) headers.cookie = cookieHeader;

  const response = await fetch(videoUrl, { headers: headers });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.text();
}

async function ffmpegCommandForDownload(): Promise<string> {
  const status = await getFfmpegStatus();
  if (status.state !== 'detected') throw new Error(t('status.ffmpegMissing'));
  return status.path || FFMPEG_COMMAND;
}

function ffmpegHeaderBlock(videoUrl: string, cookieHeader: string): string {
  const headers = ['Referer: ' + videoUrl, 'User-Agent: ' + DOWNLOAD_USER_AGENT];
  if (cookieHeader) headers.push('Cookie: ' + cookieHeader);
  return headers.join('\r\n') + '\r\n';
}

function removePartialDownloadFile(outputPath: string) {
  try {
    fs.unlinkSync(outputPath + '.part');
  } catch (error) {}
}

function runFfmpegDownload(command: string, playlistUrl: string, videoUrl: string, outputPath: string): Promise<void> {
  return cookieHeaderForUrl(videoUrl).then(function (cookieHeader) {
    return new Promise(function (resolve, reject) {
      const tempPath = outputPath + '.part';
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
          '-hide_banner',
          '-loglevel',
          'error',
          '-headers',
          ffmpegHeaderBlock(videoUrl, cookieHeader),
          '-protocol_whitelist',
          'file,http,https,tcp,tls,crypto',
          '-i',
          playlistUrl,
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          tempPath
        ],
        {
          windowsHide: true
        }
      );
      let stderr = '';

      activeDownloadProcess = child;
      child.stderr.on('data', function (chunk) {
        stderr = (stderr + String(chunk)).slice(-4000);
      });
      child.on('error', function (error) {
        if (activeDownloadProcess === child) activeDownloadProcess = null;
        reject(error);
      });
      child.on('close', function (code) {
        if (activeDownloadProcess === child) activeDownloadProcess = null;

        if (canceledDownloadUrls.has(videoUrl)) {
          removePartialDownloadFile(outputPath);
          reject(downloadCanceledError());
          return;
        }

        if (code !== 0) {
          removePartialDownloadFile(outputPath);
          reject(new Error(stderr.trim() || 'FFmpeg exited with code ' + code));
          return;
        }

        try {
          throwIfDownloadCanceled(videoUrl);
          fs.renameSync(tempPath, outputPath);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

async function runQueuedDownload(record: DownloadRecord) {
  const store = getDownloadStore();
  const outputPath = record.localPath || path.join(getDownloadRoot().path, videoUrlSlug(record.videoUrl) + '.mp4');

  store.upsert({
    videoUrl: record.videoUrl,
    state: 'downloading',
    progress: null,
    error: null,
    localPath: outputPath
  });
  notifyDownloadsChanged();

  try {
    throwIfDownloadCanceled(record.videoUrl);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const command = await ffmpegCommandForDownload();
    throwIfDownloadCanceled(record.videoUrl);
    const html = await fetchVideoPageHtml(record.videoUrl);
    throwIfDownloadCanceled(record.videoUrl);
    const playlistUrl = extractHlsPlaylistUrl(html, record.videoUrl);
    if (!playlistUrl) throw new Error('HLS playlist was not found');
    throwIfDownloadCanceled(record.videoUrl);

    await runFfmpegDownload(command, playlistUrl, record.videoUrl, outputPath);
    throwIfDownloadCanceled(record.videoUrl);
    const stats = fs.statSync(outputPath);

    store.upsert({
      videoUrl: record.videoUrl,
      state: 'ready',
      progress: 1,
      error: null,
      localPath: outputPath,
      fileSizeBytes: stats.isFile() ? stats.size : null,
      completedAt: downloadTimestamp()
    });
    notifyDownloadsChanged();
  } catch (error) {
    store.upsert({
      videoUrl: record.videoUrl,
      state: 'failed',
      progress: null,
      error: isDownloadCanceledError(error) ? t('status.downloadCanceled') : downloadErrorMessage(error)
    });
    notifyDownloadsChanged();
  } finally {
    canceledDownloadUrls.delete(record.videoUrl);
  }
}

function processDownloadQueue() {
  if (activeDownloadUrl) return;

  const nextUrl = downloadQueue.shift();
  if (!nextUrl) return;

  const record = getDownloadStore().get(nextUrl);
  if (!record || record.state !== 'queued') {
    processDownloadQueue();
    return;
  }

  activeDownloadUrl = nextUrl;
  runQueuedDownload(record)
    .catch(function (error) {
      console.error(error);
    })
    .finally(function () {
      activeDownloadUrl = null;
      processDownloadQueue();
    });
}

function queueDownloadRecord(record: DownloadRecord) {
  if (downloadQueue.indexOf(record.videoUrl) === -1 && activeDownloadUrl !== record.videoUrl) {
    downloadQueue.push(record.videoUrl);
  }
  notifyDownloadsChanged();
  processDownloadQueue();
}

async function enqueueDownload(value: unknown): Promise<EnqueueDownloadResult> {
  const payload = normalizeDownloadRequestPayload(value);
  const store = getDownloadStore();
  const existing = store.get(payload.video.url);
  const existingRecord = existing ? downloadRecordWithRuntimeState(existing) : null;
  const existingState = existingRecord ? existingRecord.state : null;

  if (existingRecord && (existingState === 'queued' || existingState === 'downloading' || existingState === 'ready')) {
    return {
      record: existingRecord,
      queued: false
    };
  }

  await ffmpegCommandForDownload();

  const record = store.upsert({
    videoUrl: payload.video.url,
    collectionKey: payload.collectionKey,
    title: payload.video.title,
    img: payload.video.img,
    localPath: downloadOutputPath(payload),
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
  const videoUrl = requiredStringValue(value, 'videoUrl', 'download:retry').trim();
  const store = getDownloadStore();
  const existing = videoUrl ? store.get(videoUrl) : null;
  const existingRecord = existing ? downloadRecordWithRuntimeState(existing) : null;
  const existingState = existingRecord ? existingRecord.state : null;

  if (!existing) throw new Error(t('status.downloadFileUnavailable'));
  if (existingRecord && (existingState === 'queued' || existingState === 'downloading' || existingState === 'ready')) {
    return {
      record: existingRecord,
      queued: false
    };
  }

  await ffmpegCommandForDownload();

  const record = store.upsert({
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

function removeQueuedDownload(videoUrl: string): boolean {
  const queueIndex = downloadQueue.indexOf(videoUrl);
  if (queueIndex === -1) return false;
  downloadQueue.splice(queueIndex, 1);
  return true;
}

function cancelDownload(value: unknown): CancelDownloadResult {
  const videoUrl = requiredStringValue(value, 'videoUrl', 'download:cancel').trim();
  if (!videoUrl) throw new Error(t('status.downloadCancelUnavailable'));

  const store = getDownloadStore();
  const existing = store.get(videoUrl);
  const currentRecord = existing ? downloadRecordWithRuntimeState(existing) : null;
  if (!currentRecord) throw new Error(t('status.downloadCancelUnavailable'));

  const isActive = activeDownloadUrl === videoUrl;
  if (!isActive && currentRecord.state !== 'queued') throw new Error(t('status.downloadCancelUnavailable'));

  removeQueuedDownload(videoUrl);
  if (isActive) canceledDownloadUrls.add(videoUrl);

  const record = store.upsert({
    videoUrl: videoUrl,
    state: 'failed',
    progress: null,
    error: t('status.downloadCanceled'),
    completedAt: null
  });

  if (isActive && activeDownloadProcess) activeDownloadProcess.kill('SIGTERM');
  notifyDownloadsChanged();

  return {
    canceled: true,
    record: record
  };
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

  let stats: NodeFs.Stats;
  try {
    stats = fs.statSync(record.localPath);
  } catch (error) {
    return false;
  }

  if (!isPathInsideDirectory(record.localPath, getDownloadRoot().path)) {
    throw new Error(t('status.downloadFileOutsideRoot'));
  }

  if (!stats.isFile()) throw new Error(t('status.downloadFileUnavailable'));

  fs.unlinkSync(record.localPath);
  return true;
}

function confirmDeleteDownload(): Promise<boolean> {
  return showAppDialog({
    type: 'warning',
    buttons: [t('dialog.deleteDownloadConfirm'), t('dialog.cancel')],
    defaultId: 1,
    cancelId: 1,
    title: t('dialog.deleteDownloadTitle'),
    message: t('dialog.deleteDownloadMessage')
  }).then(function (dialogResult: Electron.MessageBoxReturnValue) {
    return dialogResult.response === 0;
  });
}

async function deleteDownload(value: unknown): Promise<DeleteDownloadResult> {
  const videoUrl = requiredStringValue(value, 'videoUrl', 'download:delete').trim();
  if (!videoUrl) throw new Error(t('status.downloadFileUnavailable'));

  if (activeDownloadUrl === videoUrl) throw new Error(t('status.downloadDeleteActiveBlocked'));

  const store = getDownloadStore();
  const record = store.get(videoUrl);
  const visibleRecord = record ? downloadRecordWithRuntimeState(record) : null;
  if (!visibleRecord) throw new Error(t('status.downloadFileUnavailable'));
  if (visibleRecord.state === 'downloading') throw new Error(t('status.downloadDeleteActiveBlocked'));

  const confirmed = await confirmDeleteDownload();
  if (!confirmed) {
    return {
      deleted: false,
      removed: false,
      canceled: true
    };
  }

  const queueIndex = downloadQueue.indexOf(videoUrl);
  if (queueIndex !== -1) downloadQueue.splice(queueIndex, 1);

  const deleted = deleteManagedDownloadFile(visibleRecord);
  const removed = store.remove(videoUrl);
  notifyDownloadsChanged();

  return {
    deleted: deleted,
    removed: removed
  };
}

function openDownloadFile(value: unknown): Promise<OpenDownloadFileResult> {
  const videoUrl = requiredStringValue(value, 'videoUrl', 'download:open-file').trim();
  if (!videoUrl) throw new Error(t('status.downloadFileUnavailable'));

  const record = getDownloadStore().get(videoUrl);
  const readyRecord = record ? downloadRecordWithFileState(record) : null;
  if (!readyRecord || readyRecord.state !== 'ready' || !readyRecord.localPath) {
    throw new Error(t('status.downloadFileUnavailable'));
  }

  return shell.openPath(readyRecord.localPath).then(function (errorMessage: string) {
    if (errorMessage) throw new Error(errorMessage);
    return {
      opened: true,
      path: readyRecord.localPath as string
    };
  });
}

function revealDownloadFile(value: unknown): RevealDownloadFileResult {
  const videoUrl = requiredStringValue(value, 'videoUrl', 'download:reveal-file').trim();
  if (!videoUrl) throw new Error(t('status.downloadFileUnavailable'));

  const record = getDownloadStore().get(videoUrl);
  const readyRecord = record ? downloadRecordWithFileState(record) : null;
  if (!readyRecord || readyRecord.state !== 'ready' || !readyRecord.localPath) {
    throw new Error(t('status.downloadFileUnavailable'));
  }

  shell.showItemInFolder(readyRecord.localPath);
  return {
    revealed: true,
    path: readyRecord.localPath
  };
}

function getDatabase(): DataEngineInstance {
  if (!database) {
    databasePath = path.join(app.getPath('userData'), 'jable-favourites.sqlite');
    database = dataEngineModule.createDataEngine(databasePath);
  }

  return database;
}

function localDataFolderPath(): string {
  getDatabase();
  if (!databasePath) throw new Error(t('status.unknownError'));
  return path.dirname(databasePath);
}

function openLocalDataFolder(): Promise<{ opened: boolean; path: string }> {
  const folderPath = localDataFolderPath();
  fs.mkdirSync(folderPath, { recursive: true });

  return shell.openPath(folderPath).then(function (errorMessage: string) {
    if (errorMessage) throw new Error(errorMessage);
    return {
      opened: true,
      path: folderPath
    };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 680,
    title: 'Jable Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false
    }
  });

  registerAppShortcuts(mainWindow.webContents);

  mainWindow.webContents.setWindowOpenHandler(function (details: Electron.HandlerDetails) {
    if (details.url) {
      if (shouldDenyAdNavigation(details.url)) return { action: 'deny' };

      try {
        createBrowserTab({
          url: details.url,
          active: true
        });
      } catch (error) {
        forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
      }
    }

    return { action: 'deny' };
  });

  mainWindow.on('swipe', function (_event: Electron.Event, direction: string) {
    if (direction === 'right') goBrowserBack();
    else if (direction === 'left') goBrowserForward();
  });

  mainWindow.on('resize', scheduleBrowserHtmlFullScreenResize);
  mainWindow.on('enter-full-screen', scheduleBrowserHtmlFullScreenResize);
  mainWindow.on('leave-full-screen', scheduleBrowserHtmlFullScreenResize);
  mainWindow.on('closed', function () {
    mainWindow = null;
    closeAllSyncWorkers();
  });

  loadRenderer();
  createBrowserTab({ url: JABLE_HOME_URL, active: true });
}

function shouldActivateWindowOpen(details: Electron.HandlerDetails | null | undefined) {
  return !details || details.disposition !== 'background-tab';
}

function isPrimaryShortcut(input: BrowserTabShortcutInput | null | undefined, key: string) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return false;
  if (String(input.key || '').toLowerCase() !== key) return false;
  if (input.alt || input.shift) return false;

  if (IS_MACOS) return Boolean(input.meta) && !input.control;
  return Boolean(input.control) && !input.meta;
}

function isNewTabShortcut(input: BrowserTabShortcutInput | null | undefined) {
  return isPrimaryShortcut(input, 't');
}

function isCloseTabShortcut(input: BrowserTabShortcutInput | null | undefined) {
  return isPrimaryShortcut(input, 'w');
}

function isToggleCompactTabsShortcut(input: BrowserTabShortcutInput | null | undefined) {
  return isPrimaryShortcut(input, 's');
}

function runShortcutAction(name: string, action: () => void) {
  const now = Date.now();

  if (lastShortcutAction.name === name && now - lastShortcutAction.at < 150) return;

  lastShortcutAction = { name: name, at: now };
  action();
}

function openHomeTabFromShortcut() {
  runShortcutAction('new-tab', function () {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
        return;
      }

      createBrowserTab({ url: JABLE_HOME_URL, active: true });
      forwardBrowserMessage('browser-tab-shortcut', {});
    } catch (error) {
      forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
    }
  });
}

function closeActiveTabFromShortcut() {
  runShortcutAction('close-tab', function () {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
      closeBrowserTab(activeBrowserTabId);
      forwardBrowserMessage('browser-tab-shortcut', {});
    } catch (error) {
      forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
    }
  });
}

function activateRelativeBrowserTabFromShortcut(offset: number) {
  runShortcutAction(offset > 0 ? 'next-tab' : 'previous-tab', function () {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
      const tabId = nextActiveTabIdByOffset(browserTabs, activeBrowserTabId, offset);
      if (!tabId || tabId === activeBrowserTabId) return;

      activateBrowserTab(tabId);
      forwardBrowserMessage('browser-tab-shortcut', {});
    } catch (error) {
      forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
    }
  });
}

function toggleCompactTabsFromShortcut() {
  runShortcutAction('toggle-compact-tabs', function () {
    forwardBrowserMessage('browser-tabs-compact-toggle-shortcut', {});
  });
}

function registerAppShortcuts(webContents: Electron.WebContents) {
  webContents.on('before-input-event', function (event, input) {
    if (isNewTabShortcut(input)) {
      event.preventDefault();
      openHomeTabFromShortcut();
      return;
    }

    if (isCloseTabShortcut(input)) {
      event.preventDefault();
      closeActiveTabFromShortcut();
      return;
    }

    const tabSwitchOffset = browserTabShortcutOffset(input, IS_MACOS);
    if (tabSwitchOffset) {
      event.preventDefault();
      activateRelativeBrowserTabFromShortcut(tabSwitchOffset);
      return;
    }

    if (isToggleCompactTabsShortcut(input)) {
      event.preventDefault();
      toggleCompactTabsFromShortcut();
    }
  });
}

function installApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [];
  const fileSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('menu.newTab'),
      accelerator: NEW_TAB_ACCELERATOR,
      click: openHomeTabFromShortcut
    },
    {
      label: t('menu.closeTab'),
      accelerator: CLOSE_TAB_ACCELERATOR,
      click: closeActiveTabFromShortcut
    }
  ];

  if (!IS_MACOS) {
    fileSubmenu.push({ type: 'separator' });
    fileSubmenu.push({ role: 'quit' });
  }

  if (IS_MACOS) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  template.push({
    label: t('menu.file'),
    submenu: fileSubmenu
  });

  template.push(
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: t('menu.window'),
      submenu: IS_MACOS
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'zoom' }]
    }
  );

  template.push({
    label: t('menu.help'),
    submenu: [
      {
        label: t('menu.checkForUpdates'),
        click: checkForUpdatesFromMenu
      }
    ]
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function loadRenderer() {
  if (!mainWindow) throw new Error('Main window is not available');

  if (process.env.JABLE_RENDERER_DEV_URL) {
    mainWindow.loadURL(process.env.JABLE_RENDERER_DEV_URL);
    return;
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer-dist', 'index.html'));
}

function showAppDialog(options: Electron.MessageBoxOptions) {
  if (mainWindow && !mainWindow.isDestroyed()) return dialog.showMessageBox(mainWindow, options);
  return dialog.showMessageBox(options);
}

function showUpdateAvailableDialog(result: UpdateCheckResult, manual: boolean): Promise<UpdateCheckResult> {
  if (!manual && result.latestVersion === lastBackgroundUpdateVersion) return Promise.resolve(result);
  if (!manual) lastBackgroundUpdateVersion = result.latestVersion || null;

  return showAppDialog({
    type: 'info',
    buttons: [t('updates.openDownloadPage'), t('updates.later')],
    defaultId: 0,
    cancelId: 1,
    title: t('updates.availableTitle'),
    message: t('updates.availableMessage', {
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion
    })
  }).then(function (dialogResult: Electron.MessageBoxReturnValue) {
    if (dialogResult.response !== 0 || !result.releaseUrl) return result;
    if (!urlPolicy.isAllowedExternalReleaseUrl(result.releaseUrl)) {
      return showUpdateFailedDialog({
        error: t('updates.untrustedReleaseUrl')
      }).then(function () {
        return result;
      });
    }

    return shell.openExternal(result.releaseUrl).then(function () {
      return result;
    });
  });
}

function showNoUpdateDialog(result: UpdateCheckResult): Promise<UpdateCheckResult> {
  return showAppDialog({
    type: 'info',
    buttons: ['OK'],
    defaultId: 0,
    title: t('updates.noUpdateTitle'),
    message: t('updates.noUpdateMessage', {
      currentVersion: result.currentVersion || app.getVersion()
    })
  }).then(function () {
    return result;
  });
}

function showUpdateFailedDialog(result: UpdateCheckResult): Promise<UpdateCheckResult> {
  return showAppDialog({
    type: 'warning',
    buttons: ['OK'],
    defaultId: 0,
    title: t('updates.failedTitle'),
    message: t('updates.failedMessage', {
      error: result.error || t('status.unknownError')
    })
  }).then(function () {
    return result;
  });
}

function displayUpdateCheckResult(result: UpdateCheckResult, manual: boolean): Promise<UpdateCheckResult> {
  if (result.available) return showUpdateAvailableDialog(result, manual);
  if (!manual) return Promise.resolve(result);
  if (result.error) return showUpdateFailedDialog(result);
  return showNoUpdateDialog(result);
}

function fetchUpdateCheck(): Promise<UpdateCheckResult> {
  if (updateCheckInFlight) return updateCheckInFlight;

  updateCheckInFlight = updateChecker
    .checkLatestRelease({
      currentVersion: app.getVersion()
    })
    .finally(function () {
      updateCheckInFlight = null;
    });

  return updateCheckInFlight;
}

function checkForUpdates(options?: UpdateCheckOptions | null): Promise<UpdateCheckResult> {
  const normalizedOptions = options || {};

  return fetchUpdateCheck().then(function (result) {
    return displayUpdateCheckResult(result, Boolean(normalizedOptions.manual));
  });
}

function checkForUpdatesFromMenu() {
  checkForUpdates({ manual: true }).catch(function (error) {
    showUpdateFailedDialog({
      error: mainErrorMessage(error)
    }).catch(function () {});
  });
}

function scheduleBackgroundUpdateCheck() {
  if (!app.isPackaged) return;

  setTimeout(function () {
    checkForUpdates({ manual: false }).catch(function () {});
  }, BACKGROUND_UPDATE_CHECK_DELAY_MS);
}

function createBrowserTab(options?: CreateBrowserTabPayload | null): BrowserTabsState {
  const normalizedOptions = options || {};
  const targetUrl = normalizeBrowserNavigationUrl(normalizedOptions.url);
  const maxTabs = getAppSettings().maxBrowserTabs;

  if (browserTabs.length >= maxTabs) {
    throw new Error(t('errors.maxTabs', { count: maxTabs }));
  }

  const kind: BrowserTabKind = normalizedOptions.kind === 'sync' ? 'sync' : 'normal';
  const id = 'tab-' + nextBrowserTabId++;
  const preloadPath = path.join(__dirname, 'webview-preload.js');
  const tab: BrowserTab = {
    id: id,
    kind: kind,
    view: new WebContentsView({
      webPreferences: browserTabWebPreferences(kind, preloadPath, JABLE_SESSION_PARTITION)
    }),
    attached: false,
    locked: Boolean(normalizedOptions.locked),
    title: normalizedOptions.title || (kind === 'sync' ? t('browser.sync') : 'Jable'),
    url: targetUrl,
    favicon: normalizedOptions.favicon || '',
    loading: false,
    muted: Boolean(normalizedOptions.muted),
    audible: false,
    mediaPlaying: false,
    pictureInPicture: false,
    discarded: false,
    canGoBack: false,
    canGoForward: false,
    controlledLoad: false,
    lastMainFrameLoadFailure: null
  };

  browserTabs.push(tab);
  browserTabsById[id] = tab;
  webContentsTabIds[String(tab.view.webContents.id)] = id;
  wireBrowserTab(tab);

  if (!activeBrowserTabId || normalizedOptions.active !== false) {
    activeBrowserTabId = id;
  }

  if (targetUrl) loadTabUrl(tab, targetUrl, Boolean(normalizedOptions.forceReload));
  attachActiveBrowserTab();
  if (activeBrowserTabId === tab.id) focusBrowserTab(tab);
  notifyBrowserTabsChanged();
  return browserTabsState();
}

function wireBrowserTab(tab: BrowserTab) {
  registerAppShortcuts(tab.view.webContents);

  if (tab.muted) {
    tab.view.webContents.setAudioMuted(true);
  }

  tab.view.webContents.setWindowOpenHandler(function (details: Electron.HandlerDetails) {
    if (details.url) {
      if (shouldDenyAdNavigation(details.url)) return { action: 'deny' };

      try {
        createBrowserTab({
          url: details.url,
          active: shouldActivateWindowOpen(details)
        });
      } catch (error) {
        forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
      }
    }

    return { action: 'deny' };
  });

  tab.view.webContents.on('will-navigate', function (event: Electron.Event, url: string) {
    if (shouldDenyAdNavigation(url)) event.preventDefault();
  });

  tab.view.webContents.on('page-title-updated', function (_event: Electron.Event, title: string) {
    tab.title = cleanTitle(title) || tab.title;
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('page-favicon-updated', function (_event: Electron.Event, favicons: string[]) {
    if (Array.isArray(favicons) && favicons[0]) {
      tab.favicon = favicons[0];
      notifyBrowserTabsChanged();
    }
  });

  tab.view.webContents.on('did-start-loading', function () {
    tab.loading = true;
    tab.lastMainFrameLoadFailure = null;
    resetBrowserTabMediaState(tab);
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('did-stop-loading', function () {
    tab.loading = false;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('did-finish-load', function () {
    tab.loading = false;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on(
    'did-fail-load',
    function (
      _event: Electron.Event,
      errorCode: number,
      _errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean
    ) {
      tab.loading = false;
      if (isMainFrame) {
        tab.lastMainFrameLoadFailure = {
          url: validatedURL || tab.url,
          errorCode: errorCode
        };
      }
      updateTabNavigationState(tab);
      notifyBrowserTabsChanged();

      if (isMainFrame && !tab.controlledLoad && autoFallbackBrowserTab(tab, tab.lastMainFrameLoadFailure)) return;
    }
  );

  tab.view.webContents.on('render-process-gone', function () {
    rejectBrowserPreloadRequestsForTab(tab.id, 'Browser tab renderer process ended');
  });

  tab.view.webContents.on('destroyed', function () {
    rejectBrowserPreloadRequestsForTab(tab.id, t('errors.tabNotFound'));
  });

  tab.view.webContents.on('did-navigate', function (_event: Electron.Event, url: string) {
    tab.url = url || tab.view.webContents.getURL() || tab.url;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('did-navigate-in-page', function (_event: Electron.Event, url: string) {
    tab.url = url || tab.view.webContents.getURL() || tab.url;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('media-started-playing', function () {
    tab.mediaPlaying = true;
    syncBrowserTabMediaState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('media-paused', function () {
    tab.mediaPlaying = false;
    syncBrowserTabMediaState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('audio-state-changed', function (event: { audible?: boolean }) {
    tab.audible = Boolean(event && event.audible);
    syncBrowserTabMediaState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('enter-html-full-screen', function () {
    enterBrowserHtmlFullScreen(tab);
  });

  tab.view.webContents.on('leave-html-full-screen', function () {
    leaveBrowserHtmlFullScreen(tab);
  });

  tab.view.webContents.on('context-menu', function (_event: Electron.Event, params: Electron.ContextMenuParams) {
    showBrowserContextMenu(tab, params);
  });
}

function cleanTitle(title: unknown): string {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBrowserTab(tabId?: string | null): BrowserTab {
  const id = tabId || activeBrowserTabId;
  const tab = id ? browserTabsById[id] : null;
  const webContents = tab && tab.view ? tab.view.webContents : null;

  if (!tab || !webContents || webContents.isDestroyed()) {
    throw new Error(t('errors.tabNotFound'));
  }

  return tab;
}

function getBrowserTabByWebContents(webContents: Electron.WebContents | null | undefined): BrowserTab | null {
  if (!webContents) return null;
  const tabId = webContentsTabIds[String(webContents.id)];
  return tabId ? browserTabsById[tabId] : null;
}

function normalizeBrowserPreloadResponse(payload: unknown): BrowserPreloadResponse {
  const channel = 'browser:preload-response';
  const record = requiredRecord(payload, channel);
  const ok = optionalBooleanField(record, 'ok', channel);
  const error = optionalStringField(record, 'error', channel);
  const response: BrowserPreloadResponse = {
    requestId: requiredStringValue(record.requestId, 'requestId', channel),
    ok: ok !== false
  };

  if (typeof record.result !== 'undefined') response.result = record.result;
  if (typeof error !== 'undefined') response.error = error;

  return response;
}

function rejectBrowserPreloadRequest(requestId: string, error: Error) {
  const request = browserPreloadRequests[requestId];
  if (!request) return;

  clearTimeout(request.timer);
  delete browserPreloadRequests[requestId];
  request.reject(error);
}

function rejectBrowserPreloadRequestsForWebContents(webContentsId: number, message: string) {
  const requestIds = Object.keys(browserPreloadRequests);

  for (let i = 0; i < requestIds.length; i++) {
    const requestId = requestIds[i];
    const request = browserPreloadRequests[requestId];
    if (request && request.webContentsId === webContentsId) {
      rejectBrowserPreloadRequest(requestId, new Error(message));
    }
  }
}

function rejectBrowserPreloadRequestsForTab(tabId: string, message: string) {
  const tab = browserTabsById[tabId];
  const webContents = tab && tab.view ? tab.view.webContents : null;

  if (!webContents || webContents.isDestroyed()) return;
  rejectBrowserPreloadRequestsForWebContents(webContents.id, message);
}

function resolveBrowserPreloadResponse(event: Electron.IpcMainEvent, payload: unknown) {
  let response: BrowserPreloadResponse;

  try {
    response = normalizeBrowserPreloadResponse(payload);
  } catch (error) {
    return;
  }

  const request = browserPreloadRequests[response.requestId];
  if (!request) return;

  if (event.sender.id !== request.webContentsId) return;

  clearTimeout(request.timer);
  delete browserPreloadRequests[response.requestId];

  if (response.ok) request.resolve(response.result);
  else request.reject(new Error(response.error || 'Browser preload request failed'));
}

function requestWebContentsPreload<T>(
  webContents: Electron.WebContents,
  channel: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  if (webContents.isDestroyed()) return Promise.reject(new Error(t('errors.tabNotFound')));

  const requestId = 'browser-preload-' + nextBrowserPreloadRequestId++;
  const message = Object.assign({}, payload, { requestId: requestId });

  return new Promise<T>(function (resolve, reject) {
    const timer = setTimeout(function () {
      rejectBrowserPreloadRequest(requestId, new Error('Timed out waiting for webview preload response: ' + channel));
    }, timeoutMs);

    browserPreloadRequests[requestId] = {
      webContentsId: webContents.id,
      timer: timer,
      resolve: function (value: unknown) {
        resolve(value as T);
      },
      reject: reject
    };

    try {
      webContents.send(channel, message);
    } catch (error) {
      rejectBrowserPreloadRequest(requestId, new Error(mainErrorMessage(error)));
    }
  });
}

function requestBrowserPreload<T>(
  tab: BrowserTab,
  channel: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  return requestWebContentsPreload<T>(tab.view.webContents, channel, payload, timeoutMs);
}

function createSyncWorker(collectionKey: CollectionKey, syncRunId: string): SyncWorker {
  const preloadPath = path.join(__dirname, 'webview-preload.js');
  const workerWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: browserTabWebPreferences('sync', preloadPath, JABLE_SESSION_PARTITION)
  });
  const worker: SyncWorker = {
    id: 'sync-worker-' + nextSyncWorkerId++,
    window: workerWindow,
    webContents: workerWindow.webContents,
    collectionKey: collectionKey,
    syncRunId: syncRunId,
    lastMainFrameLoadFailure: null
  };

  syncWorkersById[worker.id] = worker;
  wireSyncWorker(worker);
  return worker;
}

function wireSyncWorker(worker: SyncWorker) {
  worker.webContents.setWindowOpenHandler(function (details: Electron.HandlerDetails) {
    if (details.url && shouldDenyAdNavigation(details.url)) return { action: 'deny' };
    return { action: 'deny' };
  });

  worker.webContents.on('will-navigate', function (event: Electron.Event, url: string) {
    if (shouldDenyAdNavigation(url)) event.preventDefault();
  });

  worker.webContents.on(
    'did-fail-load',
    function (
      _event: Electron.Event,
      errorCode: number,
      _errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean
    ) {
      if (!isMainFrame) return;

      worker.lastMainFrameLoadFailure = {
        url: validatedURL || worker.webContents.getURL(),
        errorCode: errorCode
      };
    }
  );

  worker.webContents.on('render-process-gone', function () {
    closeSyncWorker(worker.id, 'Sync worker renderer process ended');
  });

  worker.webContents.on('destroyed', function () {
    closeSyncWorker(worker.id, 'Sync worker was destroyed');
  });

  worker.window.on('closed', function () {
    closeSyncWorker(worker.id, 'Sync worker was closed');
  });
}

function closeSyncWorker(workerId: string | null | undefined, message?: string) {
  if (!workerId) return;

  const worker = syncWorkersById[workerId];
  if (!worker) return;

  delete syncWorkersById[worker.id];
  if (activeSyncRunsByCollection[worker.collectionKey]?.syncRunId === worker.syncRunId) {
    delete activeSyncRunsByCollection[worker.collectionKey];
  }
  rejectBrowserPreloadRequestsForWebContents(worker.webContents.id, message || 'Sync worker closed');

  try {
    if (!worker.window.isDestroyed()) worker.window.destroy();
  } catch (error) {}
}

function closeAllSyncWorkers() {
  const workerIds = Object.keys(syncWorkersById);

  for (let i = 0; i < workerIds.length; i++) {
    closeSyncWorker(workerIds[i], 'Application is quitting');
  }
}

function waitForSyncWorkerStop(worker: SyncWorker, timeoutMs?: number): Promise<string> {
  return new Promise(function (resolve, reject) {
    let done = false;
    const timer = setTimeout(finish, timeoutMs || 25000);

    function cleanup() {
      clearTimeout(timer);
      worker.webContents.removeListener('did-stop-loading', finish);
      worker.webContents.removeListener('destroyed', fail);
    }

    function finish() {
      if (done) return;
      done = true;
      cleanup();
      resolve(worker.webContents.getURL());
    }

    function fail() {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('Sync worker was destroyed while loading'));
    }

    worker.webContents.once('did-stop-loading', finish);
    worker.webContents.once('destroyed', fail);
  });
}

function loadSyncWorkerUrl(worker: SyncWorker, targetUrl: string, forceReload: boolean) {
  const currentUrl = worker.webContents.getURL();
  worker.lastMainFrameLoadFailure = null;

  if (forceReload && currentUrl === targetUrl) worker.webContents.reload();
  else worker.webContents.loadURL(targetUrl);
}

async function loadSyncWorkerCollection(worker: SyncWorker): Promise<string> {
  let targetUrl = urlPolicy.jableCollectionUrl(worker.collectionKey, activeJableOrigin);
  let wait = waitForSyncWorkerStop(worker);
  loadSyncWorkerUrl(worker, targetUrl, true);
  let loadedUrl = await wait;
  const fallbackUrl = fallbackUrlForLoadFailure(worker.lastMainFrameLoadFailure);

  if (fallbackUrl) {
    activateJableFallbackOrigin();
    targetUrl = fallbackUrl;
    wait = waitForSyncWorkerStop(worker);
    loadSyncWorkerUrl(worker, targetUrl, true);
    loadedUrl = await wait;
  }

  return loadedUrl;
}

function syncIncompleteResult(
  options: SyncBrowserCollectionOptions,
  reason: string,
  workerId?: string | null
): SyncResult {
  return {
    completed: false,
    mode: options.mode,
    syncRunId: options.syncRunId,
    syncWorkerId: workerId || null,
    incompleteReason: reason,
    stoppedByKnownPage: false,
    totalPages: 0,
    totalRows: 0,
    lastScrapedPage: options.startPage || null,
    lastKnownUrl: null
  };
}

function setActiveSyncRun(options: SyncBrowserCollectionOptions) {
  activeSyncRunsByCollection[options.collectionKey] = {
    mode: options.mode,
    mutated: false,
    syncRunId: options.syncRunId
  };
  notifyBrowserSyncLocksChanged();
  notifyPendingCollectionOperationsChanged();
}

function clearActiveSyncRun(options: SyncBrowserCollectionOptions) {
  const activeRun = activeSyncRunsByCollection[options.collectionKey];
  if (!activeRun || activeRun.syncRunId !== options.syncRunId) return;
  delete activeSyncRunsByCollection[options.collectionKey];
  notifyBrowserSyncLocksChanged();
  notifyPendingCollectionOperationsChanged();
}

function syncRunForCollection(collectionKey: CollectionKey): ActiveSyncRun | null {
  return activeSyncRunsByCollection[collectionKey] || null;
}

function activeSyncRunsState() {
  const runs: Partial<Record<CollectionKey, { mode: SyncMode; syncRunId: string }>> = {};

  for (const key of Object.keys(activeSyncRunsByCollection) as CollectionKey[]) {
    const activeRun = activeSyncRunsByCollection[key];
    if (activeRun) runs[key] = { mode: activeRun.mode, syncRunId: activeRun.syncRunId };
  }

  return { runs: runs };
}

function pendingCollectionOperationsState(): PendingCollectionOperationOverlayState {
  const collections: Partial<Record<CollectionKey, PendingCollectionOperationOverlay[]>> = {};
  const keys = Object.keys(activeSyncRunsByCollection) as CollectionKey[];

  for (let i = 0; i < keys.length; i++) {
    const collectionKey = keys[i];
    const activeRun = activeSyncRunsByCollection[collectionKey];
    if (!activeRun) continue;

    const latestByUrl: Record<string, PendingCollectionOperationOverlay> = {};
    const operations = getDatabase().listDeferredSyncOutboxOperations(collectionKey);

    for (let n = 0; n < operations.length; n++) {
      const operation = operations[n];
      latestByUrl[operation.videoUrl] = {
        action: operation.action,
        videoUrl: operation.videoUrl,
        remoteVideoId: operation.remoteVideoId,
        remoteFavType: operation.remoteFavType
      };
    }

    collections[collectionKey] = Object.keys(latestByUrl).map(function (url) {
      return latestByUrl[url];
    });
  }

  return { collections: collections };
}

function notifyBrowserSyncLocksChanged() {
  const state = activeSyncRunsState();

  for (let i = 0; i < browserTabs.length; i++) {
    const webContents = browserTabs[i].view.webContents;
    if (!webContents.isDestroyed()) webContents.send('browser:sync-lock-state', state);
  }
}

function notifyPendingCollectionOperationsChanged() {
  const state = pendingCollectionOperationsState();

  for (let i = 0; i < browserTabs.length; i++) {
    const webContents = browserTabs[i].view.webContents;
    if (!webContents.isDestroyed()) webContents.send('browser:pending-collection-operations', state);
  }
}

function markActiveSyncMutated(collectionKey: CollectionKey) {
  const activeRun = activeSyncRunsByCollection[collectionKey];
  if (activeRun) activeRun.mutated = true;
}

function resolveSyncWorker(
  workerId: string | null,
  options: SyncBrowserCollectionOptions
): {
  worker: SyncWorker;
  reused: boolean;
} {
  if (!workerId) {
    return {
      worker: createSyncWorker(options.collectionKey, options.syncRunId),
      reused: false
    };
  }

  const worker = syncWorkersById[workerId];
  if (!worker || worker.webContents.isDestroyed()) {
    closeSyncWorker(workerId, 'Sync continuation expired');
    throw new Error('Sync continuation is no longer available');
  }
  if (worker.collectionKey !== options.collectionKey || worker.syncRunId !== options.syncRunId) {
    throw new Error('Sync continuation does not match the requested collection');
  }

  return {
    worker: worker,
    reused: true
  };
}

function notifySyncQueueProgress(options: SyncBrowserCollectionOptions, payload: SyncQueueProgressInput) {
  forwardBrowserMessage(
    'sync-queue-progress',
    Object.assign(
      {
        collectionKey: options.collectionKey,
        mode: options.mode,
        syncRunId: options.syncRunId
      },
      payload
    )
  );
}

async function applyDeferredSyncOperationsInWorker(
  worker: SyncWorker,
  options: SyncBrowserCollectionOptions
): Promise<{ applied: number; failed: number; failures: SyncQueuedOperationFailure[] }> {
  const operations = getDatabase().listDeferredSyncOutboxOperations(options.collectionKey);
  if (!operations.length) return { applied: 0, failed: 0, failures: [] };
  let applied = 0;
  const failures: SyncQueuedOperationFailure[] = [];

  notifySyncQueueProgress(options, {
    phase: 'start',
    total: operations.length,
    processed: 0,
    applied: 0,
    failed: 0
  });

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    const result = await requestWebContentsPreload<DeferredSyncOperationApplyResult>(
      worker.webContents,
      'browser:apply-deferred-sync-operations-request',
      { operations: [operation] },
      BROWSER_SYNC_REQUEST_TIMEOUT_MS
    );
    const normalized = (result || {}) as DeferredSyncOperationApplyResult;
    const appliedIds = Array.isArray(normalized.applied) ? normalized.applied : [];
    const failedRows = Array.isArray(normalized.failed) ? normalized.failed : [];
    const failedRow =
      failedRows.find(function (row) {
        return !row.blocked;
      }) || failedRows[0];

    if (failedRow) {
      getDatabase().markDeferredSyncOperationFailed(
        options.collectionKey,
        null,
        failedRow.id || operation.id,
        failedRow.message
      );
      failures.push(failedRow);

      for (let blocked = i + 1; blocked < operations.length; blocked++) {
        failures.push({
          id: operations[blocked].id,
          url: operations[blocked].videoUrl,
          message: 'Blocked by earlier failed operation',
          blocked: true
        });
      }

      notifyPendingCollectionOperationsChanged();
      notifySyncQueueProgress(options, {
        phase: 'complete',
        total: operations.length,
        processed: operations.length,
        applied: applied,
        failed: failures.length
      });
      return { applied: applied, failed: failures.length, failures: failures };
    }

    applied += getDatabase().markDeferredSyncOperationsApplied(options.collectionKey, null, appliedIds);
    notifyPendingCollectionOperationsChanged();
    notifySyncQueueProgress(options, {
      phase: i + 1 === operations.length ? 'complete' : 'progress',
      total: operations.length,
      processed: i + 1,
      applied: applied,
      failed: 0
    });
  }

  return { applied: applied, failed: 0, failures: [] };
}

async function applyPendingRemoteOperationGroup(
  groupId: string,
  action: CollectionAction
): Promise<PendingRemoteOperationActionResult> {
  const operation = getDatabase().preparePendingRemoteOperationRetry(groupId);
  const worker = createSyncWorker(operation.collectionKey, 'pending-remote-retry:' + Date.now());

  try {
    const loadedUrl = await loadSyncWorkerCollection(worker);
    if (!urlPolicy.isJableCollectionUrl(operation.collectionKey, loadedUrl)) {
      throw new Error(t('status.loginRequired', { collection: t('collections.' + operation.collectionKey) }));
    }

    const result = await requestWebContentsPreload<DeferredSyncOperationApplyResult>(
      worker.webContents,
      'browser:apply-deferred-sync-operations-request',
      {
        operations: [
          {
            id: operation.id || 0,
            action: action,
            videoUrl: operation.videoUrl,
            remoteVideoId: operation.remoteVideoId || null,
            remoteFavType: operation.remoteFavType || null
          }
        ]
      },
      BROWSER_SYNC_REQUEST_TIMEOUT_MS
    );
    const normalized = (result || {}) as DeferredSyncOperationApplyResult;
    const failed = Array.isArray(normalized.failed) ? normalized.failed[0] : null;

    if (failed) {
      getDatabase().markPendingRemoteOperationGroupFailed(groupId, failed.message);
      notifyPendingCollectionOperationsChanged();
      return Object.assign({}, operation, {
        resolved: false,
        error: failed.message || t('status.unknownError')
      });
    }

    if (action === 'remove') {
      getDatabase().markPendingRemoteOperationGroupRemoved(groupId);
    } else {
      getDatabase().markPendingRemoteOperationGroupAdded(groupId);
    }
    notifyPendingCollectionOperationsChanged();
    return Object.assign({}, operation, { resolved: true, error: null });
  } catch (error) {
    const message = mainErrorMessage(error);
    getDatabase().markPendingRemoteOperationGroupFailed(groupId, message);
    notifyPendingCollectionOperationsChanged();
    return Object.assign({}, operation, { resolved: false, error: message });
  } finally {
    closeSyncWorker(worker.id, 'Pending remote retry finished');
  }
}

async function addPendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult> {
  return applyPendingRemoteOperationGroup(groupId, 'add');
}

async function removePendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult> {
  return applyPendingRemoteOperationGroup(groupId, 'remove');
}

function resolvePendingRemoteOperationGroup(groupId: string): PendingRemoteOperationActionResult {
  const operation = getDatabase().preparePendingRemoteOperationRetry(groupId);
  const resolved = getDatabase().markPendingRemoteOperationGroupResolved(groupId);
  notifyPendingCollectionOperationsChanged();
  return Object.assign({}, operation, { resolved: resolved, error: null });
}

function shouldApplyDeferredSyncOperations(result: SyncResult) {
  if (result.incompleteReason === 'login-required') return false;
  if (result.incompleteReason === 'batch-limit') return false;
  return true;
}

async function syncBrowserCollectionInWorker(payload: {
  tabId: string | null;
  options: SyncBrowserCollectionOptions;
}): Promise<SyncResult> {
  const resolved = resolveSyncWorker(payload.tabId, payload.options);
  const worker = resolved.worker;
  let keepWorker = false;

  setActiveSyncRun(payload.options);

  try {
    if (!resolved.reused) {
      const loadedUrl = await loadSyncWorkerCollection(worker);
      if (!urlPolicy.isJableCollectionUrl(payload.options.collectionKey, loadedUrl)) {
        return syncIncompleteResult(payload.options, 'login-required', worker.id);
      }
    }

    const result = await requestWebContentsPreload<SyncResult>(
      worker.webContents,
      'browser:sync-collection-request',
      { options: payload.options },
      BROWSER_SYNC_REQUEST_TIMEOUT_MS
    );
    const activeRun = syncRunForCollection(payload.options.collectionKey);
    const resultWithWorker = Object.assign({}, result, { syncWorkerId: worker.id });

    if (payload.options.mode === 'full' && activeRun && activeRun.mutated) {
      resultWithWorker.completed = false;
      resultWithWorker.incompleteReason = 'collection-mutated-during-sync';
    }

    keepWorker = resultWithWorker.completed === false && resultWithWorker.incompleteReason === 'batch-limit';

    if (
      !keepWorker &&
      shouldApplyDeferredSyncOperations(resultWithWorker) &&
      getAppSettings().autoReplayDeferredSyncOperations
    ) {
      const applied = await applyDeferredSyncOperationsInWorker(worker, payload.options);
      resultWithWorker.queuedOperationsApplied = applied.applied;
      resultWithWorker.queuedOperationsFailed = applied.failed;
      resultWithWorker.queuedOperationFailures = applied.failures;
    } else if (!keepWorker && shouldApplyDeferredSyncOperations(resultWithWorker)) {
      const skipped = getDatabase().listDeferredSyncOutboxOperations(payload.options.collectionKey).length;
      resultWithWorker.queuedOperationsSkipped = skipped;
      if (skipped) notifyPendingCollectionOperationsChanged();
    }

    return resultWithWorker;
  } finally {
    if (!keepWorker) clearActiveSyncRun(payload.options);
    if (!keepWorker) closeSyncWorker(worker.id, 'Sync worker finished');
  }
}

function resetBrowserTabMediaState(tab: BrowserTab | null | undefined) {
  if (!tab) return;

  tab.audible = false;
  tab.mediaPlaying = false;
  tab.pictureInPicture = false;
}

function syncBrowserTabMediaState(tab: BrowserTab | null | undefined) {
  if (!tab) return;

  const webContents = tab.view.webContents;

  if (!webContents || webContents.isDestroyed()) return;

  try {
    tab.muted = webContents.isAudioMuted();
  } catch (error) {}

  try {
    tab.audible = webContents.isCurrentlyAudible();
  } catch (error) {}
}

function serializeBrowserTab(tab: BrowserTab) {
  updateTabNavigationState(tab);
  syncBrowserTabMediaState(tab);

  const mediaState = serializedMediaState(tab);

  return {
    id: tab.id,
    kind: tab.kind,
    title: tab.title || t('browser.newPage'),
    url: tab.url || '',
    favicon: tab.favicon || '',
    loading: Boolean(tab.loading),
    locked: Boolean(tab.locked),
    muted: mediaState.muted,
    audible: mediaState.audible,
    mediaPlaying: mediaState.mediaPlaying,
    pictureInPicture: mediaState.pictureInPicture,
    discarded: mediaState.discarded,
    canGoBack: Boolean(tab.canGoBack),
    canGoForward: Boolean(tab.canGoForward)
  };
}

function browserTabsState(): BrowserTabsState {
  return {
    activeTabId: activeBrowserTabId,
    maxTabs: getAppSettings().maxBrowserTabs,
    tabs: browserTabs.map(serializeBrowserTab)
  };
}

function updateTabNavigationState(tab: BrowserTab | null | undefined) {
  const webContents = tab && tab.view ? tab.view.webContents : null;

  if (!tab || !webContents || webContents.isDestroyed()) {
    if (tab) {
      tab.canGoBack = false;
      tab.canGoForward = false;
    }
    return;
  }

  const history = webContents.navigationHistory;
  tab.url = webContents.getURL() || tab.url;
  tab.canGoBack = history.canGoBack();
  tab.canGoForward = history.canGoForward();
}

function notifyBrowserTabsChanged() {
  forwardBrowserMessage('browser-tabs-changed', browserTabsState());
  forwardBrowserMessage('browser-navigation-state', browserNavigationState());
}

function browserNavigationState(tabId?: string | null): BrowserNavigationState {
  let tab: BrowserTab | null = null;

  try {
    tab = getBrowserTab(tabId);
  } catch (error) {
    return { canGoBack: false, canGoForward: false, locked: false };
  }

  updateTabNavigationState(tab);

  return {
    tabId: tab.id,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    locked: tab.locked
  };
}

function detachBrowserTab(tab: BrowserTab | null | undefined) {
  if (!mainWindow || mainWindow.isDestroyed() || !tab || !tab.attached) return;
  mainWindow.contentView.removeChildView(tab.view);
  tab.attached = false;
}

function detachAllBrowserTabs() {
  for (let i = 0; i < browserTabs.length; i++) {
    detachBrowserTab(browserTabs[i]);
  }
}

function focusBrowserTab(tab: BrowserTab | null | undefined) {
  if (!tab || !browserBounds.visible || !mainWindow || mainWindow.isDestroyed()) return;

  setImmediate(function () {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!browserBounds.visible || activeBrowserTabId !== tab.id || !tab.attached) return;
    if (tab.view.webContents.isDestroyed()) return;

    mainWindow.focus();
    tab.view.webContents.focus();
  });
}

function attachActiveBrowserTab() {
  let activeTab: BrowserTab | null = null;
  let bounds: BrowserBoundsState | null = null;

  try {
    activeTab = getBrowserTab();
  } catch (error) {
    return;
  }

  for (let i = 0; i < browserTabs.length; i++) {
    if (browserTabs[i] !== activeTab) detachBrowserTab(browserTabs[i]);
  }

  if (!browserBounds.visible || !mainWindow || mainWindow.isDestroyed()) return;

  if (!activeTab.attached) {
    mainWindow.contentView.addChildView(activeTab.view);
    activeTab.attached = true;
  }

  bounds = browserTabBounds(activeTab);
  activeTab.view.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  });
}

function browserTabBounds(tab: BrowserTab): BrowserBoundsState {
  // HTML fullscreen expands only within WebContentsView bounds, so stretch the view over the app chrome.
  if (browserHtmlFullScreenTabId === tab.id && mainWindow && !mainWindow.isDestroyed()) {
    const size = mainWindow.getContentSize();

    return {
      visible: true,
      x: 0,
      y: 0,
      width: Math.max(320, Math.floor(size[0] || 0)),
      height: Math.max(320, Math.floor(size[1] || 0))
    };
  }

  return browserBounds;
}

function scheduleBrowserHtmlFullScreenResize() {
  if (!browserHtmlFullScreenTabId) return;

  setImmediate(function () {
    if (!browserHtmlFullScreenTabId) return;
    attachActiveBrowserTab();
  });
}

function enterBrowserHtmlFullScreen(tab: BrowserTab | null | undefined) {
  if (!tab || !mainWindow || mainWindow.isDestroyed()) return;

  browserHtmlFullScreenTabId = tab.id;
  activeBrowserTabId = tab.id;
  attachActiveBrowserTab();
  focusBrowserTab(tab);
}

function leaveBrowserHtmlFullScreen(tab: BrowserTab | null | undefined) {
  if (!tab || browserHtmlFullScreenTabId !== tab.id) return;

  browserHtmlFullScreenTabId = null;
  attachActiveBrowserTab();
  focusBrowserTab(tab);
}

function setBrowserBounds(bounds: BrowserBounds | null | undefined): BrowserBounds | null {
  if (!bounds) return null;

  if (bounds.visible === false) {
    browserBounds.visible = false;
    detachAllBrowserTabs();
    return { visible: false };
  }

  browserBounds = {
    visible: true,
    x: Math.max(0, Math.floor(bounds.x || 0)),
    y: Math.max(0, Math.floor(bounds.y || 0)),
    width: Math.max(320, Math.floor(bounds.width || 0)),
    height: Math.max(320, Math.floor(bounds.height || 0))
  };

  attachActiveBrowserTab();
  return Object.assign({}, browserBounds);
}

function activateBrowserTab(tabId: string | null): BrowserTabsState {
  const tab = getBrowserTab(tabId);
  if (browserHtmlFullScreenTabId && browserHtmlFullScreenTabId !== tab.id) {
    browserHtmlFullScreenTabId = null;
  }
  activeBrowserTabId = tab.id;
  attachActiveBrowserTab();
  focusBrowserTab(tab);
  notifyBrowserTabsChanged();
  return browserTabsState();
}

function closeBrowserTab(tabId: string | null): BrowserTabsState {
  const tab = getBrowserTab(tabId);
  if (tab.locked) throw new Error(t('errors.lockedClose'));

  const shouldFocusNextTab = activeBrowserTabId === tab.id;
  const nextActiveTabId = nextActiveTabIdAfterClose(browserTabs, activeBrowserTabId, tab.id);
  rejectBrowserPreloadRequestsForTab(tab.id, t('errors.tabNotFound'));
  detachBrowserTab(tab);
  delete browserTabsById[tab.id];
  delete webContentsTabIds[String(tab.view.webContents.id)];
  if (browserHtmlFullScreenTabId === tab.id) browserHtmlFullScreenTabId = null;
  browserTabs.splice(browserTabs.indexOf(tab), 1);

  try {
    tab.view.webContents.close({ waitForBeforeUnload: false });
  } catch (error) {}

  if (activeBrowserTabId === tab.id) {
    activeBrowserTabId = nextActiveTabId;
  }

  if (!browserTabs.length) {
    createBrowserTab({ url: JABLE_HOME_URL, active: true });
    return browserTabsState();
  }

  attachActiveBrowserTab();
  if (shouldFocusNextTab) focusBrowserTab(getBrowserTab());
  notifyBrowserTabsChanged();
  return browserTabsState();
}

function setBrowserTabLocked(payload?: BrowserTabLockedPayload | null): BrowserTabsState {
  const normalizedPayload: BrowserTabLockedPayload = payload || { locked: false };
  const tab = getBrowserTab(normalizedPayload.tabId);
  tab.locked = Boolean(normalizedPayload.locked);
  notifyBrowserTabsChanged();
  return browserTabsState();
}

function setBrowserTabMuted(payload?: BrowserTabMutedPayload | null): BrowserTabsState {
  const normalizedPayload: BrowserTabMutedPayload = payload || { muted: false };
  const tab = getBrowserTab(normalizedPayload.tabId);

  tab.view.webContents.setAudioMuted(Boolean(normalizedPayload.muted));
  syncBrowserTabMediaState(tab);
  notifyBrowserTabsChanged();
  return browserTabsState();
}

function waitForBrowserStop(tab: BrowserTab, timeoutMs?: number): Promise<string> {
  return new Promise(function (resolve) {
    let done = false;
    const timer = setTimeout(finish, timeoutMs || 25000);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      tab.view.webContents.removeListener('did-stop-loading', finish);
      updateTabNavigationState(tab);
      resolve(tab.view.webContents.getURL());
    }

    tab.view.webContents.once('did-stop-loading', finish);
  });
}

function loadTabUrl(tab: BrowserTab, targetUrl: string, forceReload: boolean) {
  targetUrl = normalizeBrowserNavigationUrl(targetUrl);
  const currentUrl = tab.view.webContents.getURL();
  tab.url = targetUrl || tab.url;
  tab.loading = true;
  tab.lastMainFrameLoadFailure = null;

  if (forceReload && currentUrl === targetUrl) tab.view.webContents.reload();
  else tab.view.webContents.loadURL(targetUrl);

  updateTabNavigationState(tab);
  notifyBrowserTabsChanged();
}

async function navigateBrowser(payload?: BrowserNavigatePayload | null): Promise<string> {
  const normalizedPayload: BrowserNavigatePayload = payload || { url: '' };
  const tab = getBrowserTab(normalizedPayload.tabId);
  const targetUrl = normalizeBrowserNavigationUrl(normalizedPayload.url);

  if (!targetUrl) return tab.view.webContents.getURL();
  if (tab.locked) throw new Error(t('errors.lockedNavigate'));

  tab.controlledLoad = true;

  try {
    let wait = waitForBrowserStop(tab);
    loadTabUrl(tab, targetUrl, Boolean(normalizedPayload.forceReload));
    let loadedUrl = await wait;
    const fallbackUrl = fallbackUrlForLoadFailure(tab.lastMainFrameLoadFailure);

    if (fallbackUrl) {
      activateJableFallbackOrigin();
      wait = waitForBrowserStop(tab);
      loadTabUrl(tab, fallbackUrl, true);
      loadedUrl = await wait;
    }

    notifyBrowserTabsChanged();
    return loadedUrl;
  } finally {
    tab.controlledLoad = false;
  }
}

async function reloadBrowser(tabId?: string | null): Promise<BrowserNavigationState> {
  const tab = getBrowserTab(tabId);
  if (tab.locked) throw new Error(t('errors.lockedReload'));

  tab.view.webContents.reload();
  updateTabNavigationState(tab);
  notifyBrowserTabsChanged();
  return Object.assign({ reloaded: true }, browserNavigationState(tab.id));
}

async function goBrowserBack(tabId?: string | null): Promise<BrowserNavigationState> {
  let tab: BrowserTab | null = null;

  try {
    tab = getBrowserTab(tabId);
  } catch (error) {
    notifyBrowserTabsChanged();
    return browserNavigationState(tabId);
  }

  if (tab.locked) {
    notifyBrowserTabsChanged();
    return browserNavigationState(tab.id);
  }

  const history = tab.view.webContents.navigationHistory;

  if (history.canGoBack()) {
    const wait = waitForBrowserStop(tab);
    history.goBack();
    await wait;
  }

  notifyBrowserTabsChanged();
  return browserNavigationState(tab.id);
}

async function goBrowserForward(tabId?: string | null): Promise<BrowserNavigationState> {
  let tab: BrowserTab | null = null;

  try {
    tab = getBrowserTab(tabId);
  } catch (error) {
    notifyBrowserTabsChanged();
    return browserNavigationState(tabId);
  }

  if (tab.locked) {
    notifyBrowserTabsChanged();
    return browserNavigationState(tab.id);
  }

  const history = tab.view.webContents.navigationHistory;

  if (history.canGoForward()) {
    const wait = waitForBrowserStop(tab);
    history.goForward();
    await wait;
  }

  notifyBrowserTabsChanged();
  return browserNavigationState(tab.id);
}

function safeCreateBrowserTab(options?: CreateBrowserTabPayload | null): BrowserTabsState {
  try {
    return createBrowserTab(options);
  } catch (error) {
    forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
    return browserTabsState();
  }
}

function copyText(value: unknown) {
  if (!value) return;
  clipboard.writeText(String(value));
}

function exportFilenameForCollection(collectionKey: CollectionKey): string {
  for (let i = 0; i < COLLECTIONS.length; i++) {
    if (COLLECTIONS[i].key === collectionKey) {
      return collectionKey === 'watch_later' ? 'watch_later_list.json' : 'favourites_list.json';
    }
  }

  throw new Error('Unknown collection: ' + collectionKey);
}

async function exportJsonFile(collectionKey: CollectionKey): Promise<ExportJsonFileResult> {
  const filename = exportFilenameForCollection(collectionKey);
  const dialogOptions = {
    title: t('dialog.exportJson'),
    defaultPath: path.join(app.getPath('downloads'), filename),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showSaveDialog(mainWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) return { canceled: true };

  const exported = await getDatabase().exportResourceToFile(collectionKey, result.filePath);

  return {
    canceled: false,
    filename: path.basename(exported.filePath),
    total: exported.total
  };
}

function contextMediaLabel(mediaType: string): string {
  if (mediaType === 'image') return t('media.image');
  if (mediaType === 'video') return t('media.video');
  if (mediaType === 'audio') return t('media.audio');
  return t('media.media');
}

function pushSeparator(items: Electron.MenuItemConstructorOptions[]) {
  if (!items.length || items[items.length - 1].type === 'separator') return;
  items.push({ type: 'separator' });
}

function showBrowserContextMenu(tab: BrowserTab, params: Electron.ContextMenuParams) {
  if (!mainWindow || mainWindow.isDestroyed() || !tab) return;

  const contextParams = params || ({} as Electron.ContextMenuParams);

  if (contextParams.isEditable) {
    showEditableContextMenu(tab, contextParams);
    return;
  }

  const items: Electron.MenuItemConstructorOptions[] = [];
  const linkUrl = contextParams.linkURL || '';
  const srcUrl = contextParams.srcURL || '';
  const selectionText = String(contextParams.selectionText || '').trim();

  if (linkUrl) {
    items.push({
      label: t('context.openLinkInBackground'),
      click: function () {
        safeCreateBrowserTab({ url: linkUrl, active: false });
      }
    });
    items.push({
      label: t('context.copyLinkUrl'),
      click: function () {
        copyText(linkUrl);
      }
    });
  }

  if (srcUrl) {
    if (items.length) pushSeparator(items);

    const mediaLabel = contextMediaLabel(contextParams.mediaType);
    items.push({
      label: t('context.openMediaInBackground', { media: mediaLabel }),
      click: function () {
        safeCreateBrowserTab({ url: srcUrl, active: false });
      }
    });
    items.push({
      label: t('context.copyMediaUrl', { media: mediaLabel }),
      click: function () {
        copyText(srcUrl);
      }
    });
  }

  if (selectionText) {
    if (items.length) pushSeparator(items);
    items.push({
      label: t('context.copySelection'),
      click: function () {
        copyText(selectionText);
      }
    });
  }

  if (items.length) pushSeparator(items);

  items.push({
    label: t('context.back'),
    enabled: tab.canGoBack && !tab.locked,
    click: function () {
      goBrowserBack(tab.id);
    }
  });
  items.push({
    label: t('context.forward'),
    enabled: tab.canGoForward && !tab.locked,
    click: function () {
      goBrowserForward(tab.id);
    }
  });
  items.push({
    label: t('context.reload'),
    enabled: !tab.locked,
    click: function () {
      reloadBrowser(tab.id);
    }
  });

  pushSeparator(items);

  items.push({
    label: t('context.newTab'),
    enabled: browserTabs.length < getAppSettings().maxBrowserTabs,
    click: function () {
      safeCreateBrowserTab({ url: JABLE_HOME_URL, active: true });
    }
  });
  items.push({
    label: t('context.copyCurrentPageUrl'),
    enabled: Boolean(tab.url || contextParams.pageURL),
    click: function () {
      copyText(tab.url || contextParams.pageURL);
    }
  });

  Menu.buildFromTemplate(items).popup({ window: mainWindow });
}

function showBrowserTabMenu(payload?: BrowserTabMenuPayload | null): { shown: boolean } {
  if (!mainWindow || mainWindow.isDestroyed()) return { shown: false };

  const normalizedPayload: BrowserTabMenuPayload = payload || {};
  const tab = getBrowserTab(normalizedPayload.tabId);
  syncBrowserTabMediaState(tab);

  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('context.newTab'),
      enabled: browserTabs.length < getAppSettings().maxBrowserTabs,
      click: function () {
        safeCreateBrowserTab({ url: JABLE_HOME_URL, active: true });
      }
    },
    {
      label: t('context.switchToTab'),
      enabled: activeBrowserTabId !== tab.id,
      click: function () {
        activateBrowserTab(tab.id);
      }
    },
    {
      label: t('context.reloadTab'),
      enabled: !tab.locked,
      click: function () {
        reloadBrowser(tab.id);
      }
    },
    {
      label: tab.muted ? t('context.unmuteTab') : t('context.muteTab'),
      click: function () {
        setBrowserTabMuted({ tabId: tab.id, muted: !tab.muted });
      }
    },
    {
      label: t('context.copyTabUrl'),
      enabled: Boolean(tab.url),
      click: function () {
        copyText(tab.url);
      }
    },
    { type: 'separator' },
    {
      label: t('context.compactMode'),
      type: 'checkbox',
      checked: Boolean(normalizedPayload.compactMode),
      click: function (menuItem: Electron.MenuItem) {
        forwardBrowserMessage('browser-tabs-compact-mode', { compact: Boolean(menuItem.checked) });
      }
    },
    { type: 'separator' },
    {
      label: t('context.closeTab'),
      enabled: !tab.locked,
      click: function () {
        closeBrowserTab(tab.id);
      }
    }
  ];
  const popupOptions: PopupOptions = { window: mainWindow };

  if (typeof normalizedPayload.x === 'number' && typeof normalizedPayload.y === 'number') {
    popupOptions.x = Math.round(normalizedPayload.x);
    popupOptions.y = Math.round(normalizedPayload.y);
  }

  Menu.buildFromTemplate(items).popup(popupOptions);
  return { shown: true };
}

function showLibraryVideoMenu(payload?: LibraryVideoMenuPayload | null): { shown: boolean } {
  if (!mainWindow || mainWindow.isDestroyed()) return { shown: false };

  const normalizedPayload: LibraryVideoMenuPayload = payload || { url: '' };
  const url = normalizedPayload.url || '';

  if (!url) return { shown: false };

  let activeTab: BrowserTab | null = null;

  try {
    activeTab = getBrowserTab(activeBrowserTabId);
  } catch (error) {
    activeTab = null;
  }

  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('context.openCurrentTab'),
      enabled: Boolean(activeTab && !activeTab.locked),
      click: function () {
        forwardBrowserMessage('library-video-menu-action', {
          action: 'open-current',
          url: url
        });
      }
    },
    {
      label: t('context.openNewTab'),
      enabled: browserTabs.length < getAppSettings().maxBrowserTabs,
      click: function () {
        forwardBrowserMessage('library-video-menu-action', {
          action: 'open-new',
          url: url
        });
      }
    },
    { type: 'separator' },
    {
      label: t('context.copyUrl'),
      click: function () {
        copyText(url);
      }
    }
  ];
  const popupOptions: PopupOptions = { window: mainWindow };

  if (typeof normalizedPayload.x === 'number' && typeof normalizedPayload.y === 'number') {
    popupOptions.x = Math.round(normalizedPayload.x);
    popupOptions.y = Math.round(normalizedPayload.y);
  }

  Menu.buildFromTemplate(items).popup(popupOptions);
  return { shown: true };
}

function showEditableContextMenu(tab: BrowserTab, params: Electron.ContextMenuParams) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const browserWindow = mainWindow;
  const contextParams = params || ({} as Electron.ContextMenuParams);
  const editFlags = contextParams.editFlags || {};
  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('context.undo'),
      enabled: Boolean(editFlags.canUndo),
      click: function () {
        tab.view.webContents.undo();
      }
    },
    {
      label: t('context.redo'),
      enabled: Boolean(editFlags.canRedo),
      click: function () {
        tab.view.webContents.redo();
      }
    },
    { type: 'separator' },
    {
      label: t('context.cut'),
      enabled: Boolean(editFlags.canCut),
      click: function () {
        tab.view.webContents.cut();
      }
    },
    {
      label: t('context.copy'),
      enabled: Boolean(editFlags.canCopy),
      click: function () {
        tab.view.webContents.copy();
      }
    },
    {
      label: t('context.paste'),
      enabled: Boolean(editFlags.canPaste),
      click: function () {
        tab.view.webContents.paste();
      }
    },
    { type: 'separator' },
    {
      label: t('context.selectAll'),
      enabled: Boolean(editFlags.canSelectAll),
      click: function () {
        tab.view.webContents.selectAll();
      }
    }
  ];

  Menu.buildFromTemplate(items).popup({ window: browserWindow });
}

function forwardBrowserMessage(channel: string, payload: unknown) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('browser-message', {
    channel: channel,
    args: [payload]
  });
}

function syncPayloadForEvent(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, payload: unknown) {
  const tab = getBrowserTabByWebContents(event.sender);
  const normalizedPayload = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return Object.assign({}, normalizedPayload, {
    tabId: tab ? tab.id : null
  });
}

function registerIpcHandlers() {
  ipcMain.handle('app:info', function () {
    getDatabase();

    return {
      databasePath: databasePath,
      locale: currentLocale,
      systemLocale: app.getLocale()
    };
  });

  ipcMain.handle('app:get-settings', function () {
    return getAppSettings();
  });

  ipcMain.handle('app:update-settings', function (_event, patch) {
    return updateAppSettings(patch);
  });

  ipcMain.handle('app:set-locale', function (_event, locale) {
    return {
      locale: setCurrentLocale(locale)
    };
  });

  ipcMain.handle('app:get-ffmpeg-status', function () {
    return getFfmpegStatus();
  });

  ipcMain.handle('app:refresh-ffmpeg-status', function () {
    return getFfmpegStatus();
  });

  ipcMain.handle('app:choose-ffmpeg-path', function () {
    return chooseFfmpegPath();
  });

  ipcMain.handle('app:set-ffmpeg-path', function (_event, filePath) {
    return setFfmpegPath(filePath);
  });

  ipcMain.handle('app:clear-ffmpeg-path', function () {
    return clearFfmpegPath();
  });

  ipcMain.handle('app:get-download-root', function () {
    return getDownloadRoot();
  });

  ipcMain.handle('app:choose-download-root', function () {
    return chooseDownloadRoot();
  });

  ipcMain.handle('app:set-download-root', function (_event, filePath) {
    return setDownloadRoot(filePath);
  });

  ipcMain.handle('app:clear-download-root', function () {
    return clearDownloadRoot();
  });

  ipcMain.handle('app:open-download-root', function () {
    return openDownloadRoot();
  });

  ipcMain.handle('download:list', function () {
    return listDownloads();
  });

  ipcMain.handle('download:enqueue', function (_event, payload) {
    return enqueueDownload(payload);
  });

  ipcMain.handle('download:retry', function (_event, videoUrl) {
    return retryDownload(videoUrl);
  });

  ipcMain.handle('download:cancel', function (_event, videoUrl) {
    return cancelDownload(videoUrl);
  });

  ipcMain.handle('download:open-file', function (_event, videoUrl) {
    return openDownloadFile(videoUrl);
  });

  ipcMain.handle('download:reveal-file', function (_event, videoUrl) {
    return revealDownloadFile(videoUrl);
  });

  ipcMain.handle('download:delete', function (_event, videoUrl) {
    return deleteDownload(videoUrl);
  });

  ipcMain.handle('app:open-local-data-folder', function () {
    return openLocalDataFolder();
  });

  ipcMain.handle('app:check-for-updates', function () {
    return checkForUpdates({ manual: true });
  });

  ipcMain.handle('db:list-videos', function (_event, options) {
    const normalizedOptions = normalizeListVideosOptions(options, 'db:list-videos');
    return getDatabase().listVideos(normalizedOptions.collectionKey, normalizedOptions);
  });

  ipcMain.handle('db:count-videos', function (_event, options) {
    const normalizedOptions = normalizeListVideosOptions(options, 'db:count-videos');
    return getDatabase().countVideos(normalizedOptions.collectionKey, normalizedOptions);
  });

  ipcMain.handle('db:collection-urls', function (_event, collectionKey) {
    return getDatabase().getCollectionUrls(normalizeCollectionKey(collectionKey, 'db:collection-urls'));
  });

  ipcMain.handle('db:collection-urls-known', function (_event, payload) {
    const normalizedPayload = normalizeCollectionUrlsKnownPayload(payload);
    return getDatabase().allCollectionUrlsKnown(normalizedPayload.collectionKey, normalizedPayload.urls);
  });

  ipcMain.handle('db:save-sync-page', function (_event, payload) {
    return getDatabase().saveSyncPage(normalizeSyncPagePayload(payload));
  });

  ipcMain.handle('db:apply-collection-toggle', function (event, payload) {
    try {
      const normalizedPayload = normalizeCollectionTogglePayload(payload);
      const activeRun = syncRunForCollection(normalizedPayload.collectionKey as CollectionKey);
      if (activeRun) {
        if (normalizedPayload.deferRemote !== true) {
          markActiveSyncMutated(normalizedPayload.collectionKey as CollectionKey);
        } else {
          normalizedPayload.deferLocal = true;
        }
        normalizedPayload.syncRunId = activeRun.syncRunId;
      }

      const result = getDatabase().applyCollectionToggle(normalizedPayload);
      forwardBrowserMessage('collection-toggle', syncPayloadForEvent(event, result));
      if (result.queued) notifyPendingCollectionOperationsChanged();
      return result;
    } catch (error) {
      forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
      throw error;
    }
  });

  ipcMain.handle('db:finish-sync', function (_event, payload) {
    return getDatabase().finishSync(normalizeFinishSyncPayload(payload));
  });

  ipcMain.handle('db:clear-sync-state', function (_event, collectionKey) {
    return getDatabase().clearSyncState(normalizeCollectionKey(collectionKey, 'db:clear-sync-state'));
  });

  ipcMain.handle('db:import-json', function (_event, payload) {
    const normalizedPayload = normalizeImportJsonPayload(payload);
    return getDatabase().importResource(normalizedPayload.collectionKey, normalizedPayload.resource);
  });

  ipcMain.handle('db:export-json', function (_event, collectionKey) {
    return getDatabase().exportResource(normalizeCollectionKey(collectionKey, 'db:export-json'));
  });

  ipcMain.handle('db:export-json-file', function (_event, collectionKey) {
    return exportJsonFile(normalizeCollectionKey(collectionKey, 'db:export-json-file'));
  });

  ipcMain.handle('db:list-pending-remote-operation-groups', function () {
    return getDatabase().listPendingRemoteOperationGroups();
  });

  ipcMain.handle('db:add-pending-remote-operation-group', function (_event, groupId) {
    return addPendingRemoteOperationGroup(
      requiredStringValue(groupId, 'groupId', 'db:add-pending-remote-operation-group')
    );
  });

  ipcMain.handle('db:remove-pending-remote-operation-group', function (_event, groupId) {
    return removePendingRemoteOperationGroup(
      requiredStringValue(groupId, 'groupId', 'db:remove-pending-remote-operation-group')
    );
  });

  ipcMain.handle('db:resolve-pending-remote-operation-group', function (_event, groupId) {
    return resolvePendingRemoteOperationGroup(
      requiredStringValue(groupId, 'groupId', 'db:resolve-pending-remote-operation-group')
    );
  });

  ipcMain.handle('library:show-video-menu', function (_event, payload) {
    return showLibraryVideoMenu(normalizeLibraryVideoMenuPayload(payload));
  });

  ipcMain.handle('browser:list-tabs', function () {
    return browserTabsState();
  });

  ipcMain.handle('browser:active-sync-runs', function () {
    return activeSyncRunsState();
  });

  ipcMain.handle('browser:pending-collection-operations', function () {
    return pendingCollectionOperationsState();
  });

  ipcMain.handle('browser:show-tab-menu', function (_event, payload) {
    return showBrowserTabMenu(normalizeBrowserTabMenuPayload(payload));
  });

  ipcMain.handle('browser:create-tab', function (_event, payload) {
    return createBrowserTab(normalizeCreateBrowserTabPayload(payload));
  });

  ipcMain.handle('browser:activate-tab', function (_event, tabId) {
    return activateBrowserTab(normalizeTabIdValue(tabId, 'browser:activate-tab'));
  });

  ipcMain.handle('browser:close-tab', function (_event, tabId) {
    return closeBrowserTab(normalizeTabIdValue(tabId, 'browser:close-tab'));
  });

  ipcMain.handle('browser:set-tab-locked', function (_event, payload) {
    return setBrowserTabLocked(normalizeBrowserTabLockedPayload(payload));
  });

  ipcMain.handle('browser:set-tab-muted', function (_event, payload) {
    return setBrowserTabMuted(normalizeBrowserTabMutedPayload(payload));
  });

  ipcMain.handle('browser:set-bounds', function (_event, bounds) {
    return setBrowserBounds(normalizeBrowserBounds(bounds));
  });

  ipcMain.handle('browser:navigate', function (_event, payload) {
    return navigateBrowser(normalizeBrowserNavigatePayload(payload));
  });

  ipcMain.handle('browser:reload', async function (_event, payload) {
    return reloadBrowser(normalizeBrowserTabPayload(payload, 'browser:reload').tabId);
  });

  ipcMain.handle('browser:go-back', async function (_event, payload) {
    return goBrowserBack(normalizeBrowserTabPayload(payload, 'browser:go-back').tabId);
  });

  ipcMain.handle('browser:go-forward', async function (_event, payload) {
    return goBrowserForward(normalizeBrowserTabPayload(payload, 'browser:go-forward').tabId);
  });

  ipcMain.handle('browser:navigation-state', function (_event, payload) {
    return browserNavigationState(normalizeBrowserTabPayload(payload, 'browser:navigation-state').tabId);
  });

  ipcMain.handle('browser:get-url', function (_event, payload) {
    return getBrowserTab(normalizeBrowserTabPayload(payload, 'browser:get-url').tabId).view.webContents.getURL();
  });

  ipcMain.handle('browser:sync-collection', function (_event, payload) {
    const normalizedPayload = normalizeBrowserSyncCollectionPayload(payload);
    return syncBrowserCollectionInWorker(browserSyncCollectionPayloadWithSettings(normalizedPayload));
  });

  ipcMain.handle('browser:diagnose', function (_event, payload) {
    const tab = getBrowserTab(normalizeBrowserTabPayload(payload, 'browser:diagnose').tabId);
    return requestBrowserPreload<BrowserDiagnosis>(
      tab,
      'browser:diagnose-request',
      {},
      BROWSER_DIAGNOSE_REQUEST_TIMEOUT_MS
    );
  });

  ipcMain.on('browser:preload-response', resolveBrowserPreloadResponse);

  ipcMain.on('browser:sync-page', function (event, payload) {
    forwardBrowserMessage('sync-page', syncPayloadForEvent(event, payload));
  });

  ipcMain.on('browser:sync-progress', function (event, payload) {
    forwardBrowserMessage('sync-progress', syncPayloadForEvent(event, payload));
  });

  ipcMain.on('browser:trackpad-history', function (event, direction) {
    const tab = getBrowserTabByWebContents(event.sender);
    if (!tab) return;

    if (direction === 'back') goBrowserBack(tab.id);
    else if (direction === 'forward') goBrowserForward(tab.id);
  });

  ipcMain.on('browser:open-url-new-tab', function (event, payload) {
    const tab = getBrowserTabByWebContents(event.sender);
    if (!tab) return;

    payload = payload || {};
    if (!payload.url) return;

    safeCreateBrowserTab({ url: payload.url, active: false });
  });
}

registerIpcHandlers();

configureAppStorageForTests();

app.whenReady().then(function () {
  app.setName('Jable Desktop');
  currentLocale = i18n.normalizeLocale(app.getLocale());
  installApplicationMenu();

  getDatabase();
  installAdBlocker();
  createWindow();
  scheduleBackgroundUpdateCheck();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', function () {
  closeAllSyncWorkers();
  if (database) database.close();
});
