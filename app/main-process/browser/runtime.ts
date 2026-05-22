'use strict';

import type * as Electron from 'electron';
import type {
  AppSettings,
  BrowserBounds,
  BrowserNavigatePayload,
  BrowserNavigationState,
  BrowserTabLockedPayload,
  BrowserTabMutedPayload,
  BrowserTabsState,
  CreateBrowserTabPayload
} from '../../types/jable';
import type {
  BrowserLoadFailure,
  BrowserReloadOptions,
  BrowserTab,
  BrowserTabManager,
  BrowserTabManagerContext
} from './tab-manager';
import type { BrowserPreloadRequestManager, BrowserPreloadRequestManagerContext } from './preload-requests';
import type { BrowserSessionController, BrowserSessionControllerContext } from './session-controller';
import type { BrowserShortcutManager, BrowserShortcutManagerContext } from './shortcut-manager';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;

type BrowserTheaterModeResult = {
  enabled: boolean;
  applied: boolean;
  videoUrl: string | null;
};

export type BrowserRuntimeControllerContext = {
  activateFallbackOrigin(): void;
  createWindow(): void;
  fallbackUrlForLoadFailure(failure: BrowserLoadFailure | null | undefined): string | null;
  forwardBrowserMessage(channel: string, payload: unknown): void;
  getMainWindow(): Electron.BrowserWindow | null;
  getMaxBrowserTabs(): number;
  getSettings(): AppSettings;
  homeUrl: string;
  isMacos: boolean;
  logger?: { error(message?: unknown, ...optionalParams: unknown[]): void } | null;
  mainErrorMessage(error: unknown): string;
  normalizeNavigationUrl(value: unknown): string;
  saveDelayMs: number;
  sessionPartition: string;
  shouldDenyWebViewEnhancementNavigation(url: unknown): boolean;
  showBrowserContextMenu(tab: BrowserTab, params: Electron.ContextMenuParams): void;
  t(key: string, params?: TranslationParams | null): string;
  theaterModeRequestTimeoutMs: number;
  userDataPath(): string;
  WebContentsView: typeof Electron.WebContentsView;
  webviewPreloadPath: string;
  wireWebContentsDiagnostics?(webContents: Electron.WebContents, details: () => Record<string, unknown>): void;
};

