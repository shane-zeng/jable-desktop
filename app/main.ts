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
import type { AppActions, AppActionsContext } from './main-process/app-actions';
import type { BrowserLoadFailure, BrowserTab } from './main-process/browser/tab-manager';
import type { BrowserOriginController, BrowserOriginControllerContext } from './main-process/browser/origin-controller';
import type { BrowserRuntimeController, BrowserRuntimeControllerContext } from './main-process/browser/runtime';
import type { ContextMenuManager, ContextMenuManagerContext } from './main-process/context-menu-manager';
import type { DataEngine } from './data/data-engine';
import type { DiagnosticsClearResult, DiagnosticsLogger } from './main-process/diagnostics/logger';
import type {
  DownloadAppShutdownController,
  DownloadAppShutdownControllerContext
} from './main-process/download-app-shutdown';
import type { DownloadManager, DownloadManagerContext } from './main-process/download/manager';
import type { IpcHandlersContext } from './main-process/ipc-handlers';
import type {
  ActiveSyncRun,
  PendingCollectionOperationOverlayState,
  SyncWorkerManager,
  SyncWorkerManagerContext
} from './main-process/sync-worker-manager';
import type { MainWindowSavedState } from './main-process/window-options';
import type {
  AppSettings,
  AppSettingsPatch,
  AppPlatform,
  BrowserTabKind,
  BrowserTabMenuPayload,
  CollectionKey,
  ExportJsonFileResult,
  LibraryVideoMenuPayload,
  PendingRemoteOperationActionResult,
  SupportedLocale,
  SyncBrowserCollectionOptions,
  SyncResult
} from './types/jable';

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
type WindowOptionsModule = {
  mainWindowPlacement(
    platform: string,
    workAreas?: Array<{ x: number; y: number; width: number; height: number }> | null,
    savedState?: MainWindowSavedState | null
  ): {
    x?: number;
    y?: number;
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
    maximized: boolean;
  };
};
type WindowStateModule = {
  MainWindowStateStore: new (filePath: string) => {
    readState(): MainWindowSavedState | null;
    writeState(state: MainWindowSavedState): void;
  };
  mainWindowStateFilePath(userDataPath: string): string;
};
type DataEngineModule = {
  COLLECTIONS: DatabaseCollection[];
  createDataEngine(filePath: string): DataEngine;
};
type BrowserTabPolicyModule = {
  browserTabWebPreferences(kind: BrowserTabKind, preloadPath: string, partition: string): Electron.WebPreferences;
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
type DiagnosticsModule = {
  createDiagnosticsLogger(
    logDirectory: string,
    options?: {
      appVersion?: string | null;
      crashDumpsDirectory?: string | null;
      pathTokens?: () => Array<{ label: string; value: string | null | undefined }>;
      processName?: string;
    } | null
  ): DiagnosticsLogger;
  diagnosticsCrashDumpsDirectory(logDirectory: string): string;
  diagnosticsLogDirectory(userDataPath: string): string;
};
const electron: typeof Electron = require('electron');
const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');
const webViewEnhancement = require('./browser/webview-enhancement') as WebViewEnhancementModule;
const appActionsModule = require('./main-process/app-actions') as {
  createAppActions(context: AppActionsContext): AppActions;
};
const appMenuManagerModule = require('./main-process/app-menu-manager') as {
  createAppMenuManager(context: AppMenuManagerContext): AppMenuManager;
};
const browserOriginControllerModule = require('./main-process/browser/origin-controller') as {
  createBrowserOriginController(context: BrowserOriginControllerContext): BrowserOriginController;
};
const browserRuntimeModule = require('./main-process/browser/runtime') as {
  createBrowserRuntimeController(context: BrowserRuntimeControllerContext): BrowserRuntimeController;
};
const browserTabPolicy = require('./browser/browser-tab-policy') as BrowserTabPolicyModule;
const contextMenuManagerModule = require('./main-process/context-menu-manager') as {
  createContextMenuManager(context: ContextMenuManagerContext): ContextMenuManager;
};
const dataEngineModule = require('./data/data-engine') as DataEngineModule;
const diagnosticsModule = require('./main-process/diagnostics/logger') as DiagnosticsModule;
const downloadAppShutdownModule = require('./main-process/download-app-shutdown') as {
  createDownloadAppShutdownController(context: DownloadAppShutdownControllerContext): DownloadAppShutdownController;
};
const downloadManagerModule = require('./main-process/download/manager') as {
  LOCAL_PLAYBACK_SCHEME: string;
  createDownloadManager(context: DownloadManagerContext): DownloadManager;
};
const i18n = require('./i18n') as I18nModule;
const hlsPlaybackCapture = require('./main-process/hls-playback/capture') as HlsPlaybackCaptureModule;
const ipcHandlers = require('./main-process/ipc-handlers') as {
  registerIpcHandlers(context: IpcHandlersContext): void;
};
const settingsModule = require('./main-process/settings') as SettingsModule;
const syncWorkerManagerModule = require('./main-process/sync-worker-manager') as {
  createSyncWorkerManager(context: SyncWorkerManagerContext): SyncWorkerManager;
};
const updateChecker = require('./main-process/update-checker') as UpdateCheckerModule;
const windowOptions = require('./main-process/window-options') as WindowOptionsModule;
const windowStateModule = require('./main-process/window-state') as WindowStateModule;
const urlPolicy = require('./browser/url-policy') as UrlPolicyModule;
const COLLECTIONS = dataEngineModule.COLLECTIONS;

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const WebContentsView = electron.WebContentsView;
const crashReporter = electron.crashReporter;
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
let appActions: AppActions | null = null;
let appMenuManager: AppMenuManager | null = null;
let browserOriginController: BrowserOriginController | null = null;
let browserRuntimeController: BrowserRuntimeController | null = null;
let contextMenuManager: ContextMenuManager | null = null;
let database: DataEngine | null = null;
let databasePath: string | null = null;
let diagnosticsLogger: DiagnosticsLogger | null = null;
let diagnosticsIpcMain: typeof Electron.ipcMain | null = null;
let downloadAppShutdownController: DownloadAppShutdownController | null = null;
let downloadManager: DownloadManager | null = null;
let syncWorkerManager: SyncWorkerManager | null = null;
let settingsStore: InstanceType<SettingsModule['AppSettingsStore']> | null = null;
let mainWindowStateStore: InstanceType<WindowStateModule['MainWindowStateStore']> | null = null;
let currentLocale: SupportedLocale = i18n.DEFAULT_LOCALE;

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

function safeAppPath(name: Parameters<Electron.App['getPath']>[0]): string | null {
  try {
    return app.getPath(name);
  } catch (error) {
    return null;
  }
}

function diagnosticsPathTokens() {
  let downloadRootPath: string | null = null;

  try {
    downloadRootPath = getAppSettings().downloadRoot || path.join(app.getPath('userData'), 'downloads');
  } catch (error) {
    downloadRootPath = null;
  }

  return [
    { label: 'home', value: safeAppPath('home') },
    { label: 'userData', value: safeAppPath('userData') },
    { label: 'downloadRoot', value: downloadRootPath }
  ];
}

function getDiagnosticsLogger(): DiagnosticsLogger {
  if (!diagnosticsLogger) {
    const logDirectory = diagnosticsModule.diagnosticsLogDirectory(app.getPath('userData'));
    const crashDumpsDirectory = diagnosticsModule.diagnosticsCrashDumpsDirectory(logDirectory);
    diagnosticsLogger = diagnosticsModule.createDiagnosticsLogger(logDirectory, {
      appVersion: app.getVersion(),
      crashDumpsDirectory: crashDumpsDirectory,
      pathTokens: diagnosticsPathTokens,
      processName: 'main'
    });
  }

  return diagnosticsLogger;
}

function configureDiagnostics() {
  const logDirectory = diagnosticsModule.diagnosticsLogDirectory(app.getPath('userData'));
  const crashDumpsDirectory = diagnosticsModule.diagnosticsCrashDumpsDirectory(logDirectory);

  app.setAppLogsPath(logDirectory);
  app.setPath('crashDumps', crashDumpsDirectory);
  getDiagnosticsLogger();

  try {
    crashReporter.start({
      productName: 'Jable Desktop',
      uploadToServer: false,
      globalExtra: {
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      }
    });
  } catch (error) {
    getDiagnosticsLogger().errorEvent('electron', 'crash-reporter-start-failed', error);
  }

  getDiagnosticsLogger().event('info', 'app', 'startup', {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch
  });
}

function installProcessDiagnostics() {
  process.on('uncaughtExceptionMonitor', function (error) {
    getDiagnosticsLogger().errorEvent('process', 'uncaught-exception', error);
  });
  process.on('unhandledRejection', function (reason) {
    getDiagnosticsLogger().errorEvent('process', 'unhandled-rejection', reason);
  });
  process.on('warning', function (warning) {
    getDiagnosticsLogger().errorEvent('process', 'warning', warning);
  });
  app.on('child-process-gone', function (_event, details) {
    getDiagnosticsLogger().event('error', 'electron', 'child-process-gone', details);
  });
}

function logWebContentsContext(details: () => Record<string, unknown>) {
  try {
    return details();
  } catch (error) {
    return {};
  }
}

function wireWebContentsDiagnostics(webContents: Electron.WebContents, details: () => Record<string, unknown>) {
  webContents.on('render-process-gone', function (_event, goneDetails) {
    getDiagnosticsLogger().event('error', 'electron', 'render-process-gone', {
      webContentsId: webContents.id,
      details: goneDetails,
      context: logWebContentsContext(details)
    });
  });
  webContents.on('preload-error', function (_event, preloadPath, error) {
    getDiagnosticsLogger().errorEvent('electron', 'preload-error', error, {
      webContentsId: webContents.id,
      preload: path.basename(preloadPath || ''),
      context: logWebContentsContext(details)
    });
  });
  webContents.on('unresponsive', function () {
    getDiagnosticsLogger().event('warn', 'electron', 'web-contents-unresponsive', {
      webContentsId: webContents.id,
      context: logWebContentsContext(details)
    });
  });
  webContents.on('responsive', function () {
    getDiagnosticsLogger().event('info', 'electron', 'web-contents-responsive', {
      webContentsId: webContents.id,
      context: logWebContentsContext(details)
    });
  });
  webContents.on(
    'did-fail-load',
    function (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean
    ) {
      if (!isMainFrame) return;

      getDiagnosticsLogger().event('warn', 'electron', 'web-contents-main-frame-load-failed', {
        webContentsId: webContents.id,
        errorCode: errorCode,
        errorDescription: errorDescription,
        url: validatedURL || webContents.getURL(),
        context: logWebContentsContext(details)
      });
    }
  );
  webContents.on('console-message', function (eventDetails, level, message, line, sourceId) {
    const normalizedLevel =
      typeof eventDetails.level === 'string'
        ? eventDetails.level
        : level >= 3
          ? 'error'
          : level >= 2
            ? 'warning'
            : level <= 0
              ? 'debug'
              : 'info';
    if (normalizedLevel !== 'warning' && normalizedLevel !== 'error') return;

    getDiagnosticsLogger().event(
      normalizedLevel === 'error' ? 'error' : 'warn',
      'renderer-console',
      'console-message',
      {
        webContentsId: webContents.id,
        level: normalizedLevel,
        message: eventDetails.message || message,
        lineNumber: eventDetails.lineNumber || line,
        sourceId: eventDetails.sourceId || sourceId,
        context: logWebContentsContext(details)
      }
    );
  });
}

function diagnosticsIpcMainWrapper(): typeof Electron.ipcMain {
  if (diagnosticsIpcMain) return diagnosticsIpcMain;

  const wrapped = Object.create(ipcMain) as typeof Electron.ipcMain;
  wrapped.handle = function (channel, listener) {
    return ipcMain.handle(channel, async function (event, ...args) {
      const startedAt = Date.now();
      try {
        return await listener(event, ...args);
      } catch (error) {
        getDiagnosticsLogger().errorEvent('ipc', 'ipc-handle-failed', error, {
          channel: channel,
          durationMs: Date.now() - startedAt
        });
        throw error;
      }
    });
  };
  wrapped.on = function (channel, listener) {
    return ipcMain.on(channel, function (event, ...args) {
      const startedAt = Date.now();
      try {
        return listener(event, ...args);
      } catch (error) {
        getDiagnosticsLogger().errorEvent('ipc', 'ipc-event-failed', error, {
          channel: channel,
          durationMs: Date.now() - startedAt
        });
        throw error;
      }
    });
  };
  diagnosticsIpcMain = wrapped;
  return diagnosticsIpcMain;
}

function shouldDenyWebViewEnhancementNavigation(url: unknown): boolean {
  if (!getAppSettings().webViewEnhancementMode) return false;

  const suppressed = webViewEnhancement.shouldSuppressWebViewNavigation(url);

  if (suppressed && webViewEnhancement.isWebViewEnhancementDebugEnabledByEnv(process.env)) {
    getDiagnosticsLogger().event('info', 'webview-enhancement', 'suppressed-navigation', { url: url });
  }

  return suppressed;
}

function installWebViewEnhancement() {
  const result = webViewEnhancement.installJableWebViewEnhancement(session.fromPartition(JABLE_SESSION_PARTITION), {
    enabled: function () {
      return getAppSettings().webViewEnhancementMode;
    },
    debug: webViewEnhancement.isWebViewEnhancementDebugEnabledByEnv(process.env),
    logger: getDiagnosticsLogger()
  });

  if (result.installed && webViewEnhancement.isWebViewEnhancementDebugEnabledByEnv(process.env)) {
    getDiagnosticsLogger().event('info', 'webview-enhancement', 'installed', { patterns: result.patterns.length });
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
    getBrowserTabByWebContents: function (webContents) {
      return getBrowserRuntime().getTabByWebContents(webContents);
    },
    jableFallbackOrigin: urlPolicy.JABLE_FALLBACK_ORIGIN,
    jablePrimaryOrigin: urlPolicy.JABLE_PRIMARY_ORIGIN,
    jableSession: session.fromPartition(JABLE_SESSION_PARTITION),
    ipcMain: ipcMain,
    logger: getDiagnosticsLogger(),
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

function getBrowserOriginController(): BrowserOriginController {
  if (!browserOriginController) {
    browserOriginController = browserOriginControllerModule.createBrowserOriginController({
      fallbackJableUrl: urlPolicy.fallbackJableUrl,
      fallbackOrigin: urlPolicy.JABLE_FALLBACK_ORIGIN,
      forwardBrowserMessage: forwardBrowserMessage,
      isSafeBrowserUrl: urlPolicy.isSafeBrowserUrl,
      primaryOrigin: urlPolicy.JABLE_PRIMARY_ORIGIN,
      rewriteJableUrlOrigin: urlPolicy.rewriteJableUrlOrigin,
      t: t
    });
  }

  return browserOriginController;
}

function normalizeBrowserNavigationUrl(value: unknown): string {
  return getBrowserOriginController().normalizeNavigationUrl(value);
}

function activateJableFallbackOrigin() {
  getBrowserOriginController().activateFallbackOrigin();
}

function fallbackUrlForLoadFailure(failure: BrowserLoadFailure | null | undefined): string | null {
  return getBrowserOriginController().fallbackUrlForLoadFailure(failure);
}

function getBrowserRuntime(): BrowserRuntimeController {
  if (!browserRuntimeController) {
    browserRuntimeController = browserRuntimeModule.createBrowserRuntimeController({
      activateFallbackOrigin: activateJableFallbackOrigin,
      createWindow: createWindow,
      fallbackUrlForLoadFailure: fallbackUrlForLoadFailure,
      forwardBrowserMessage: forwardBrowserMessage,
      getMainWindow: function () {
        return mainWindow;
      },
      getMaxBrowserTabs: function () {
        return getAppSettings().maxBrowserTabs;
      },
      getSettings: getAppSettings,
      homeUrl: JABLE_HOME_URL,
      isMacos: IS_MACOS,
      logger: getDiagnosticsLogger(),
      mainErrorMessage: mainErrorMessage,
      normalizeNavigationUrl: normalizeBrowserNavigationUrl,
      saveDelayMs: BROWSER_SESSION_SAVE_DELAY_MS,
      sessionPartition: JABLE_SESSION_PARTITION,
      shouldDenyWebViewEnhancementNavigation: shouldDenyWebViewEnhancementNavigation,
      showBrowserContextMenu: showBrowserContextMenu,
      t: t,
      theaterModeRequestTimeoutMs: BROWSER_THEATER_MODE_REQUEST_TIMEOUT_MS,
      userDataPath: function () {
        return app.getPath('userData');
      },
      WebContentsView: WebContentsView,
      webviewPreloadPath: path.join(__dirname, 'webview-preload.js'),
      wireWebContentsDiagnostics: wireWebContentsDiagnostics
    });
  }

  return browserRuntimeController;
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

function getMainWindowStateStore() {
  if (!mainWindowStateStore) {
    mainWindowStateStore = new windowStateModule.MainWindowStateStore(
      windowStateModule.mainWindowStateFilePath(app.getPath('userData'))
    );
  }

  return mainWindowStateStore;
}

function saveMainWindowState(browserWindow: Electron.BrowserWindow) {
  try {
    const normalBounds = browserWindow.getNormalBounds();
    getMainWindowStateStore().writeState({
      x: normalBounds.x,
      y: normalBounds.y,
      width: normalBounds.width,
      height: normalBounds.height,
      maximized: browserWindow.isMaximized()
    });
  } catch (error) {
    getDiagnosticsLogger().errorEvent('window-state', 'save-failed', error);
  }
}

function mainWindowWorkAreas(): Array<{ x: number; y: number; width: number; height: number }> {
  const primaryDisplay = electron.screen.getPrimaryDisplay();
  const displays = electron.screen.getAllDisplays();
  const orderedDisplays = [primaryDisplay].concat(
    displays.filter(function (display) {
      return display.id !== primaryDisplay.id;
    })
  );

  return orderedDisplays.map(function (display) {
    return display.workArea;
  });
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
      logger: getDiagnosticsLogger(),
      forwardBrowserMessage: forwardBrowserMessage,
      sendToAllBrowserTabs: function (channel, payload) {
        getBrowserRuntime().sendToAllTabs(channel, payload);
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
  getDiagnosticsLogger().event('info', 'settings', 'settings-updated', {
    keys: patch && typeof patch === 'object' ? Object.keys(patch as Record<string, unknown>) : []
  });
  getBrowserRuntime().notifyChanged();
  forwardBrowserMessage('settings-changed', settings);
  getBrowserRuntime().sendToAllTabs('settings-changed', settings);
  if (previousSettings.restoreBrowserTabsOnStartup !== settings.restoreBrowserTabsOnStartup) {
    if (settings.restoreBrowserTabsOnStartup) getBrowserRuntime().saveSessionNow();
    else {
      getBrowserRuntime().clearSession();
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
    getDiagnosticsLogger().event('info', 'database', 'open', { path: databasePath });
    database = dataEngineModule.createDataEngine(databasePath);
  }

  return database;
}

function getAppActions(): AppActions {
  if (!appActions) {
    appActions = appActionsModule.createAppActions({
      app: app,
      collections: COLLECTIONS,
      dialog: dialog,
      ffmpegGuideUrls: FFMPEG_GUIDE_URLS,
      fs: fs,
      getCurrentLocale: function () {
        return currentLocale;
      },
      getDatabase: getDatabase,
      getDatabasePath: function () {
        return databasePath;
      },
      getMainWindow: function () {
        return mainWindow;
      },
      path: path,
      shell: shell,
      t: t
    });
  }

  return appActions;
}

function openLocalDataFolder(): Promise<{ opened: boolean; path: string }> {
  return getAppActions().openLocalDataFolder();
}

function openLogFolder(): Promise<{ opened: boolean; path: string }> {
  const folderPath = getDiagnosticsLogger().logDirectory();
  fs.mkdirSync(folderPath, { recursive: true });

  if (process.env.JABLE_DESKTOP_TEST_BYPASS_SHELL_OPEN === '1') {
    getDiagnosticsLogger().event('info', 'diagnostics', 'log-folder-opened', { path: folderPath });
    return Promise.resolve({
      opened: true,
      path: folderPath
    });
  }

  return shell.openPath(folderPath).then(function (errorMessage: string) {
    if (errorMessage) throw new Error(errorMessage);
    getDiagnosticsLogger().event('info', 'diagnostics', 'log-folder-opened', { path: folderPath });
    return {
      opened: true,
      path: folderPath
    };
  });
}

function clearDiagnostics(): Promise<DiagnosticsClearResult> {
  return showAppDialog({
    type: 'warning',
    buttons: [t('dialog.clearDiagnosticsConfirm'), t('dialog.cancel')],
    defaultId: 0,
    cancelId: 1,
    title: t('dialog.clearDiagnosticsTitle'),
    message: t('dialog.clearDiagnosticsMessage')
  }).then(function (dialogResult: Electron.MessageBoxReturnValue) {
    if (dialogResult.response !== 0) {
      return {
        canceled: true,
        deletedFiles: 0,
        failedFiles: 0
      };
    }

    const result = getDiagnosticsLogger().clearDiagnostics();
    getDiagnosticsLogger().event('info', 'diagnostics', 'diagnostics-cleared', result);
    return result;
  });
}

function openFfmpegGuide(): Promise<{ opened: boolean; url: string }> {
  return getAppActions().openFfmpegGuide();
}

function getDownloadAppShutdownController(): DownloadAppShutdownController {
  if (!downloadAppShutdownController) {
    downloadAppShutdownController = downloadAppShutdownModule.createDownloadAppShutdownController({
      appQuit: function () {
        app.quit();
      },
      getDownloadManager: getDownloadManager,
      logger: getDiagnosticsLogger(),
      quitAfterWindowClose: process.platform !== 'darwin'
    });
  }

  return downloadAppShutdownController;
}

function hasQueuedOrActiveDownloads(): boolean {
  return getDownloadAppShutdownController().hasQueuedOrActiveDownloads();
}

function promptPauseDownloadsAndClose(browserWindow: Electron.BrowserWindow) {
  getDownloadAppShutdownController().promptPauseDownloadsAndClose(browserWindow);
}

function createWindow() {
  const placement = windowOptions.mainWindowPlacement(
    process.platform,
    mainWindowWorkAreas(),
    getMainWindowStateStore().readState()
  );
  const browserWindowOptions: Electron.BrowserWindowConstructorOptions = {
    width: placement.width,
    height: placement.height,
    minWidth: placement.minWidth,
    minHeight: placement.minHeight,
    title: 'Jable Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false
    }
  };

  if (typeof placement.x === 'number' && typeof placement.y === 'number') {
    browserWindowOptions.x = placement.x;
    browserWindowOptions.y = placement.y;
  }

  mainWindow = new BrowserWindow(browserWindowOptions);
  if (placement.maximized) mainWindow.maximize();

  wireWebContentsDiagnostics(mainWindow.webContents, function () {
    return {
      kind: 'main-window',
      url: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : ''
    };
  });
  getBrowserRuntime().registerAppShortcuts(mainWindow.webContents);

  mainWindow.webContents.setWindowOpenHandler(function (details: Electron.HandlerDetails) {
    if (details.url) {
      if (shouldDenyWebViewEnhancementNavigation(details.url)) return { action: 'deny' };

      try {
        getBrowserRuntime().createTab({
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
    if (direction === 'right') getBrowserRuntime().goBack();
    else if (direction === 'left') getBrowserRuntime().goForward();
  });

  mainWindow.on('resize', function () {
    getBrowserRuntime().scheduleHtmlFullScreenResize();
  });
  mainWindow.on('enter-full-screen', function () {
    getBrowserRuntime().scheduleHtmlFullScreenResize();
  });
  mainWindow.on('leave-full-screen', function () {
    getBrowserRuntime().scheduleHtmlFullScreenResize();
  });
  mainWindow.on('close', function (event: Electron.Event) {
    if (getDownloadAppShutdownController().consumeWindowCloseAllowance()) {
      saveMainWindowState(mainWindow as Electron.BrowserWindow);
      getBrowserRuntime().flushSession();
      return;
    }
    if (!hasQueuedOrActiveDownloads()) {
      saveMainWindowState(mainWindow as Electron.BrowserWindow);
      getBrowserRuntime().flushSession();
      return;
    }

    event.preventDefault();
    promptPauseDownloadsAndClose(mainWindow as Electron.BrowserWindow);
  });
  mainWindow.on('closed', function () {
    getBrowserRuntime().closeAllTabs();
    mainWindow = null;
    closeAllSyncWorkers();
  });

  loadRenderer();
  getBrowserRuntime().createInitialTabs();
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
      closeActiveTabFromShortcut: function () {
        getBrowserRuntime().closeActiveTabFromShortcut();
      },
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
      openHomeTabFromShortcut: function () {
        getBrowserRuntime().openHomeTabFromShortcut();
      },
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

function getSyncWorkerManager(): SyncWorkerManager {
  if (!syncWorkerManager) {
    syncWorkerManager = syncWorkerManagerModule.createSyncWorkerManager({
      activateFallbackOrigin: activateJableFallbackOrigin,
      browserTabWebPreferences: browserTabWebPreferences,
      BrowserWindow: BrowserWindow,
      fallbackUrlForLoadFailure: fallbackUrlForLoadFailure,
      forwardBrowserMessage: forwardBrowserMessage,
      getActiveJableOrigin: function () {
        return getBrowserOriginController().activeOrigin();
      },
      getAutoReplayDeferredSyncOperations: function () {
        return getAppSettings().autoReplayDeferredSyncOperations;
      },
      getDatabase: getDatabase,
      rejectPreloadRequestsForWebContents: function (webContentsId, message) {
        getBrowserRuntime().rejectPreloadRequestsForWebContents(webContentsId, message);
      },
      requestWebContentsPreload: function (webContents, channel, payload, timeoutMs) {
        return getBrowserRuntime().requestWebContentsPreload(webContents, channel, payload, timeoutMs);
      },
      sendToAllBrowserTabs: function (channel, payload) {
        getBrowserRuntime().sendToAllTabs(channel, payload);
      },
      sessionPartition: JABLE_SESSION_PARTITION,
      shouldDenyWebViewEnhancementNavigation: shouldDenyWebViewEnhancementNavigation,
      t: t,
      webviewPreloadPath: path.join(__dirname, 'webview-preload.js'),
      wireWebContentsDiagnostics: wireWebContentsDiagnostics
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
      activateBrowserTab: function (tabId) {
        return getBrowserRuntime().activateTab(tabId);
      },
      canCreateBrowserTab: function () {
        return getBrowserRuntime().canCreateTab();
      },
      canonicalJableVideoUrl: urlPolicy.canonicalJableVideoUrl,
      clipboard: electron.clipboard,
      closeBrowserTab: function (tabId) {
        return getBrowserRuntime().closeTab(tabId);
      },
      forwardBrowserMessage: forwardBrowserMessage,
      getActiveBrowserTabId: function () {
        return getBrowserRuntime().activeTabId();
      },
      getBrowserTab: function (tabId) {
        return getBrowserRuntime().getTab(tabId);
      },
      getMainWindow: function () {
        return mainWindow;
      },
      goBrowserBack: function (tabId) {
        return getBrowserRuntime().goBack(tabId);
      },
      goBrowserForward: function (tabId) {
        return getBrowserRuntime().goForward(tabId);
      },
      homeUrl: JABLE_HOME_URL,
      Menu: Menu,
      reloadBrowser: function (tabId) {
        return getBrowserRuntime().reload(tabId);
      },
      safeCreateBrowserTab: function (options) {
        return getBrowserRuntime().safeCreateTab(options);
      },
      setBrowserTabTheaterMode: function (tab, enabled) {
        return getBrowserRuntime().setTabTheaterMode(tab, enabled);
      },
      setBrowserTabMuted: function (payload) {
        return getBrowserRuntime().setTabMuted(payload);
      },
      shell: shell,
      syncBrowserTabMediaState: function (tab) {
        getBrowserRuntime().syncTabMediaState(tab);
      },
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

async function exportJsonFile(collectionKey: CollectionKey): Promise<ExportJsonFileResult> {
  return getAppActions().exportJsonFile(collectionKey);
}

function forwardBrowserMessage(channel: string, payload: unknown) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('browser-message', {
    channel: channel,
    args: [payload]
  });
}

function syncPayloadForEvent(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, payload: unknown) {
  const tab = getBrowserRuntime().getTabByWebContents(event.sender);
  const normalizedPayload = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return Object.assign({}, normalizedPayload, {
    tabId: tab ? tab.id : null
  });
}

function diagnosticsLevel(value: unknown): 'debug' | 'info' | 'warn' | 'error' {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error' ? value : 'error';
}

function recordDiagnosticsEvent(source: 'renderer' | 'webview', payload: unknown) {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const eventName = typeof record.event === 'string' && record.event ? record.event : source + '-event';
  getDiagnosticsLogger().event(diagnosticsLevel(record.level), source, eventName, record);
}

function registerIpcHandlers() {
  ipcHandlers.registerIpcHandlers({
    activeSyncRunsState: activeSyncRunsState,
    activateBrowserTab: function (tabId) {
      return getBrowserRuntime().activateTab(tabId);
    },
    addPendingRemoteOperationGroup: addPendingRemoteOperationGroup,
    applyBrowserSyncCollectionSettings: browserSyncCollectionPayloadWithSettings,
    browserDiagnosisTimeoutMs: BROWSER_DIAGNOSE_REQUEST_TIMEOUT_MS,
    browserNavigationState: function (tabId) {
      return getBrowserRuntime().navigationState(tabId);
    },
    browserTabsState: function () {
      return getBrowserRuntime().listTabs();
    },
    checkForUpdates: checkForUpdates,
    closeBrowserTab: function (tabId) {
      return getBrowserRuntime().closeTab(tabId);
    },
    createBrowserTab: function (options) {
      return getBrowserRuntime().createTab(options);
    },
    currentLocale: function () {
      return currentLocale;
    },
    exportJsonFile: exportJsonFile,
    forwardBrowserMessage: forwardBrowserMessage,
    getAppSettings: getAppSettings,
    getBrowserTab: function (tabId) {
      return getBrowserRuntime().getTab(tabId);
    },
    getBrowserTabByWebContents: function (webContents) {
      return getBrowserRuntime().getTabByWebContents(webContents);
    },
    getDatabase: getDatabase,
    getDatabasePath: function () {
      return databasePath;
    },
    getDownloadManager: getDownloadManager,
    getAppPlatform: currentAppPlatform,
    getAppVersion: function () {
      return app.getVersion();
    },
    getSystemLocale: function () {
      return app.getLocale();
    },
    goBrowserBack: function (tabId) {
      return getBrowserRuntime().goBack(tabId);
    },
    goBrowserForward: function (tabId) {
      return getBrowserRuntime().goForward(tabId);
    },
    ipcMain: diagnosticsIpcMainWrapper(),
    mainErrorMessage: mainErrorMessage,
    markActiveSyncMutated: markActiveSyncMutated,
    navigateBrowser: function (payload) {
      return getBrowserRuntime().navigate(payload);
    },
    notifyPendingCollectionOperationsChanged: notifyPendingCollectionOperationsChanged,
    openFfmpegGuide: openFfmpegGuide,
    openLocalDataFolder: openLocalDataFolder,
    openLogFolder: openLogFolder,
    pendingCollectionOperationsState: pendingCollectionOperationsState,
    clearDiagnostics: clearDiagnostics,
    recordDiagnosticsEvent: recordDiagnosticsEvent,
    reloadBrowser: function (tabId) {
      return getBrowserRuntime().reload(tabId);
    },
    removePendingRemoteOperationGroup: removePendingRemoteOperationGroup,
    requestBrowserPreload: function (tab, channel, payload, timeoutMs) {
      return getBrowserRuntime().requestBrowserPreload(tab, channel, payload, timeoutMs);
    },
    resolveBrowserPreloadResponse: function (event, payload) {
      getBrowserRuntime().resolvePreloadResponse(event, payload);
    },
    resolvePendingRemoteOperationGroup: resolvePendingRemoteOperationGroup,
    safeCreateBrowserTab: function (options) {
      return getBrowserRuntime().safeCreateTab(options);
    },
    setBrowserBounds: function (bounds) {
      return getBrowserRuntime().setBounds(bounds);
    },
    setBrowserTabLocked: function (payload) {
      return getBrowserRuntime().setTabLocked(payload);
    },
    setBrowserTabMuted: function (payload) {
      return getBrowserRuntime().setTabMuted(payload);
    },
    setCurrentLocale: setCurrentLocale,
    showBrowserTabMenu: showBrowserTabMenu,
    showLibraryVideoMenu: showLibraryVideoMenu,
    syncBrowserCollectionInWorker: syncBrowserCollectionInWorker,
    syncBrowserTheaterModeFromEvent: function (event, payload) {
      getBrowserRuntime().syncTheaterModeFromEvent(event, payload);
    },
    syncPayloadForEvent: syncPayloadForEvent,
    syncRunForCollection: syncRunForCollection,
    updateAppSettings: updateAppSettings
  });
}

configureAppStorageForTests();
app.setName('Jable Desktop');
configureDiagnostics();
installProcessDiagnostics();
registerIpcHandlers();

app.whenReady().then(async function () {
  currentLocale = i18n.normalizeLocale(app.getLocale());
  installApplicationMenu();
  getDiagnosticsLogger().event('info', 'app', 'ready');

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
  getDiagnosticsLogger().event('info', 'app', 'window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', function (event: Electron.Event) {
  getDiagnosticsLogger().event('info', 'app', 'before-quit');
  if (getDownloadAppShutdownController().handleBeforeQuit(event)) return;

  getBrowserRuntime().flushSession();
  closeAllSyncWorkers();
});

app.on('will-quit', function () {
  getDiagnosticsLogger().event('info', 'app', 'will-quit');
  getBrowserRuntime().flushSession();
  closeAllSyncWorkers();
  if (database) {
    getDiagnosticsLogger().event('info', 'database', 'close', { path: databasePath });
    database.close();
    database = null;
    databasePath = null;
  }
});
