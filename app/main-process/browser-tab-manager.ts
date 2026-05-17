'use strict';

import type * as Electron from 'electron';
import type {
  BrowserBounds,
  BrowserNavigatePayload,
  BrowserNavigationState,
  BrowserTabKind,
  BrowserTabLockedPayload,
  BrowserTabMutedPayload,
  BrowserTabsState,
  CreateBrowserTabPayload
} from '../types/jable';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
export type BrowserBoundsState = { visible: boolean; x: number; y: number; width: number; height: number };
export type BrowserLoadFailure = { url: string; errorCode: number };
export type BrowserTab = {
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
type SerializedMediaState = {
  muted: boolean;
  audible: boolean;
  mediaPlaying: boolean;
  pictureInPicture: boolean;
  discarded: boolean;
};
type BrowserTabPolicyModule = {
  browserTabWebPreferences(kind: BrowserTabKind, preloadPath: string, partition: string): Electron.WebPreferences;
  nextActiveTabIdByOffset(tabs: BrowserTab[], activeTabId: string | null, offset: number): string | null;
  nextActiveTabIdAfterClose(tabs: BrowserTab[], activeTabId: string | null, closingTabId: string): string | null;
  serializedMediaState(tab: BrowserTab): SerializedMediaState;
};

export type BrowserTabManagerContext = {
  activateFallbackOrigin(): void;
  fallbackUrlForLoadFailure(failure: BrowserLoadFailure | null | undefined): string | null;
  forwardBrowserMessage(channel: string, payload: unknown): void;
  getMainWindow(): Electron.BrowserWindow | null;
  getMaxBrowserTabs(): number;
  homeUrl: string;
  normalizeNavigationUrl(value: unknown): string;
  registerShortcuts(webContents: Electron.WebContents): void;
  rejectPreloadRequestsForWebContents(webContentsId: number, message: string): void;
  sessionPartition: string;
  shouldActivateWindowOpen(details: Electron.HandlerDetails | null | undefined): boolean;
  shouldDenyWebViewEnhancementNavigation(url: unknown): boolean;
  showBrowserContextMenu(tab: BrowserTab, params: Electron.ContextMenuParams): void;
  t(key: string, params?: TranslationParams | null): string;
  WebContentsView: typeof Electron.WebContentsView;
  webviewPreloadPath: string;
};

export type BrowserTabManager = {
  activeTabId(): string | null;
  activateRelativeTab(offset: number): BrowserTabsState;
  activateTab(tabId: string | null): BrowserTabsState;
  canCreateTab(): boolean;
  closeTab(tabId: string | null): BrowserTabsState;
  createTab(options?: CreateBrowserTabPayload | null): BrowserTabsState;
  detachAllTabs(): void;
  getTab(tabId?: string | null): BrowserTab;
  getTabByWebContents(webContents: Electron.WebContents | null | undefined): BrowserTab | null;
  getUrl(tabId?: string | null): string;
  goBack(tabId?: string | null): Promise<BrowserNavigationState>;
  goForward(tabId?: string | null): Promise<BrowserNavigationState>;
  listTabs(): BrowserTabsState;
  navigate(payload?: BrowserNavigatePayload | null): Promise<string>;
  navigationState(tabId?: string | null): BrowserNavigationState;
  notifyChanged(): void;
  reload(tabId?: string | null): Promise<BrowserNavigationState>;
  safeCreateTab(options?: CreateBrowserTabPayload | null): BrowserTabsState;
  scheduleHtmlFullScreenResize(): void;
  sendToAllTabs(channel: string, payload: unknown): void;
  setBounds(bounds: BrowserBounds | null | undefined): BrowserBounds | null;
  setTabLocked(payload?: BrowserTabLockedPayload | null): BrowserTabsState;
  setTabMuted(payload?: BrowserTabMutedPayload | null): BrowserTabsState;
  syncTabMediaState(tab: BrowserTab | null | undefined): void;
  tabCount(): number;
};

const browserTabPolicy = require('../browser/browser-tab-policy') as BrowserTabPolicyModule;

const browserTabWebPreferences = browserTabPolicy.browserTabWebPreferences;
const nextActiveTabIdByOffset = browserTabPolicy.nextActiveTabIdByOffset;
const nextActiveTabIdAfterClose = browserTabPolicy.nextActiveTabIdAfterClose;
const serializedMediaState = browserTabPolicy.serializedMediaState;

let activateFallbackOrigin: () => void;
let fallbackUrlForLoadFailure: (failure: BrowserLoadFailure | null | undefined) => string | null;
let forwardBrowserMessage: (channel: string, payload: unknown) => void;
let getMainWindow: () => Electron.BrowserWindow | null;
let getMaxBrowserTabs: () => number;
let homeUrl = '';
let normalizeNavigationUrl: (value: unknown) => string;
let registerShortcuts: (webContents: Electron.WebContents) => void;
let rejectPreloadRequestsForWebContents: (webContentsId: number, message: string) => void;
let sessionPartition = '';
let shouldActivateWindowOpen: (details: Electron.HandlerDetails | null | undefined) => boolean;
let shouldDenyWebViewEnhancementNavigation: (url: unknown) => boolean;
let showBrowserContextMenu: (tab: BrowserTab, params: Electron.ContextMenuParams) => void;
let translate: (key: string, params?: TranslationParams | null) => string;
let WebContentsView: typeof Electron.WebContentsView;
let webviewPreloadPath = '';

const browserTabs: BrowserTab[] = [];
const browserTabsById: Record<string, BrowserTab> = {};
const webContentsTabIds: Record<string, string> = {};
let activeBrowserTabId: string | null = null;
let nextBrowserTabId = 1;
let browserBounds: BrowserBoundsState = { visible: true, x: 0, y: 52, width: 900, height: 600 };
let browserHtmlFullScreenTabId: string | null = null;

function t(key: string, params?: TranslationParams | null): string {
  return translate(key, params);
}

function mainErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentMainWindow(): Electron.BrowserWindow | null {
  const mainWindow = getMainWindow();
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function autoFallbackBrowserTab(tab: BrowserTab, failure: BrowserLoadFailure | null | undefined): boolean {
  const fallbackUrl = fallbackUrlForLoadFailure(failure);
  if (!fallbackUrl) return false;

  activateFallbackOrigin();
  loadTabUrl(tab, fallbackUrl, true);
  return true;
}

function createBrowserTab(options?: CreateBrowserTabPayload | null): BrowserTabsState {
  const normalizedOptions = options || {};
  const targetUrl = normalizeNavigationUrl(normalizedOptions.url);
  const maxTabs = getMaxBrowserTabs();

  if (browserTabs.length >= maxTabs) {
    throw new Error(t('errors.maxTabs', { count: maxTabs }));
  }

  const kind: BrowserTabKind = normalizedOptions.kind === 'sync' ? 'sync' : 'normal';
  const id = 'tab-' + nextBrowserTabId++;
  const preloadPath = webviewPreloadPath;
  const tab: BrowserTab = {
    id: id,
    kind: kind,
    view: new WebContentsView({
      webPreferences: browserTabWebPreferences(kind, preloadPath, sessionPartition)
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
  const webContentsId = tab.view.webContents.id;

  registerShortcuts(tab.view.webContents);

  if (tab.muted) {
    tab.view.webContents.setAudioMuted(true);
  }

  tab.view.webContents.setWindowOpenHandler(function (details: Electron.HandlerDetails) {
    if (details.url) {
      if (shouldDenyWebViewEnhancementNavigation(details.url)) return { action: 'deny' };

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
    if (shouldDenyWebViewEnhancementNavigation(url)) event.preventDefault();
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
    rejectPreloadRequestsForWebContents(webContentsId, 'Browser tab renderer process ended');
  });

  tab.view.webContents.on('destroyed', function () {
    rejectPreloadRequestsForWebContents(webContentsId, t('errors.tabNotFound'));
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
    maxTabs: getMaxBrowserTabs(),
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
  const mainWindow = currentMainWindow();
  if (!mainWindow || !tab || !tab.attached) return;
  mainWindow.contentView.removeChildView(tab.view);
  tab.attached = false;
}

function detachAllBrowserTabs() {
  for (let i = 0; i < browserTabs.length; i++) {
    detachBrowserTab(browserTabs[i]);
  }
}

function focusBrowserTab(tab: BrowserTab | null | undefined) {
  if (!tab || !browserBounds.visible || !currentMainWindow()) return;

  setImmediate(function () {
    const mainWindow = currentMainWindow();
    if (!mainWindow) return;
    if (!browserBounds.visible || activeBrowserTabId !== tab.id || !tab.attached) return;
    if (tab.view.webContents.isDestroyed()) return;

    mainWindow.focus();
    tab.view.webContents.focus();
  });
}

function attachActiveBrowserTab() {
  let activeTab: BrowserTab | null = null;
  let bounds: BrowserBoundsState | null = null;
  const mainWindow = currentMainWindow();

  try {
    activeTab = getBrowserTab();
  } catch (error) {
    return;
  }

  for (let i = 0; i < browserTabs.length; i++) {
    if (browserTabs[i] !== activeTab) detachBrowserTab(browserTabs[i]);
  }

  if (!browserBounds.visible || !mainWindow) return;

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
  const mainWindow = currentMainWindow();

  // HTML fullscreen expands only within WebContentsView bounds, so stretch the view over the app chrome.
  if (browserHtmlFullScreenTabId === tab.id && mainWindow) {
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
  if (!tab || !currentMainWindow()) return;

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
  rejectPreloadRequestsForWebContents(tab.view.webContents.id, t('errors.tabNotFound'));
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
    createBrowserTab({ url: homeUrl, active: true });
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
  targetUrl = normalizeNavigationUrl(targetUrl);
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
  const targetUrl = normalizeNavigationUrl(normalizedPayload.url);

  if (!targetUrl) return tab.view.webContents.getURL();
  if (tab.locked) throw new Error(t('errors.lockedNavigate'));

  tab.controlledLoad = true;

  try {
    let wait = waitForBrowserStop(tab);
    loadTabUrl(tab, targetUrl, Boolean(normalizedPayload.forceReload));
    let loadedUrl = await wait;
    const fallbackUrl = fallbackUrlForLoadFailure(tab.lastMainFrameLoadFailure);

    if (fallbackUrl) {
      activateFallbackOrigin();
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

function activateRelativeBrowserTab(offset: number): BrowserTabsState {
  const tabId = nextActiveTabIdByOffset(browserTabs, activeBrowserTabId, offset);
  if (!tabId || tabId === activeBrowserTabId) return browserTabsState();
  return activateBrowserTab(tabId);
}

function sendToAllTabs(channel: string, payload: unknown) {
  for (let i = 0; i < browserTabs.length; i++) {
    const webContents = browserTabs[i].view.webContents;
    if (!webContents.isDestroyed()) webContents.send(channel, payload);
  }
}

function canCreateBrowserTab(): boolean {
  return browserTabs.length < getMaxBrowserTabs();
}

function getBrowserTabUrl(tabId?: string | null): string {
  return getBrowserTab(tabId).view.webContents.getURL();
}

export function createBrowserTabManager(context: BrowserTabManagerContext): BrowserTabManager {
  activateFallbackOrigin = context.activateFallbackOrigin;
  fallbackUrlForLoadFailure = context.fallbackUrlForLoadFailure;
  forwardBrowserMessage = context.forwardBrowserMessage;
  getMainWindow = context.getMainWindow;
  getMaxBrowserTabs = context.getMaxBrowserTabs;
  homeUrl = context.homeUrl;
  normalizeNavigationUrl = context.normalizeNavigationUrl;
  registerShortcuts = context.registerShortcuts;
  rejectPreloadRequestsForWebContents = context.rejectPreloadRequestsForWebContents;
  sessionPartition = context.sessionPartition;
  shouldActivateWindowOpen = context.shouldActivateWindowOpen;
  shouldDenyWebViewEnhancementNavigation = context.shouldDenyWebViewEnhancementNavigation;
  showBrowserContextMenu = context.showBrowserContextMenu;
  translate = context.t;
  WebContentsView = context.WebContentsView;
  webviewPreloadPath = context.webviewPreloadPath;

  return {
    activeTabId: function () {
      return activeBrowserTabId;
    },
    activateRelativeTab: activateRelativeBrowserTab,
    activateTab: activateBrowserTab,
    canCreateTab: canCreateBrowserTab,
    closeTab: closeBrowserTab,
    createTab: createBrowserTab,
    detachAllTabs: detachAllBrowserTabs,
    getTab: getBrowserTab,
    getTabByWebContents: getBrowserTabByWebContents,
    getUrl: getBrowserTabUrl,
    goBack: goBrowserBack,
    goForward: goBrowserForward,
    listTabs: browserTabsState,
    navigate: navigateBrowser,
    navigationState: browserNavigationState,
    notifyChanged: notifyBrowserTabsChanged,
    reload: reloadBrowser,
    safeCreateTab: safeCreateBrowserTab,
    scheduleHtmlFullScreenResize: scheduleBrowserHtmlFullScreenResize,
    sendToAllTabs: sendToAllTabs,
    setBounds: setBrowserBounds,
    setTabLocked: setBrowserTabLocked,
    setTabMuted: setBrowserTabMuted,
    syncTabMediaState: syncBrowserTabMediaState,
    tabCount: function () {
      return browserTabs.length;
    }
  };
}
