'use strict';

import type * as Electron from 'electron';
import type * as NodePath from 'node:path';
import type {
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
  ExportResource,
  FinishSyncPayload,
  LibraryVideoMenuPayload,
  ListVideosOptions,
  SupportedLocale,
  SyncPagePayload,
  SyncState,
  VideoRow
} from './types/jable';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type BrowserBoundsState = { visible: boolean; x: number; y: number; width: number; height: number };
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
};
type DatabaseCollection = { key: CollectionKey; name: string; sourcePath: string };
type DatabaseListOptions = Partial<ListVideosOptions> & {
  sort?: ListVideosOptions['sort'] | 'updated_at' | 'last_seen_at';
};
type CollectionTogglePayload = {
  collectionKey?: CollectionKey;
  action?: unknown;
  video?: unknown;
  url?: unknown;
  title?: unknown;
  views?: unknown;
  likes?: unknown;
  img?: unknown;
  preview?: unknown;
  siteOrder?: unknown;
  site_order?: unknown;
  sort_order?: unknown;
};
type CollectionToggleResult = {
  action: 'add' | 'remove';
  changed: boolean;
  collectionKey: CollectionKey;
  url: string;
  visible: boolean;
};
type JableDatabaseInstance = {
  close(): void;
  listVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): VideoRow[];
  countVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): number;
  getCollectionUrls(collectionKey: CollectionKey): string[];
  allCollectionUrlsKnown(collectionKey: CollectionKey, urls?: unknown[] | null): boolean;
  saveSyncPage(payload: SyncPagePayload): { saved: number; collectionKey: CollectionKey; page: number | null };
  applyCollectionToggle(payload?: CollectionTogglePayload | null): CollectionToggleResult;
  finishSync(payload: FinishSyncPayload): SyncState;
  clearSyncState(collectionKey: CollectionKey): { collectionKey: CollectionKey; cleared: boolean };
  importResource(
    collectionKey: CollectionKey,
    resource: ExportResource
  ): { imported: number; collectionKey: CollectionKey };
  exportResource(collectionKey: CollectionKey): ExportResource;
  exportResourceToFile(collectionKey: CollectionKey, filePath: string): Promise<{ filePath: string; total: number }>;
};
type JableDatabaseConstructor = new (filePath: string) => JableDatabaseInstance;
type DatabaseModule = {
  COLLECTIONS: DatabaseCollection[];
  JableDatabase: JableDatabaseConstructor;
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
type UpdateCheckOptions = { manual?: boolean };
type PopupOptions = Parameters<Electron.Menu['popup']>[0];

const electron: typeof Electron = require('electron');
const path: typeof NodePath = require('node:path');
const browserTabPolicy = require('./browser-tab-policy') as BrowserTabPolicyModule;
const databaseModule = require('./database') as DatabaseModule;
const i18n = require('./i18n') as I18nModule;
const updateChecker = require('./update-checker') as UpdateCheckerModule;
const JableDatabase = databaseModule.JableDatabase;
const COLLECTIONS = databaseModule.COLLECTIONS;

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const WebContentsView = electron.WebContentsView;
const ipcMain = electron.ipcMain;
const Menu = electron.Menu;
const clipboard = electron.clipboard;
const dialog = electron.dialog;
const shell = electron.shell;
const browserTabShortcutOffset = browserTabPolicy.browserTabShortcutOffset;
const browserTabWebPreferences = browserTabPolicy.browserTabWebPreferences;
const nextActiveTabIdByOffset = browserTabPolicy.nextActiveTabIdByOffset;
const nextActiveTabIdAfterClose = browserTabPolicy.nextActiveTabIdAfterClose;
const serializedMediaState = browserTabPolicy.serializedMediaState;

const JABLE_HOME_URL = 'https://jable.tv/';
const JABLE_SESSION_PARTITION = 'persist:jable-session';
const MAX_BROWSER_TABS = 14;
const BACKGROUND_UPDATE_CHECK_DELAY_MS = 5000;
const IS_MACOS = process.platform === 'darwin';
const NEW_TAB_ACCELERATOR = IS_MACOS ? 'Command+T' : 'Ctrl+T';
const CLOSE_TAB_ACCELERATOR = IS_MACOS ? 'Command+W' : 'Ctrl+W';

let mainWindow: Electron.BrowserWindow | null = null;
const browserTabs: BrowserTab[] = [];
const browserTabsById: Record<string, BrowserTab> = {};
const webContentsTabIds: Record<string, string> = {};
let activeBrowserTabId: string | null = null;
let nextBrowserTabId = 1;
let browserBounds: BrowserBoundsState = { visible: true, x: 0, y: 52, width: 900, height: 600 };
let browserHtmlFullScreenTabId: string | null = null;
let database: JableDatabaseInstance | null = null;
let databasePath: string | null = null;
let lastShortcutAction = { name: '', at: 0 };
let currentLocale: SupportedLocale = i18n.DEFAULT_LOCALE;
let updateCheckInFlight: Promise<UpdateCheckResult> | null = null;
let lastBackgroundUpdateVersion: string | null = null;

function t(key: string, params?: TranslationParams | null): string {
  return i18n.t(currentLocale, key, params);
}

function mainErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setCurrentLocale(locale: unknown): SupportedLocale {
  currentLocale = i18n.normalizeLocale(locale);
  if (app.isReady()) installApplicationMenu();
  return currentLocale;
}

function getDatabase(): JableDatabaseInstance {
  if (!database) {
    databasePath = path.join(app.getPath('userData'), 'jable-favourites.sqlite');
    database = new JableDatabase(databasePath);
  }

  return database;
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

  if (browserTabs.length >= MAX_BROWSER_TABS) {
    throw new Error(t('errors.maxTabs', { count: MAX_BROWSER_TABS }));
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
    url: normalizedOptions.url || '',
    favicon: normalizedOptions.favicon || '',
    loading: false,
    muted: Boolean(normalizedOptions.muted),
    audible: false,
    mediaPlaying: false,
    pictureInPicture: false,
    discarded: false,
    canGoBack: false,
    canGoForward: false
  };

  browserTabs.push(tab);
  browserTabsById[id] = tab;
  webContentsTabIds[String(tab.view.webContents.id)] = id;
  wireBrowserTab(tab);

  if (!activeBrowserTabId || normalizedOptions.active !== false) {
    activeBrowserTabId = id;
  }

  if (normalizedOptions.url) loadTabUrl(tab, normalizedOptions.url, Boolean(normalizedOptions.forceReload));
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

  tab.view.webContents.on('did-fail-load', function () {
    tab.loading = false;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
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
    maxTabs: MAX_BROWSER_TABS,
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
  const currentUrl = tab.view.webContents.getURL();
  tab.url = targetUrl || tab.url;
  tab.loading = true;

  if (forceReload && currentUrl === targetUrl) tab.view.webContents.reload();
  else tab.view.webContents.loadURL(targetUrl);

  updateTabNavigationState(tab);
  notifyBrowserTabsChanged();
}

async function navigateBrowser(payload?: BrowserNavigatePayload | null): Promise<string> {
  const normalizedPayload: BrowserNavigatePayload = payload || { url: '' };
  const tab = getBrowserTab(normalizedPayload.tabId);
  const targetUrl = normalizedPayload.url;

  if (!targetUrl) return tab.view.webContents.getURL();
  if (tab.locked) throw new Error(t('errors.lockedNavigate'));

  const wait = waitForBrowserStop(tab);
  loadTabUrl(tab, targetUrl, Boolean(normalizedPayload.forceReload));
  const loadedUrl = await wait;
  notifyBrowserTabsChanged();
  return loadedUrl;
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
    enabled: browserTabs.length < MAX_BROWSER_TABS,
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
      enabled: browserTabs.length < MAX_BROWSER_TABS,
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
      enabled: browserTabs.length < MAX_BROWSER_TABS,
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

  ipcMain.handle('app:set-locale', function (_event, locale) {
    return {
      locale: setCurrentLocale(locale)
    };
  });

  ipcMain.handle('db:list-videos', function (_event, options) {
    return getDatabase().listVideos(options.collectionKey, options);
  });

  ipcMain.handle('db:count-videos', function (_event, options) {
    return getDatabase().countVideos(options.collectionKey, options);
  });

  ipcMain.handle('db:collection-urls', function (_event, collectionKey) {
    return getDatabase().getCollectionUrls(collectionKey);
  });

  ipcMain.handle('db:collection-urls-known', function (_event, payload) {
    payload = payload || {};
    return getDatabase().allCollectionUrlsKnown(payload.collectionKey, payload.urls);
  });

  ipcMain.handle('db:save-sync-page', function (_event, payload) {
    return getDatabase().saveSyncPage(payload);
  });

  ipcMain.handle('db:apply-collection-toggle', function (event, payload) {
    try {
      const result = getDatabase().applyCollectionToggle(payload);
      forwardBrowserMessage('collection-toggle', syncPayloadForEvent(event, result));
      return result;
    } catch (error) {
      forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
      throw error;
    }
  });

  ipcMain.handle('db:finish-sync', function (_event, payload) {
    return getDatabase().finishSync(payload);
  });

  ipcMain.handle('db:clear-sync-state', function (_event, collectionKey) {
    return getDatabase().clearSyncState(collectionKey);
  });

  ipcMain.handle('db:import-json', function (_event, payload) {
    return getDatabase().importResource(payload.collectionKey, payload.resource);
  });

  ipcMain.handle('db:export-json', function (_event, collectionKey) {
    return getDatabase().exportResource(collectionKey);
  });

  ipcMain.handle('db:export-json-file', function (_event, collectionKey) {
    return exportJsonFile(collectionKey);
  });

  ipcMain.handle('library:show-video-menu', function (_event, payload) {
    return showLibraryVideoMenu(payload);
  });

  ipcMain.handle('browser:list-tabs', function () {
    return browserTabsState();
  });

  ipcMain.handle('browser:show-tab-menu', function (_event, payload) {
    return showBrowserTabMenu(payload);
  });

  ipcMain.handle('browser:create-tab', function (_event, payload) {
    return createBrowserTab(payload);
  });

  ipcMain.handle('browser:activate-tab', function (_event, tabId) {
    return activateBrowserTab(tabId);
  });

  ipcMain.handle('browser:close-tab', function (_event, tabId) {
    return closeBrowserTab(tabId);
  });

  ipcMain.handle('browser:set-tab-locked', function (_event, payload) {
    return setBrowserTabLocked(payload);
  });

  ipcMain.handle('browser:set-tab-muted', function (_event, payload) {
    return setBrowserTabMuted(payload);
  });

  ipcMain.handle('browser:set-bounds', function (_event, bounds) {
    return setBrowserBounds(bounds);
  });

  ipcMain.handle('browser:navigate', function (_event, payload) {
    return navigateBrowser(payload);
  });

  ipcMain.handle('browser:reload', async function (_event, payload) {
    payload = payload || {};
    return reloadBrowser(payload.tabId);
  });

  ipcMain.handle('browser:go-back', async function (_event, payload) {
    payload = payload || {};
    return goBrowserBack(payload.tabId);
  });

  ipcMain.handle('browser:go-forward', async function (_event, payload) {
    payload = payload || {};
    return goBrowserForward(payload.tabId);
  });

  ipcMain.handle('browser:navigation-state', function (_event, payload) {
    payload = payload || {};
    return browserNavigationState(payload.tabId);
  });

  ipcMain.handle('browser:get-url', function (_event, payload) {
    payload = payload || {};
    return getBrowserTab(payload.tabId).view.webContents.getURL();
  });

  ipcMain.handle('browser:sync-collection', function (_event, payload) {
    payload = payload || {};
    const tab = getBrowserTab(payload.tabId);
    const options = Object.assign({}, payload.options || payload);
    delete options.tabId;
    delete options.options;
    const script = 'window.jableDesktopScraper.syncCollection(' + JSON.stringify(options) + ')';
    return tab.view.webContents.executeJavaScript(script, true);
  });

  ipcMain.handle('browser:diagnose', function (_event, payload) {
    payload = payload || {};
    const tab = getBrowserTab(payload.tabId);
    return tab.view.webContents.executeJavaScript(
      [
        '({',
        'url: location.href,',
        'innerWidth: window.innerWidth,',
        'innerHeight: window.innerHeight,',
        'clientHeight: document.documentElement.clientHeight,',
        'scrollHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
        '})'
      ].join(''),
      true
    );
  });

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

app.whenReady().then(function () {
  app.setName('Jable Desktop');
  currentLocale = i18n.normalizeLocale(app.getLocale());
  installApplicationMenu();

  getDatabase();
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
  if (database) database.close();
});
