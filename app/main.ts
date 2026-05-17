'use strict';

import type * as Electron from 'electron';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type {
  BrowserLoadFailure,
  BrowserTab,
  BrowserTabManager,
  BrowserTabManagerContext
} from './browser-tab-manager';
import type { DownloadManager, DownloadManagerContext } from './download-manager';
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
  CollectionAction,
  CollectionKey,
  CreateBrowserTabPayload,
  DownloadRecord,
  DownloadRecordPatch,
  ExportJsonFileResult,
  ExportResource,
  FinishSyncPayload,
  LibraryVideoMenuPayload,
  ListVideosOptions,
  PendingRemoteOperationActionResult,
  PendingRemoteOperationGroup,
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
  listDownloadAssets(): DownloadRecord[];
  getDownloadAsset(videoUrl: string): DownloadRecord | null;
  upsertDownloadAsset(patch: DownloadRecordPatch): DownloadRecord;
  removeDownloadAsset(videoUrl: string): boolean;
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
type BrowserTabPolicyModule = {
  browserTabShortcutOffset(input: BrowserTabShortcutInput | null | undefined, isMacos: boolean): number;
  browserTabWebPreferences(kind: BrowserTabKind, preloadPath: string, partition: string): Electron.WebPreferences;
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
  canonicalJableVideoUrl(value: unknown): string | null;
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
const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');
const adBlocker = require('./ad-blocker') as AdBlockerModule;
const browserTabManagerModule = require('./browser-tab-manager') as {
  createBrowserTabManager(context: BrowserTabManagerContext): BrowserTabManager;
};
const browserTabPolicy = require('./browser-tab-policy') as BrowserTabPolicyModule;
const dataEngineModule = require('./data-engine') as DataEngineModule;
const downloadManagerModule = require('./download-manager') as {
  createDownloadManager(context: DownloadManagerContext): DownloadManager;
};
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

const DEFAULT_JABLE_HOME_URL = urlPolicy.JABLE_PRIMARY_ORIGIN + '/';
const JABLE_HOME_URL = configuredHomeUrl();
const JABLE_SESSION_PARTITION = 'persist:jable-session';
const BACKGROUND_UPDATE_CHECK_DELAY_MS = 5000;
const BROWSER_SYNC_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;
const BROWSER_DIAGNOSE_REQUEST_TIMEOUT_MS = 5000;
const IS_MACOS = process.platform === 'darwin';
const NEW_TAB_ACCELERATOR = IS_MACOS ? 'Command+T' : 'Ctrl+T';
const CLOSE_TAB_ACCELERATOR = IS_MACOS ? 'Command+W' : 'Ctrl+W';

let mainWindow: Electron.BrowserWindow | null = null;
const syncWorkersById: Record<string, SyncWorker> = {};
const activeSyncRunsByCollection: Partial<Record<CollectionKey, ActiveSyncRun>> = {};
const browserPreloadRequests: Record<string, BrowserPreloadRequest> = {};
let nextSyncWorkerId = 1;
let nextBrowserPreloadRequestId = 1;
let activeJableOrigin = urlPolicy.JABLE_PRIMARY_ORIGIN;
let browserTabManager: BrowserTabManager | null = null;
let database: DataEngineInstance | null = null;
let databasePath: string | null = null;
let downloadManager: DownloadManager | null = null;
let settingsStore: InstanceType<SettingsModule['AppSettingsStore']> | null = null;
let allowDownloadAppQuit = false;
let allowDownloadWindowClose = false;
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

function getDownloadManager(): DownloadManager {
  if (!downloadManager) {
    downloadManager = downloadManagerModule.createDownloadManager({
      app: app,
      dialog: dialog,
      getAppSettings: getAppSettings,
      getDatabase: getDatabase,
      getMainWindow: function () {
        return mainWindow;
      },
      forwardBrowserMessage: forwardBrowserMessage,
      session: session,
      shell: shell,
      showAppDialog: showAppDialog,
      t: t,
      updateAppSettings: updateAppSettings
    });
  }

  return downloadManager;
}

function updateAppSettings(patch: unknown): AppSettings {
  const settings = getSettingsStore().update(settingsModule.normalizeAppSettingsPatch(patch));
  notifyBrowserTabsChanged();
  forwardBrowserMessage('settings-changed', settings);
  if (downloadManager) downloadManager.processQueue();
  return settings;
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

function hasQueuedOrActiveDownloads(): boolean {
  return getDownloadManager().hasQueuedOrActiveDownloads();
}

function pauseDownloadsForShutdown() {
  getDownloadManager().pauseDownloadsForShutdown();
}

function confirmPauseDownloadsBeforeClose(): Promise<boolean> {
  return getDownloadManager().confirmPauseDownloadsBeforeClose();
}

function promptPauseDownloadsAndClose(browserWindow: Electron.BrowserWindow) {
  confirmPauseDownloadsBeforeClose()
    .then(function (confirmed) {
      if (!confirmed) return;
      pauseDownloadsForShutdown();
      if (process.platform !== 'darwin') allowDownloadAppQuit = true;
      allowDownloadWindowClose = true;
      if (!browserWindow.isDestroyed()) browserWindow.close();
    })
    .catch(function (error) {
      console.error(error);
    });
}

function promptPauseDownloadsAndQuit() {
  confirmPauseDownloadsBeforeClose()
    .then(function (confirmed) {
      if (!confirmed) return;
      pauseDownloadsForShutdown();
      allowDownloadAppQuit = true;
      app.quit();
    })
    .catch(function (error) {
      console.error(error);
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
  mainWindow.on('close', function (event: Electron.Event) {
    if (allowDownloadWindowClose) {
      allowDownloadWindowClose = false;
      return;
    }
    if (!hasQueuedOrActiveDownloads()) return;

    event.preventDefault();
    promptPauseDownloadsAndClose(mainWindow as Electron.BrowserWindow);
  });
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
      closeBrowserTab(null);
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
      getBrowserTabManager().activateRelativeTab(offset);
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

function getBrowserTabManager(): BrowserTabManager {
  if (!browserTabManager) {
    browserTabManager = browserTabManagerModule.createBrowserTabManager({
      activateFallbackOrigin: activateJableFallbackOrigin,
      fallbackUrlForLoadFailure: fallbackUrlForLoadFailure,
      forwardBrowserMessage: forwardBrowserMessage,
      getMainWindow: function () {
        return mainWindow;
      },
      getMaxBrowserTabs: function () {
        return getAppSettings().maxBrowserTabs;
      },
      homeUrl: JABLE_HOME_URL,
      normalizeNavigationUrl: normalizeBrowserNavigationUrl,
      registerShortcuts: registerAppShortcuts,
      rejectPreloadRequestsForWebContents: rejectBrowserPreloadRequestsForWebContents,
      sessionPartition: JABLE_SESSION_PARTITION,
      shouldActivateWindowOpen: shouldActivateWindowOpen,
      shouldDenyAdNavigation: shouldDenyAdNavigation,
      showBrowserContextMenu: showBrowserContextMenu,
      t: t,
      WebContentsView: WebContentsView,
      webviewPreloadPath: path.join(__dirname, 'webview-preload.js')
    });
  }

  return browserTabManager;
}

function createBrowserTab(options?: CreateBrowserTabPayload | null): BrowserTabsState {
  return getBrowserTabManager().createTab(options);
}

function getBrowserTab(tabId?: string | null): BrowserTab {
  return getBrowserTabManager().getTab(tabId);
}

function getBrowserTabByWebContents(webContents: Electron.WebContents | null | undefined): BrowserTab | null {
  return getBrowserTabManager().getTabByWebContents(webContents);
}

function browserTabsState(): BrowserTabsState {
  return getBrowserTabManager().listTabs();
}

function notifyBrowserTabsChanged() {
  getBrowserTabManager().notifyChanged();
}

function browserNavigationState(tabId?: string | null): BrowserNavigationState {
  return getBrowserTabManager().navigationState(tabId);
}

function scheduleBrowserHtmlFullScreenResize() {
  getBrowserTabManager().scheduleHtmlFullScreenResize();
}

function setBrowserBounds(bounds: BrowserBounds | null | undefined): BrowserBounds | null {
  return getBrowserTabManager().setBounds(bounds);
}

function activateBrowserTab(tabId: string | null): BrowserTabsState {
  return getBrowserTabManager().activateTab(tabId);
}

function closeBrowserTab(tabId: string | null): BrowserTabsState {
  return getBrowserTabManager().closeTab(tabId);
}

function setBrowserTabLocked(payload?: BrowserTabLockedPayload | null): BrowserTabsState {
  return getBrowserTabManager().setTabLocked(payload);
}

function setBrowserTabMuted(payload?: BrowserTabMutedPayload | null): BrowserTabsState {
  return getBrowserTabManager().setTabMuted(payload);
}

function navigateBrowser(payload?: BrowserNavigatePayload | null): Promise<string> {
  return getBrowserTabManager().navigate(payload);
}

function reloadBrowser(tabId?: string | null): Promise<BrowserNavigationState> {
  return getBrowserTabManager().reload(tabId);
}

function goBrowserBack(tabId?: string | null): Promise<BrowserNavigationState> {
  return getBrowserTabManager().goBack(tabId);
}

function goBrowserForward(tabId?: string | null): Promise<BrowserNavigationState> {
  return getBrowserTabManager().goForward(tabId);
}

function safeCreateBrowserTab(options?: CreateBrowserTabPayload | null): BrowserTabsState {
  return getBrowserTabManager().safeCreateTab(options);
}

function syncBrowserTabMediaState(tab: BrowserTab | null | undefined) {
  getBrowserTabManager().syncTabMediaState(tab);
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
  getBrowserTabManager().sendToAllTabs('browser:sync-lock-state', state);
}

function notifyPendingCollectionOperationsChanged() {
  const state = pendingCollectionOperationsState();
  getBrowserTabManager().sendToAllTabs('browser:pending-collection-operations', state);
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
    enabled: getBrowserTabManager().canCreateTab(),
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
      enabled: getBrowserTabManager().canCreateTab(),
      click: function () {
        safeCreateBrowserTab({ url: JABLE_HOME_URL, active: true });
      }
    },
    {
      label: t('context.switchToTab'),
      enabled: getBrowserTabManager().activeTabId() !== tab.id,
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
    activeTab = getBrowserTab();
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
      enabled: getBrowserTabManager().canCreateTab(),
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
    return getDownloadManager().getFfmpegStatus();
  });

  ipcMain.handle('app:refresh-ffmpeg-status', function () {
    return getDownloadManager().getFfmpegStatus();
  });

  ipcMain.handle('app:choose-ffmpeg-path', function () {
    return getDownloadManager().chooseFfmpegPath();
  });

  ipcMain.handle('app:set-ffmpeg-path', function (_event, filePath) {
    return getDownloadManager().setFfmpegPath(filePath);
  });

  ipcMain.handle('app:clear-ffmpeg-path', function () {
    return getDownloadManager().clearFfmpegPath();
  });

  ipcMain.handle('app:get-download-root', function () {
    return getDownloadManager().getDownloadRoot();
  });

  ipcMain.handle('app:choose-download-root', function () {
    return getDownloadManager().chooseDownloadRoot();
  });

  ipcMain.handle('app:set-download-root', function (_event, filePath) {
    return getDownloadManager().setDownloadRoot(filePath);
  });

  ipcMain.handle('app:clear-download-root', function () {
    return getDownloadManager().clearDownloadRoot();
  });

  ipcMain.handle('app:open-download-root', function () {
    return getDownloadManager().openDownloadRoot();
  });

  ipcMain.handle('download:list', function () {
    return getDownloadManager().listDownloads();
  });

  ipcMain.handle('download:enqueue', function (_event, payload) {
    return getDownloadManager().enqueueDownload(payload);
  });

  ipcMain.handle('download:retry', function (_event, videoUrl) {
    return getDownloadManager().retryDownload(videoUrl);
  });

  ipcMain.handle('download:pause', function (_event, videoUrl) {
    return getDownloadManager().pauseDownload(videoUrl);
  });

  ipcMain.handle('download:resume', function (_event, videoUrl) {
    return getDownloadManager().resumeDownload(videoUrl);
  });

  ipcMain.handle('download:cancel', function (_event, videoUrl) {
    return getDownloadManager().cancelDownload(videoUrl);
  });

  ipcMain.handle('download:open-file', function (_event, videoUrl) {
    return getDownloadManager().openDownloadFile(videoUrl);
  });

  ipcMain.handle('download:reveal-file', function (_event, videoUrl) {
    return getDownloadManager().revealDownloadFile(videoUrl);
  });

  ipcMain.handle('download:delete', function (_event, videoUrl) {
    return getDownloadManager().deleteDownload(videoUrl);
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

app.on('before-quit', function (event: Electron.Event) {
  if (!allowDownloadAppQuit && hasQueuedOrActiveDownloads()) {
    event.preventDefault();
    promptPauseDownloadsAndQuit();
    return;
  }

  closeAllSyncWorkers();
  pauseDownloadsForShutdown();
  if (database) database.close();
});
