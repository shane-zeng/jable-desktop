'use strict';

import type { AppSettings, BrowserTabsState, CreateBrowserTabPayload } from '../../types/jable';
import type { BrowserTabManager } from './tab-manager';
import type { BrowserSessionStore as BrowserSessionStoreType } from './session-store';

type BrowserSessionStoreModule = {
  BrowserSessionStore: new (filePath: string) => BrowserSessionStoreType;
  browserSessionFilePath(userDataPath: string): string;
};

export type BrowserSessionControllerContext = {
  createBrowserTab(options?: CreateBrowserTabPayload | null): BrowserTabsState;
  getBrowserTabManager(): BrowserTabManager;
  getBrowserTabManagerIfCreated(): BrowserTabManager | null;
  getSettings(): AppSettings;
  homeUrl: string;
  logger?: { error(message?: unknown, ...optionalParams: unknown[]): void } | null;
  normalizeUrl(value: unknown): string;
  saveDelayMs: number;
  userDataPath(): string;
};

export type BrowserSessionController = {
  clear(): void;
  clearSaveTimer(): void;
  flush(): void;
  restoreInitialTabs(): void;
  saveNow(): void;
  scheduleSave(): void;
};

const browserSessionStoreModule = require('./session-store') as BrowserSessionStoreModule;

export function createBrowserSessionController(context: BrowserSessionControllerContext): BrowserSessionController {
  let browserSessionStore: BrowserSessionStoreType | null = null;
  let browserSessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let browserSessionRestoreInProgress = false;

  function logError(error: unknown) {
    if (context.logger) context.logger.error(error);
  }

  function getBrowserSessionStore() {
    if (!browserSessionStore) {
      browserSessionStore = new browserSessionStoreModule.BrowserSessionStore(
        browserSessionStoreModule.browserSessionFilePath(context.userDataPath())
      );
    }

    return browserSessionStore;
  }

  function clearSaveTimer() {
    if (!browserSessionSaveTimer) return;
    clearTimeout(browserSessionSaveTimer);
    browserSessionSaveTimer = null;
  }

  function saveNow() {
    const browserTabManager = context.getBrowserTabManagerIfCreated();

    clearSaveTimer();

    if (!browserTabManager || browserSessionRestoreInProgress || !context.getSettings().restoreBrowserTabsOnStartup) {
      return;
    }

    const snapshot = browserTabManager.sessionSnapshot();
    if (!snapshot.tabs.length) {
      getBrowserSessionStore().clear();
      return;
    }

    getBrowserSessionStore().write(snapshot);
  }

  function scheduleSave() {
    if (
      !context.getBrowserTabManagerIfCreated() ||
      browserSessionRestoreInProgress ||
      !context.getSettings().restoreBrowserTabsOnStartup
    ) {
      return;
    }

    clearSaveTimer();
    browserSessionSaveTimer = setTimeout(function () {
      try {
        saveNow();
      } catch (error) {
        logError(error);
      }
    }, context.saveDelayMs);
  }

  function clear() {
    clearSaveTimer();
    getBrowserSessionStore().clear();
  }

  function flush() {
    clearSaveTimer();

    try {
      if (!context.getSettings().restoreBrowserTabsOnStartup) {
        getBrowserSessionStore().clear();
        return;
      }

      const browserTabManager = context.getBrowserTabManagerIfCreated();
      if (browserTabManager && browserTabManager.tabCount() > 0) saveNow();
    } catch (error) {
      logError(error);
    }
  }

  function createHomeTab() {
    context.createBrowserTab({ url: context.homeUrl, active: true });
  }

  function restoreInitialTabs() {
    const settings = context.getSettings();

    if (!settings.restoreBrowserTabsOnStartup) {
      createHomeTab();
      return;
    }

    const snapshot = getBrowserSessionStore().readForRestore({
      maxTabs: settings.maxBrowserTabs,
      normalizeUrl: context.normalizeUrl
    });

    if (!snapshot) {
      createHomeTab();
      return;
    }

    browserSessionRestoreInProgress = true;

    try {
      for (let i = 0; i < snapshot.tabs.length; i++) {
        context.createBrowserTab({
          url: snapshot.tabs[i].url,
          active: true,
          locked: snapshot.tabs[i].locked,
          muted: snapshot.tabs[i].muted
        });
      }

      const browserTabManager = context.getBrowserTabManager();
      const state = browserTabManager.listTabs();
      const activeTab = state.tabs[snapshot.activeTabIndex] || state.tabs[0];
      if (activeTab) browserTabManager.activateTab(activeTab.id);
    } catch (error) {
      logError(error);
      if (context.getBrowserTabManager().tabCount() === 0) createHomeTab();
    } finally {
      browserSessionRestoreInProgress = false;
      scheduleSave();
    }
  }

  return {
    clear: clear,
    clearSaveTimer: clearSaveTimer,
    flush: flush,
    restoreInitialTabs: restoreInitialTabs,
    saveNow: saveNow,
    scheduleSave: scheduleSave
  };
}