export type BrowserRuntimeController = {
  activateTab(tabId: string | null): BrowserTabsState;
  activeTabId(): string | null;
  canCreateTab(): boolean;
  clearSession(): void;
  closeActiveTabFromShortcut(): void;
  closeAllTabs(): void;
  closeTab(tabId: string | null): BrowserTabsState;
  createInitialTabs(): void;
  createTab(options?: CreateBrowserTabPayload | null): BrowserTabsState;
  flushSession(): void;
  getTab(tabId?: string | null): BrowserTab;
  getTabByWebContents(webContents: Electron.WebContents | null | undefined): BrowserTab | null;
  goBack(tabId?: string | null): Promise<BrowserNavigationState>;
  goForward(tabId?: string | null): Promise<BrowserNavigationState>;
  listTabs(): BrowserTabsState;
  navigate(payload?: BrowserNavigatePayload | null): Promise<string>;
  navigationState(tabId?: string | null): BrowserNavigationState;
  notifyChanged(): void;
  openHomeTabFromShortcut(): void;
  registerAppShortcuts(webContents: Electron.WebContents): void;
  rejectPreloadRequestsForWebContents(webContentsId: number, message: string): void;
  reload(tabId?: string | null, options?: BrowserReloadOptions | null): Promise<BrowserNavigationState>;
  requestBrowserPreload<T>(
    tab: BrowserTab,
    channel: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T>;
  requestWebContentsPreload<T>(
    webContents: Electron.WebContents,
    channel: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T>;
  resolvePreloadResponse(event: Electron.IpcMainEvent, payload: unknown): void;
  safeCreateTab(options?: CreateBrowserTabPayload | null): BrowserTabsState;
  saveSessionNow(): void;
  scheduleHtmlFullScreenResize(): void;
  sendToAllTabs(channel: string, payload: unknown): void;
  setBounds(bounds: BrowserBounds | null | undefined): BrowserBounds | null;
  setTabLocked(payload?: BrowserTabLockedPayload | null): BrowserTabsState;
  setTabMuted(payload?: BrowserTabMutedPayload | null): BrowserTabsState;
  setTabTheaterMode(tab: BrowserTab, enabled: boolean): Promise<BrowserTheaterModeResult>;
  syncTabMediaState(tab: BrowserTab | null | undefined): void;
  syncTheaterModeFromEvent(event: Electron.IpcMainEvent, payload: unknown): void;
};

const browserPreloadRequestModule = require('./preload-requests') as {
  createBrowserPreloadRequestManager(context: BrowserPreloadRequestManagerContext): BrowserPreloadRequestManager;
};
const browserSessionControllerModule = require('./session-controller') as {
  createBrowserSessionController(context: BrowserSessionControllerContext): BrowserSessionController;
};
const browserShortcutManagerModule = require('./shortcut-manager') as {
  createBrowserShortcutManager(context: BrowserShortcutManagerContext): BrowserShortcutManager;
};
const browserTabManagerModule = require('./tab-manager') as {
  createBrowserTabManager(context: BrowserTabManagerContext): BrowserTabManager;
};

export function createBrowserRuntimeController(context: BrowserRuntimeControllerContext): BrowserRuntimeController {
  let browserPreloadRequestManager: BrowserPreloadRequestManager | null = null;
  let browserSessionController: BrowserSessionController | null = null;
  let browserShortcutManager: BrowserShortcutManager | null = null;
  let browserTabManager: BrowserTabManager | null = null;

  function shouldActivateWindowOpen(details: Electron.HandlerDetails | null | undefined) {
    return !details || details.disposition !== 'background-tab';
  }

  function getBrowserPreloadRequestManager(): BrowserPreloadRequestManager {
    if (!browserPreloadRequestManager) {
      browserPreloadRequestManager = browserPreloadRequestModule.createBrowserPreloadRequestManager({
        mainErrorMessage: context.mainErrorMessage,
        tabNotFoundError: function () {
          return new Error(context.t('errors.tabNotFound'));
        }
      });
    }

    return browserPreloadRequestManager;
  }

  function getBrowserSessionController(): BrowserSessionController {
    if (!browserSessionController) {
      browserSessionController = browserSessionControllerModule.createBrowserSessionController({
        createBrowserTab: createTab,
        getBrowserTabManager: getBrowserTabManager,
        getBrowserTabManagerIfCreated: function () {
          return browserTabManager;
        },
        getSettings: context.getSettings,
        homeUrl: context.homeUrl,
        logger: context.logger,
        normalizeUrl: context.normalizeNavigationUrl,
        saveDelayMs: context.saveDelayMs,
        userDataPath: context.userDataPath
      });
    }

    return browserSessionController;
  }

  function saveSessionNow() {
    getBrowserSessionController().saveNow();
  }

  function scheduleBrowserSessionSave() {
    getBrowserSessionController().scheduleSave();
  }

  function flushSession() {
    getBrowserSessionController().flush();
  }

  function clearSession() {
    getBrowserSessionController().clear();
  }

  function getBrowserShortcutManager(): BrowserShortcutManager {
    if (!browserShortcutManager) {
      browserShortcutManager = browserShortcutManagerModule.createBrowserShortcutManager({
        activateRelativeBrowserTab: function (offset) {
          return getBrowserTabManager().activateRelativeTab(offset);
        },
        closeBrowserTab: closeTab,
        createBrowserTab: createTab,
        createWindow: context.createWindow,
        forwardBrowserMessage: context.forwardBrowserMessage,
        getMainWindow: context.getMainWindow,
        homeUrl: context.homeUrl,
        isMacos: context.isMacos,
        reloadBrowser: reload
      });
    }

    return browserShortcutManager;
  }

  function registerAppShortcuts(webContents: Electron.WebContents) {
    getBrowserShortcutManager().registerAppShortcuts(webContents);
  }

  function openHomeTabFromShortcut() {
    getBrowserShortcutManager().openHomeTabFromShortcut();
  }

  function closeActiveTabFromShortcut() {
    getBrowserShortcutManager().closeActiveTabFromShortcut();
  }

  function getBrowserTabManager(): BrowserTabManager {
    if (!browserTabManager) {
      browserTabManager = browserTabManagerModule.createBrowserTabManager({
        activateFallbackOrigin: context.activateFallbackOrigin,
        fallbackUrlForLoadFailure: context.fallbackUrlForLoadFailure,
        forwardBrowserMessage: context.forwardBrowserMessage,
        getMainWindow: context.getMainWindow,
        getMaxBrowserTabs: context.getMaxBrowserTabs,
        homeUrl: context.homeUrl,
        normalizeNavigationUrl: context.normalizeNavigationUrl,
        onBrowserTabsChanged: scheduleBrowserSessionSave,
        registerShortcuts: registerAppShortcuts,
        rejectPreloadRequestsForWebContents: rejectPreloadRequestsForWebContents,
        sessionPartition: context.sessionPartition,
        shouldActivateWindowOpen: shouldActivateWindowOpen,
        shouldDenyWebViewEnhancementNavigation: context.shouldDenyWebViewEnhancementNavigation,
        showBrowserContextMenu: context.showBrowserContextMenu,
        t: context.t,
        WebContentsView: context.WebContentsView,
        webviewPreloadPath: context.webviewPreloadPath,
        wireWebContentsDiagnostics: context.wireWebContentsDiagnostics
      });
    }

    return browserTabManager;
  }

  function createInitialTabs() {
    getBrowserSessionController().restoreInitialTabs();
  }

  function createTab(options?: CreateBrowserTabPayload | null): BrowserTabsState {
    return getBrowserTabManager().createTab(options);
  }

  function getTab(tabId?: string | null): BrowserTab {
    return getBrowserTabManager().getTab(tabId);
  }

  function getTabByWebContents(webContents: Electron.WebContents | null | undefined): BrowserTab | null {
    return getBrowserTabManager().getTabByWebContents(webContents);
  }

  function listTabs(): BrowserTabsState {
    return getBrowserTabManager().listTabs();
  }

  function notifyChanged() {
    getBrowserTabManager().notifyChanged();
  }

  function navigationState(tabId?: string | null): BrowserNavigationState {
    return getBrowserTabManager().navigationState(tabId);
  }

  function scheduleHtmlFullScreenResize() {
    getBrowserTabManager().scheduleHtmlFullScreenResize();
  }

  function setBounds(bounds: BrowserBounds | null | undefined): BrowserBounds | null {
    return getBrowserTabManager().setBounds(bounds);
  }

  function activateTab(tabId: string | null): BrowserTabsState {
    return getBrowserTabManager().activateTab(tabId);
  }

  function closeTab(tabId: string | null): BrowserTabsState {
    return getBrowserTabManager().closeTab(tabId);
  }

  function setTabLocked(payload?: BrowserTabLockedPayload | null): BrowserTabsState {
    return getBrowserTabManager().setTabLocked(payload);
  }

  function setTabMuted(payload?: BrowserTabMutedPayload | null): BrowserTabsState {
    return getBrowserTabManager().setTabMuted(payload);
  }

  function navigate(payload?: BrowserNavigatePayload | null): Promise<string> {
    return getBrowserTabManager().navigate(payload);
  }

  function reload(tabId?: string | null, options?: BrowserReloadOptions | null): Promise<BrowserNavigationState> {
    return getBrowserTabManager().reload(tabId, options);
  }

  function goBack(tabId?: string | null): Promise<BrowserNavigationState> {
    return getBrowserTabManager().goBack(tabId);
  }

  function goForward(tabId?: string | null): Promise<BrowserNavigationState> {
    return getBrowserTabManager().goForward(tabId);
  }

  function safeCreateTab(options?: CreateBrowserTabPayload | null): BrowserTabsState {
    return getBrowserTabManager().safeCreateTab(options);
  }

  function syncTabMediaState(tab: BrowserTab | null | undefined) {
    getBrowserTabManager().syncTabMediaState(tab);
  }

  function canCreateTab(): boolean {
    return getBrowserTabManager().canCreateTab();
  }

  function activeTabId(): string | null {
    return getBrowserTabManager().activeTabId();
  }

  function sendToAllTabs(channel: string, payload: unknown) {
    if (browserTabManager) browserTabManager.sendToAllTabs(channel, payload);
  }

  function closeAllTabs() {
    if (browserTabManager) browserTabManager.closeAllTabs();
  }

  function normalizeBrowserTheaterModeResult(value: unknown, fallbackEnabled: boolean): BrowserTheaterModeResult {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    return {
      enabled: typeof record.enabled === 'boolean' ? record.enabled : fallbackEnabled,
      applied: Boolean(record.applied),
      videoUrl: typeof record.videoUrl === 'string' && record.videoUrl ? record.videoUrl : null
    };
  }

  function browserTheaterModePayload(enabled: boolean): { enabled: boolean; exitLabel: string } {
    return {
      enabled: enabled,
      exitLabel: context.t('context.exitTheaterMode')
    };
  }

  async function setTabTheaterMode(tab: BrowserTab, enabled: boolean): Promise<BrowserTheaterModeResult> {
    const result = normalizeBrowserTheaterModeResult(
      await requestBrowserPreload<BrowserTheaterModeResult>(
        tab,
        'browser:set-theater-mode-request',
        browserTheaterModePayload(enabled),
        context.theaterModeRequestTimeoutMs
      ),
      enabled
    );

    tab.theaterMode = result.enabled;
    return result;
  }

  function syncTheaterModeFromEvent(event: Electron.IpcMainEvent, payload: unknown) {
    const tab = getTabByWebContents(event.sender);
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

    if (!tab || typeof record.enabled !== 'boolean') return;
    tab.theaterMode = record.enabled;
  }

  function rejectPreloadRequestsForWebContents(webContentsId: number, message: string) {
    getBrowserPreloadRequestManager().rejectForWebContents(webContentsId, message);
  }

  function resolvePreloadResponse(event: Electron.IpcMainEvent, payload: unknown) {
    getBrowserPreloadRequestManager().resolveResponse(event, payload);
  }

  function requestWebContentsPreload<T>(
    webContents: Electron.WebContents,
    channel: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T> {
    return getBrowserPreloadRequestManager().requestWebContents<T>(webContents, channel, payload, timeoutMs);
  }

  function requestBrowserPreload<T>(
    tab: BrowserTab,
    channel: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T> {
    return getBrowserPreloadRequestManager().requestBrowser<T>(tab, channel, payload, timeoutMs);
  }

  return {
    activateTab: activateTab,
    activeTabId: activeTabId,
    canCreateTab: canCreateTab,
    clearSession: clearSession,
    closeActiveTabFromShortcut: closeActiveTabFromShortcut,
    closeAllTabs: closeAllTabs,
    closeTab: closeTab,
    createInitialTabs: createInitialTabs,
    createTab: createTab,
    flushSession: flushSession,
    getTab: getTab,
    getTabByWebContents: getTabByWebContents,
    goBack: goBack,
    goForward: goForward,
    listTabs: listTabs,
    navigate: navigate,
    navigationState: navigationState,
    notifyChanged: notifyChanged,
    openHomeTabFromShortcut: openHomeTabFromShortcut,
    registerAppShortcuts: registerAppShortcuts,
    rejectPreloadRequestsForWebContents: rejectPreloadRequestsForWebContents,
    reload: reload,
    requestBrowserPreload: requestBrowserPreload,
    requestWebContentsPreload: requestWebContentsPreload,
    resolvePreloadResponse: resolvePreloadResponse,
    safeCreateTab: safeCreateTab,
    saveSessionNow: saveSessionNow,
    scheduleHtmlFullScreenResize: scheduleHtmlFullScreenResize,
    sendToAllTabs: sendToAllTabs,
    setBounds: setBounds,
    setTabLocked: setTabLocked,
    setTabMuted: setTabMuted,
    setTabTheaterMode: setTabTheaterMode,
    syncTabMediaState: syncTabMediaState,
    syncTheaterModeFromEvent: syncTheaterModeFromEvent
  };
}
