'use strict';

import type * as Electron from 'electron';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type {
  AppMenuManager,
  AppMenuManagerContext,
  UpdateCheckerModule,
  UpdateCheckOptions,
  UpdateCheckResult
} from './main-process/app-menu-manager';
import type {
  BrowserLoadFailure,
  BrowserReloadOptions,
  BrowserTab,
  BrowserTabManager,
  BrowserTabManagerContext
} from './main-process/browser-tab-manager';
import type { BrowserSessionSnapshot } from './main-process/browser-session-store';
import type { BrowserShortcutManager, BrowserShortcutManagerContext } from './main-process/browser-shortcut-manager';
import type { ContextMenuManager, ContextMenuManagerContext } from './main-process/context-menu-manager';
import type { DataEngine } from './data/data-engine';
import type { DownloadManager, DownloadManagerContext } from './main-process/download-manager';
import type { IpcHandlersContext } from './main-process/ipc-handlers';
import type {
  ActiveSyncRun,
  PendingCollectionOperationOverlayState,
  SyncWorkerManager,
  SyncWorkerManagerContext
} from './main-process/sync-worker-manager';
import type {
  AppSettings,
  AppSettingsPatch,
  AppPlatform,
  BrowserBounds,
  BrowserNavigatePayload,
  BrowserNavigationState,
  BrowserTabKind,
  BrowserTabLockedPayload,
  BrowserTabMenuPayload,
  BrowserTabMutedPayload,
  BrowserTabsState,
  CollectionKey,
  CreateBrowserTabPayload,
  ExportJsonFileResult,
  LibraryVideoMenuPayload,
  PendingRemoteOperationActionResult,
  SupportedLocale,
  SyncBrowserCollectionOptions,
  SyncResult
} from './types/jable';
import {
  optionalBooleanField,
  optionalStringField,
  requiredRecord,
  requiredStringValue
} from './main-process/ipc-normalizers';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type DatabaseCollection = { key: CollectionKey; name: string; sourcePath: string };
type SettingsModule = {
  AppSettingsStore: new (filePath: string) => {
    get(): AppSettings;
    update(patch: AppSettingsPatch): AppSettings;
  };
  normalizeAppSettingsPatch(value: unknown): AppSettingsPatch;
  settingsFilePath(userDataPath: string): string;
};
type BrowserSessionStoreModule = {
  BrowserSessionStore: new (filePath: string) => {
    readForRestore(options: { maxTabs: number; normalizeUrl(value: unknown): string }): BrowserSessionSnapshot | null;
    write(snapshot: BrowserSessionSnapshot): void;
    clear(): void;
  };
  browserSessionFilePath(userDataPath: string): string;
};
type DataEngineModule = {
  COLLECTIONS: DatabaseCollection[];
  createDataEngine(filePath: string): DataEngine;
};
type BrowserTabPolicyModule = {
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
type BrowserTheaterModeResult = {
  enabled: boolean;
  applied: boolean;
  videoUrl: string | null;
};
type I18nModule = {
  DEFAULT_LOCALE: SupportedLocale;
  normalizeLocale(value: unknown): SupportedLocale;
  t(locale: SupportedLocale, key: string, params?: TranslationParams | null): string;
};

function currentAppPlatform(): AppPlatform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}
type WebViewEnhancementModule = {
  installJableWebViewEnhancement(
    session: Electron.Session,
    options?: {
      enabled?: boolean | (() => boolean);
      debug?: boolean;
      logger?: { info(message?: unknown, ...optionalParams: unknown[]): void };
    } | null
  ): { installed: boolean; patterns: string[] };
  isWebViewEnhancementDebugEnabledByEnv(env?: Record<string, string | undefined> | null): boolean;
  shouldSuppressWebViewNavigation(value: unknown): boolean;
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
type HlsPlaybackCaptureModule = {
  installHlsPlaybackCapture(context: {
    canonicalJableVideoUrl(value: unknown): string | null;
    env?: Record<string, string | undefined> | null;
    getBrowserTabByWebContents(webContents: Electron.WebContents): { id: string } | null;
    jableFallbackOrigin: string;
    jablePrimaryOrigin: string;
    jableSession: Electron.Session;
    ipcMain: typeof Electron.ipcMain;
    logger?: { info(message?: unknown, ...optionalParams: unknown[]): void } | null;
    isAutoDownloadOnPlaybackEnabled?(): boolean;
    completeHlsPlaybackCapture?(value: { videoUrl: string; pageLoadId?: string | null }): void;
    queueHlsPlaybackBackgroundCompletion?(value: {
      videoUrl: string;
      pageLoadId?: string | null;
      run: (signal: AbortSignal) => Promise<void>;
    }): void;
    shouldContinueHlsPlaybackCapture?(value: { videoUrl: string; pageLoadId?: string | null }): boolean;
    shouldProxyHlsPlaybackCapture?(value: { videoUrl: string; pageLoadId?: string | null }): boolean;
    prepareHlsPlaybackCapture?(value: {
      videoUrl: string;
      pageLoadId?: string | null;
      title: string | null;
      views: number | null;
      likes: number | null;
      img: string | null;
      preview: string | null;
      sourcePageChineseSubtitleNotice?: boolean | null;
      sourcePageSubtitleNoticeText?: string | null;
      playlistUrl: string;
      playlistText: string;
    }): {
      videoUrl: string;
      playlistUrl: string;
      segmentCount: number;
      segments: Array<{ url: string; filePath: string }>;
    } | null;
    recordHlsPlaybackCaptureSegment?(value: { videoUrl: string; pageLoadId?: string | null; filePath: string }): void;
    webContentsFromId(webContentsId: number): Electron.WebContents | null;
  }): Promise<void>;
};
const electron: typeof Electron = require('electron');
const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');
const webViewEnhancement = require('./browser/webview-enhancement') as WebViewEnhancementModule;
const appMenuManagerModule = require('./main-process/app-menu-manager') as {
  createAppMenuManager(context: AppMenuManagerContext): AppMenuManager;
};
const browserSessionStoreModule = require('./main-process/browser-session-store') as BrowserSessionStoreModule;
const browserTabManagerModule = require('./main-process/browser-tab-manager') as {
  createBrowserTabManager(context: BrowserTabManagerContext): BrowserTabManager;
};
const browserShortcutManagerModule = require('./main-process/browser-shortcut-manager') as {
  createBrowserShortcutManager(context: BrowserShortcutManagerContext): BrowserShortcutManager;
};
const browserTabPolicy = require('./browser/browser-tab-policy') as BrowserTabPolicyModule;
const contextMenuManagerModule = require('./main-process/context-menu-manager') as {
  createContextMenuManager(context: ContextMenuManagerContext): ContextMenuManager;
};
const dataEngineModule = require('./data/data-engine') as DataEngineModule;
const downloadManagerModule = require('./main-process/download-manager') as {
  LOCAL_PLAYBACK_SCHEME: string;
  createDownloadManager(context: DownloadManagerContext): DownloadManager;
};
const i18n = require('./i18n') as I18nModule;
const hlsPlaybackCapture = require('./main-process/hls-playback-capture') as HlsPlaybackCaptureModule;
const ipcHandlers = require('./main-process/ipc-handlers') as {
  registerIpcHandlers(context: IpcHandlersContext): void;
};
const settingsModule = require('./main-process/settings') as SettingsModule;
const syncWorkerManagerModule = require('./main-process/sync-worker-manager') as {
  createSyncWorkerManager(context: SyncWorkerManagerContext): SyncWorkerManager;
};
const updateChecker = require('./main-process/update-checker') as UpdateCheckerModule;
const urlPolicy = require('./browser/url-policy') as UrlPolicyModule;
const COLLECTIONS = dataEngineModule.COLLECTIONS;

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const WebContentsView = electron.WebContentsView;
const ipcMain = electron.ipcMain;
const Menu = electron.Menu;
const dialog = electron.dialog;
const protocol = electron.protocol;
const session = electron.session;
const shell = electron.shell;
const browserTabWebPreferences = browserTabPolicy.browserTabWebPreferences;
const LOCAL_PLAYBACK_SCHEME = downloadManagerModule.LOCAL_PLAYBACK_SCHEME;

const DEFAULT_JABLE_HOME_URL = urlPolicy.JABLE_PRIMARY_ORIGIN + '/';
const JABLE_HOME_URL = configuredHomeUrl();
const JABLE_SESSION_PARTITION = 'persist:jable-session';
const BACKGROUND_UPDATE_CHECK_DELAY_MS = 5000;
const BROWSER_DIAGNOSE_REQUEST_TIMEOUT_MS = 5000;
const BROWSER_THEATER_MODE_REQUEST_TIMEOUT_MS = 5000;
const BROWSER_SESSION_SAVE_DELAY_MS = 400;
const IS_MACOS = process.platform === 'darwin';
const NEW_TAB_ACCELERATOR = IS_MACOS ? 'Command+T' : 'Ctrl+T';
const CLOSE_TAB_ACCELERATOR = IS_MACOS ? 'Command+W' : 'Ctrl+W';
const FFMPEG_GUIDE_URLS: Record<SupportedLocale, string> = {
  'zh-TW':
    'https://github.com/shane-zeng/jable-favourites-exporter/blob/main/docs/README.zh-TW.md#%E4%B8%8B%E8%BC%89%E6%B8%85%E5%96%AE%E8%88%87-ffmpeg',
  'en-US':
    'https://github.com/shane-zeng/jable-favourites-exporter/blob/main/docs/README.en-US.md#download-list-and-ffmpeg',
  'ja-JP':
    'https://github.com/shane-zeng/jable-favourites-exporter/blob/main/docs/README.ja-JP.md#%E3%83%80%E3%82%A6%E3%83%B3%E3%83%AD%E3%83%BC%E3%83%89%E4%B8%80%E8%A6%A7%E3%81%A8-ffmpeg'
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_PLAYBACK_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

let mainWindow: Electron.BrowserWindow | null = null;
const browserPreloadRequests: Record<string, BrowserPreloadRequest> = {};
let nextBrowserPreloadRequestId = 1;
let activeJableOrigin = urlPolicy.JABLE_PRIMARY_ORIGIN;
let appMenuManager: AppMenuManager | null = null;
let browserSessionStore: InstanceType<BrowserSessionStoreModule['BrowserSessionStore']> | null = null;
let browserTabManager: BrowserTabManager | null = null;
let browserShortcutManager: BrowserShortcutManager | null = null;
let contextMenuManager: ContextMenuManager | null = null;
let database: DataEngine | null = null;
let databasePath: string | null = null;
let downloadManager: DownloadManager | null = null;
let syncWorkerManager: SyncWorkerManager | null = null;
let settingsStore: InstanceType<SettingsModule['AppSettingsStore']> | null = null;
let allowDownloadAppQuit = false;
let allowDownloadWindowClose = false;
let downloadShutdownInProgress: Promise<void> | null = null;
let quitAfterDownloadShutdownInFlight = false;
let currentLocale: SupportedLocale = i18n.DEFAULT_LOCALE;
let browserSessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
let browserSessionRestoreInProgress = false;

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

function shouldDenyWebViewEnhancementNavigation(url: unknown): boolean {
  if (!getAppSettings().webViewEnhancementMode) return false;

  const suppressed = webViewEnhancement.shouldSuppressWebViewNavigation(url);

  if (suppressed && webViewEnhancement.isWebViewEnhancementDebugEnabledByEnv(process.env)) {
    console.info('[webview-enhancement] suppressed navigation', url);
  }

  return suppressed;
}

function installWebViewEnhancement() {
  const result = webViewEnhancement.installJableWebViewEnhancement(session.fromPartition(JABLE_SESSION_PARTITION), {
    enabled: function () {
      return getAppSettings().webViewEnhancementMode;
    },
    debug: webViewEnhancement.isWebViewEnhancementDebugEnabledByEnv(process.env)
  });

  if (result.installed && webViewEnhancement.isWebViewEnhancementDebugEnabledByEnv(process.env)) {
    console.info('[webview-enhancement] installed with ' + result.patterns.length + ' URL patterns');
  }
}

function installLocalPlaybackProtocol() {
  const localPlaybackProtocol = session.fromPartition(JABLE_SESSION_PARTITION).protocol;
  if (localPlaybackProtocol.isProtocolHandled(LOCAL_PLAYBACK_SCHEME)) return;

  localPlaybackProtocol.handle(LOCAL_PLAYBACK_SCHEME, function (request: Request) {
    return getDownloadManager().handleLocalPlaybackRequest(request);
  });
}

function installHlsPlaybackCapture(): Promise<void> {
  return hlsPlaybackCapture.installHlsPlaybackCapture({
    canonicalJableVideoUrl: urlPolicy.canonicalJableVideoUrl,
    env: process.env,
    getBrowserTabByWebContents: getBrowserTabByWebContents,
    jableFallbackOrigin: urlPolicy.JABLE_FALLBACK_ORIGIN,
    jablePrimaryOrigin: urlPolicy.JABLE_PRIMARY_ORIGIN,
    jableSession: session.fromPartition(JABLE_SESSION_PARTITION),
    ipcMain: ipcMain,
    logger: console,
    isAutoDownloadOnPlaybackEnabled: function () {
      return getAppSettings().autoDownloadOnPlayback;
    },
    prepareHlsPlaybackCapture: function (value) {
      return getDownloadManager().prepareHlsPlaybackCapture(value);
    },
    completeHlsPlaybackCapture: function (value) {
      getDownloadManager().completeHlsPlaybackCapture(value);
    },
    queueHlsPlaybackBackgroundCompletion: function (value) {
      getDownloadManager().queueHlsPlaybackBackgroundCompletion(value);
    },
    shouldContinueHlsPlaybackCapture: function (value) {
      return getDownloadManager().shouldContinueHlsPlaybackCapture(value);
    },
    shouldProxyHlsPlaybackCapture: function (value) {
      return getDownloadManager().shouldProxyHlsPlaybackCapture(value);
    },
    recordHlsPlaybackCaptureSegment: function (value) {
      getDownloadManager().recordHlsPlaybackCaptureSegment(value);
    },
    webContentsFromId: function (webContentsId) {
      return electron.webContents.fromId(webContentsId) || null;
    }
  });
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

function getBrowserSessionStore() {
  if (!browserSessionStore) {
    browserSessionStore = new browserSessionStoreModule.BrowserSessionStore(
      browserSessionStoreModule.browserSessionFilePath(app.getPath('userData'))
    );
  }

  return browserSessionStore;
}

function getAppSettings(): AppSettings {
  return getSettingsStore().get();
}

function clearBrowserSessionSaveTimer() {
  if (!browserSessionSaveTimer) return;
  clearTimeout(browserSessionSaveTimer);
  browserSessionSaveTimer = null;
}

function saveBrowserSessionNow() {
  clearBrowserSessionSaveTimer();

  if (!browserTabManager || browserSessionRestoreInProgress || !getAppSettings().restoreBrowserTabsOnStartup) return;

  const snapshot = browserTabManager.sessionSnapshot();
  if (!snapshot.tabs.length) {
    getBrowserSessionStore().clear();
    return;
  }

  getBrowserSessionStore().write(snapshot);
}

function scheduleBrowserSessionSave() {
  if (!browserTabManager || browserSessionRestoreInProgress || !getAppSettings().restoreBrowserTabsOnStartup) return;

  clearBrowserSessionSaveTimer();
  browserSessionSaveTimer = setTimeout(function () {
    try {
      saveBrowserSessionNow();
    } catch (error) {
      console.error(error);
    }
  }, BROWSER_SESSION_SAVE_DELAY_MS);
}

function flushBrowserSession() {
  clearBrowserSessionSaveTimer();

  try {
    if (!getAppSettings().restoreBrowserTabsOnStartup) {
      getBrowserSessionStore().clear();
      return;
    }

    if (browserTabManager && browserTabManager.tabCount() > 0) saveBrowserSessionNow();
  } catch (error) {
    console.error(error);
  }
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
      sendToAllBrowserTabs: function (channel, payload) {
        if (browserTabManager) browserTabManager.sendToAllTabs(channel, payload);
      },
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
  const previousSettings = getAppSettings();
  const settings = getSettingsStore().update(settingsModule.normalizeAppSettingsPatch(patch));
  notifyBrowserTabsChanged();
  forwardBrowserMessage('settings-changed', settings);
  if (browserTabManager) browserTabManager.sendToAllTabs('settings-changed', settings);
  if (previousSettings.restoreBrowserTabsOnStartup !== settings.restoreBrowserTabsOnStartup) {
    if (settings.restoreBrowserTabsOnStartup) saveBrowserSessionNow();
    else {
      clearBrowserSessionSaveTimer();
      getBrowserSessionStore().clear();
    }
  }
  if (downloadManager && previousSettings.autoDownloadOnPlayback && !settings.autoDownloadOnPlayback) {
    downloadManager.pausePlaybackAutoDownloadsForSettingDisable();
  }
  if (downloadManager) downloadManager.processQueue();
  return settings;
}

function getDatabase(): DataEngine {
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

function openFfmpegGuide(): Promise<{ opened: boolean; url: string }> {
  const url = FFMPEG_GUIDE_URLS[currentLocale] || FFMPEG_GUIDE_URLS['en-US'];

  return shell.openExternal(url).then(function () {
    return {
      opened: true,
      url: url
    };
  });
}

function hasQueuedOrActiveDownloads(): boolean {
  return getDownloadManager().hasQueuedOrActiveDownloads();
}

function pauseDownloadsForShutdown(): Promise<void> {
  if (!downloadShutdownInProgress) {
    downloadShutdownInProgress = Promise.resolve()
      .then(function () {
        return getDownloadManager().pauseDownloadsForShutdown();
      })
      .finally(function () {
        downloadShutdownInProgress = null;
      });
  }

  return downloadShutdownInProgress;
}

function confirmPauseDownloadsBeforeClose(): Promise<boolean> {
  return getDownloadManager().confirmPauseDownloadsBeforeClose();
}

function promptPauseDownloadsAndClose(browserWindow: Electron.BrowserWindow) {
  confirmPauseDownloadsBeforeClose()
    .then(function (confirmed) {
      if (!confirmed) return;
      if (process.platform !== 'darwin') allowDownloadAppQuit = true;
      allowDownloadWindowClose = true;
      return pauseDownloadsForShutdown().then(function () {
        if (!browserWindow.isDestroyed()) browserWindow.close();
      });
    })
    .catch(function (error) {
      console.error(error);
    });
}

function quitAfterDownloadsPaused() {
  if (quitAfterDownloadShutdownInFlight) return;
  quitAfterDownloadShutdownInFlight = true;
  allowDownloadAppQuit = true;
  allowDownloadWindowClose = true;

  pauseDownloadsForShutdown()
    .then(function () {
      app.quit();
    })
    .catch(function (error) {
      console.error(error);
    })
    .finally(function () {
      quitAfterDownloadShutdownInFlight = false;
    });
}

function promptPauseDownloadsAndQuit() {
  confirmPauseDownloadsBeforeClose()
    .then(function (confirmed) {
      if (!confirmed) return;
      quitAfterDownloadsPaused();
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
      if (shouldDenyWebViewEnhancementNavigation(details.url)) return { action: 'deny' };

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
      flushBrowserSession();
      return;
    }
    if (!hasQueuedOrActiveDownloads()) {
      flushBrowserSession();
      return;
    }

    event.preventDefault();
    promptPauseDownloadsAndClose(mainWindow as Electron.BrowserWindow);
  });
  mainWindow.on('closed', function () {
    if (browserTabManager) browserTabManager.closeAllTabs();
    mainWindow = null;
    closeAllSyncWorkers();
  });

  loadRenderer();
  createInitialBrowserTabs();
}

function createInitialBrowserTabs() {
  const settings = getAppSettings();

  if (!settings.restoreBrowserTabsOnStartup) {
    createBrowserTab({ url: JABLE_HOME_URL, active: true });
    return;
  }

  const snapshot = getBrowserSessionStore().readForRestore({
    maxTabs: settings.maxBrowserTabs,
    normalizeUrl: normalizeBrowserNavigationUrl
  });

  if (!snapshot) {
    createBrowserTab({ url: JABLE_HOME_URL, active: true });
    return;
  }

  browserSessionRestoreInProgress = true;

  try {
    for (let i = 0; i < snapshot.tabs.length; i++) {
      createBrowserTab({
        url: snapshot.tabs[i].url,
        active: true,
        locked: snapshot.tabs[i].locked,
        muted: snapshot.tabs[i].muted
      });
    }

    const state = browserTabsState();
    const activeTab = state.tabs[snapshot.activeTabIndex] || state.tabs[0];
    if (activeTab) activateBrowserTab(activeTab.id);
  } catch (error) {
    console.error(error);
    if (getBrowserTabManager().tabCount() === 0) createBrowserTab({ url: JABLE_HOME_URL, active: true });
  } finally {
    browserSessionRestoreInProgress = false;
    scheduleBrowserSessionSave();
  }
}

function shouldActivateWindowOpen(details: Electron.HandlerDetails | null | undefined) {
  return !details || details.disposition !== 'background-tab';
}

function getBrowserShortcutManager(): BrowserShortcutManager {
  if (!browserShortcutManager) {
    browserShortcutManager = browserShortcutManagerModule.createBrowserShortcutManager({
      activateRelativeBrowserTab: function (offset) {
        return getBrowserTabManager().activateRelativeTab(offset);
      },
      closeBrowserTab: closeBrowserTab,
      createBrowserTab: createBrowserTab,
      createWindow: createWindow,
      forwardBrowserMessage: forwardBrowserMessage,
      getMainWindow: function () {
        return mainWindow;
      },
      homeUrl: JABLE_HOME_URL,
      isMacos: IS_MACOS,
      reloadBrowser: reloadBrowser
    });
  }

  return browserShortcutManager;
}

function openHomeTabFromShortcut() {
  getBrowserShortcutManager().openHomeTabFromShortcut();
}

function closeActiveTabFromShortcut() {
  getBrowserShortcutManager().closeActiveTabFromShortcut();
}

function registerAppShortcuts(webContents: Electron.WebContents) {
  getBrowserShortcutManager().registerAppShortcuts(webContents);
}

function loadRenderer() {
  if (!mainWindow) throw new Error('Main window is not available');

  if (process.env.JABLE_RENDERER_DEV_URL) {
    mainWindow.loadURL(process.env.JABLE_RENDERER_DEV_URL);
    return;
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer-dist', 'index.html'));
}

function getAppMenuManager(): AppMenuManager {
  if (!appMenuManager) {
    appMenuManager = appMenuManagerModule.createAppMenuManager({
      app: app,
      backgroundUpdateCheckDelayMs: BACKGROUND_UPDATE_CHECK_DELAY_MS,
      closeActiveTabFromShortcut: closeActiveTabFromShortcut,
      closeTabAccelerator: CLOSE_TAB_ACCELERATOR,
      dialog: dialog,
      getMainWindow: function () {
        return mainWindow;
      },
      isAllowedExternalReleaseUrl: urlPolicy.isAllowedExternalReleaseUrl,
      isMacos: IS_MACOS,
      mainErrorMessage: mainErrorMessage,
      Menu: Menu,
      newTabAccelerator: NEW_TAB_ACCELERATOR,
      openHomeTabFromShortcut: openHomeTabFromShortcut,
      shell: shell,
      t: t,
      updateChecker: updateChecker
    });
  }

  return appMenuManager;
}

function installApplicationMenu() {
  getAppMenuManager().installApplicationMenu();
}

function showAppDialog(options: Electron.MessageBoxOptions) {
  return getAppMenuManager().showAppDialog(options);
}

function checkForUpdates(options?: UpdateCheckOptions | null): Promise<UpdateCheckResult> {
  return getAppMenuManager().checkForUpdates(options);
}

function scheduleBackgroundUpdateCheck() {
  getAppMenuManager().scheduleBackgroundUpdateCheck();
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
      onBrowserTabsChanged: scheduleBrowserSessionSave,
      registerShortcuts: registerAppShortcuts,
      rejectPreloadRequestsForWebContents: rejectBrowserPreloadRequestsForWebContents,
      sessionPartition: JABLE_SESSION_PARTITION,
      shouldActivateWindowOpen: shouldActivateWindowOpen,
      shouldDenyWebViewEnhancementNavigation: shouldDenyWebViewEnhancementNavigation,
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

function reloadBrowser(tabId?: string | null, options?: BrowserReloadOptions | null): Promise<BrowserNavigationState> {
  return getBrowserTabManager().reload(tabId, options);
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

function normalizeBrowserTheaterModeResult(value: unknown, fallbackEnabled: boolean): BrowserTheaterModeResult {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : fallbackEnabled,
    applied: Boolean(record.applied),
    videoUrl: typeof record.videoUrl === 'string' && record.videoUrl ? record.videoUrl : null
  };
}

async function setBrowserTabTheaterMode(tab: BrowserTab, enabled: boolean): Promise<BrowserTheaterModeResult> {
  const result = normalizeBrowserTheaterModeResult(
    await requestBrowserPreload<BrowserTheaterModeResult>(
      tab,
      'browser:set-theater-mode-request',
      { enabled: enabled },
      BROWSER_THEATER_MODE_REQUEST_TIMEOUT_MS
    ),
    enabled
  );

  tab.theaterMode = result.enabled;
  return result;
}

function syncBrowserTheaterModeFromEvent(event: Electron.IpcMainEvent, payload: unknown) {
  const tab = getBrowserTabByWebContents(event.sender);
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

  if (!tab || typeof record.enabled !== 'boolean') return;
  tab.theaterMode = record.enabled;
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

function getSyncWorkerManager(): SyncWorkerManager {
  if (!syncWorkerManager) {
    syncWorkerManager = syncWorkerManagerModule.createSyncWorkerManager({
      activateFallbackOrigin: activateJableFallbackOrigin,
      browserTabWebPreferences: browserTabWebPreferences,
      BrowserWindow: BrowserWindow,
      fallbackUrlForLoadFailure: fallbackUrlForLoadFailure,
      forwardBrowserMessage: forwardBrowserMessage,
      getActiveJableOrigin: function () {
        return activeJableOrigin;
      },
      getAutoReplayDeferredSyncOperations: function () {
        return getAppSettings().autoReplayDeferredSyncOperations;
      },
      getDatabase: getDatabase,
      rejectPreloadRequestsForWebContents: rejectBrowserPreloadRequestsForWebContents,
      requestWebContentsPreload: requestWebContentsPreload,
      sendToAllBrowserTabs: function (channel, payload) {
        getBrowserTabManager().sendToAllTabs(channel, payload);
      },
      sessionPartition: JABLE_SESSION_PARTITION,
      shouldDenyWebViewEnhancementNavigation: shouldDenyWebViewEnhancementNavigation,
      t: t,
      webviewPreloadPath: path.join(__dirname, 'webview-preload.js')
    });
  }

  return syncWorkerManager;
}

function closeAllSyncWorkers() {
  getSyncWorkerManager().closeAllWorkers();
}

function syncRunForCollection(collectionKey: CollectionKey): ActiveSyncRun | null {
  return getSyncWorkerManager().activeRunForCollection(collectionKey);
}

function activeSyncRunsState() {
  return getSyncWorkerManager().activeSyncRunsState();
}

function pendingCollectionOperationsState(): PendingCollectionOperationOverlayState {
  return getSyncWorkerManager().pendingCollectionOperationsState();
}

function notifyPendingCollectionOperationsChanged() {
  getSyncWorkerManager().notifyPendingCollectionOperationsChanged();
}

function markActiveSyncMutated(collectionKey: CollectionKey) {
  getSyncWorkerManager().markActiveSyncMutated(collectionKey);
}

function addPendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult> {
  return getSyncWorkerManager().addPendingRemoteOperationGroup(groupId);
}

function removePendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult> {
  return getSyncWorkerManager().removePendingRemoteOperationGroup(groupId);
}

function resolvePendingRemoteOperationGroup(groupId: string): PendingRemoteOperationActionResult {
  return getSyncWorkerManager().resolvePendingRemoteOperationGroup(groupId);
}

function syncBrowserCollectionInWorker(payload: {
  tabId: string | null;
  options: SyncBrowserCollectionOptions;
}): Promise<SyncResult> {
  return getSyncWorkerManager().syncBrowserCollection(payload);
}

function getContextMenuManager(): ContextMenuManager {
  if (!contextMenuManager) {
    contextMenuManager = contextMenuManagerModule.createContextMenuManager({
      activateBrowserTab: activateBrowserTab,
      canCreateBrowserTab: function () {
        return getBrowserTabManager().canCreateTab();
      },
      canonicalJableVideoUrl: urlPolicy.canonicalJableVideoUrl,
      clipboard: electron.clipboard,
      closeBrowserTab: closeBrowserTab,
      forwardBrowserMessage: forwardBrowserMessage,
      getActiveBrowserTabId: function () {
        return getBrowserTabManager().activeTabId();
      },
      getBrowserTab: getBrowserTab,
      getMainWindow: function () {
        return mainWindow;
      },
      goBrowserBack: goBrowserBack,
      goBrowserForward: goBrowserForward,
      homeUrl: JABLE_HOME_URL,
      Menu: Menu,
      reloadBrowser: reloadBrowser,
      safeCreateBrowserTab: safeCreateBrowserTab,
      setBrowserTabTheaterMode: setBrowserTabTheaterMode,
      setBrowserTabMuted: setBrowserTabMuted,
      shell: shell,
      syncBrowserTabMediaState: syncBrowserTabMediaState,
      t: t
    });
  }

  return contextMenuManager;
}

function showBrowserContextMenu(tab: BrowserTab, params: Electron.ContextMenuParams) {
  getContextMenuManager().showBrowserContextMenu(tab, params);
}

function showBrowserTabMenu(payload?: BrowserTabMenuPayload | null): { shown: boolean } {
  return getContextMenuManager().showBrowserTabMenu(payload);
}

function showLibraryVideoMenu(payload?: LibraryVideoMenuPayload | null): { shown: boolean } {
  return getContextMenuManager().showLibraryVideoMenu(payload);
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
  ipcHandlers.registerIpcHandlers({
    activeSyncRunsState: activeSyncRunsState,
    activateBrowserTab: activateBrowserTab,
    addPendingRemoteOperationGroup: addPendingRemoteOperationGroup,
    applyBrowserSyncCollectionSettings: browserSyncCollectionPayloadWithSettings,
    browserDiagnosisTimeoutMs: BROWSER_DIAGNOSE_REQUEST_TIMEOUT_MS,
    browserNavigationState: browserNavigationState,
    browserTabsState: browserTabsState,
    checkForUpdates: checkForUpdates,
    closeBrowserTab: closeBrowserTab,
    createBrowserTab: createBrowserTab,
    currentLocale: function () {
      return currentLocale;
    },
    exportJsonFile: exportJsonFile,
    forwardBrowserMessage: forwardBrowserMessage,
    getAppSettings: getAppSettings,
    getBrowserTab: getBrowserTab,
    getBrowserTabByWebContents: getBrowserTabByWebContents,
    getDatabase: getDatabase,
    getDatabasePath: function () {
      return databasePath;
    },
    getDownloadManager: getDownloadManager,
    getAppPlatform: currentAppPlatform,
    getSystemLocale: function () {
      return app.getLocale();
    },
    goBrowserBack: goBrowserBack,
    goBrowserForward: goBrowserForward,
    ipcMain: ipcMain,
    mainErrorMessage: mainErrorMessage,
    markActiveSyncMutated: markActiveSyncMutated,
    navigateBrowser: navigateBrowser,
    notifyPendingCollectionOperationsChanged: notifyPendingCollectionOperationsChanged,
    openFfmpegGuide: openFfmpegGuide,
    openLocalDataFolder: openLocalDataFolder,
    pendingCollectionOperationsState: pendingCollectionOperationsState,
    reloadBrowser: reloadBrowser,
    removePendingRemoteOperationGroup: removePendingRemoteOperationGroup,
    requestBrowserPreload: requestBrowserPreload,
    resolveBrowserPreloadResponse: resolveBrowserPreloadResponse,
    resolvePendingRemoteOperationGroup: resolvePendingRemoteOperationGroup,
    safeCreateBrowserTab: safeCreateBrowserTab,
    setBrowserBounds: setBrowserBounds,
    setBrowserTabLocked: setBrowserTabLocked,
    setBrowserTabMuted: setBrowserTabMuted,
    setCurrentLocale: setCurrentLocale,
    showBrowserTabMenu: showBrowserTabMenu,
    showLibraryVideoMenu: showLibraryVideoMenu,
    syncBrowserCollectionInWorker: syncBrowserCollectionInWorker,
    syncBrowserTheaterModeFromEvent: syncBrowserTheaterModeFromEvent,
    syncPayloadForEvent: syncPayloadForEvent,
    syncRunForCollection: syncRunForCollection,
    updateAppSettings: updateAppSettings
  });
}

registerIpcHandlers();

configureAppStorageForTests();

app.whenReady().then(async function () {
  app.setName('Jable Desktop');
  currentLocale = i18n.normalizeLocale(app.getLocale());
  installApplicationMenu();

  getDatabase();
  installLocalPlaybackProtocol();
  installWebViewEnhancement();
  await installHlsPlaybackCapture();
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
  if (hasQueuedOrActiveDownloads()) {
    event.preventDefault();
    if (allowDownloadAppQuit) {
      quitAfterDownloadsPaused();
    } else {
      promptPauseDownloadsAndQuit();
    }
    return;
  }

  flushBrowserSession();
  closeAllSyncWorkers();
});

app.on('will-quit', function () {
  flushBrowserSession();
  closeAllSyncWorkers();
  if (database) {
    database.close();
    database = null;
    databasePath = null;
  }
});
