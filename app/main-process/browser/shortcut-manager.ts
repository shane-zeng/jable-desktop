'use strict';

import type * as Electron from 'electron';
import type { AppView, BrowserNavigationState, BrowserTabsState, CreateBrowserTabPayload } from '../../types/jable';

type BrowserTabShortcutInput = Electron.Input & {
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
};
type BrowserReloadOptions = { ignoreCache?: boolean };
type BrowserTabPolicyModule = {
  browserTabReloadShortcut(
    input: BrowserTabShortcutInput | null | undefined,
    isMacos: boolean
  ): 'normal' | 'hard' | null;
  browserTabShortcutOffset(input: BrowserTabShortcutInput | null | undefined, isMacos: boolean): number;
};

export type BrowserShortcutManagerContext = {
  activateRelativeBrowserTab(offset: number): BrowserTabsState;
  closeBrowserTab(tabId: string | null): BrowserTabsState;
  createBrowserTab(options?: CreateBrowserTabPayload | null): BrowserTabsState;
  createWindow(): void;
  forwardBrowserMessage(channel: string, payload: unknown): void;
  getMainWindow(): Electron.BrowserWindow | null;
  homeUrl: string;
  isMacos: boolean;
  reloadBrowser(tabId?: string | null, options?: BrowserReloadOptions | null): Promise<BrowserNavigationState>;
};

export type BrowserShortcutManager = {
  activateRelativeBrowserTabFromShortcut(offset: number): void;
  closeActiveTabFromShortcut(): void;
  openHomeTabFromShortcut(): void;
  registerAppShortcuts(webContents: Electron.WebContents): void;
  reloadActiveTabFromShortcut(ignoreCache?: boolean): void;
  toggleCompactTabsFromShortcut(): void;
  toggleDownloadSidebarFromShortcut(): void;
  toggleSharedTabsFromShortcut(): void;
};

const browserTabPolicy = require('../../browser/browser-tab-policy') as BrowserTabPolicyModule;
const browserTabReloadShortcut = browserTabPolicy.browserTabReloadShortcut;
const browserTabShortcutOffset = browserTabPolicy.browserTabShortcutOffset;

let activateRelativeBrowserTab: (offset: number) => BrowserTabsState;
let closeBrowserTab: (tabId: string | null) => BrowserTabsState;
let createBrowserTab: (options?: CreateBrowserTabPayload | null) => BrowserTabsState;
let createWindow: () => void;
let forwardBrowserMessage: (channel: string, payload: unknown) => void;
let getMainWindow: () => Electron.BrowserWindow | null;
let homeUrl = '';
let isMacos = false;
let lastShortcutAction = { name: '', at: 0 };
let reloadBrowser: (tabId?: string | null, options?: BrowserReloadOptions | null) => Promise<BrowserNavigationState>;

function mainErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentMainWindow(): Electron.BrowserWindow | null {
  const mainWindow = getMainWindow();
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function isPrimaryShortcut(
  input: BrowserTabShortcutInput | null | undefined,
  key: string,
  code?: string,
  options?: { shift?: boolean }
) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return false;
  const inputKey = String(input.key || '').toLowerCase();
  const inputCode = String(input.code || '').toLowerCase();
  if (inputKey !== key && (!code || inputCode !== code)) return false;
  if (input.alt || Boolean(input.shift) !== Boolean(options && options.shift)) return false;

  if (isMacos) return Boolean(input.meta) && !input.control;
  return Boolean(input.control) && !input.meta;
}

function appViewShortcut(input: BrowserTabShortcutInput | null | undefined): AppView | null {
  if (isPrimaryShortcut(input, '1', 'digit1')) return 'browser';
  if (isPrimaryShortcut(input, '2', 'digit2')) return 'library';
  if (isPrimaryShortcut(input, '3', 'digit3')) return 'settings';
  return null;
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

function isToggleSharedTabsShortcut(input: BrowserTabShortcutInput | null | undefined) {
  return isPrimaryShortcut(input, 's', undefined, { shift: true });
}

function isToggleDownloadSidebarShortcut(input: BrowserTabShortcutInput | null | undefined) {
  return isPrimaryShortcut(input, 'd', undefined, { shift: true });
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
      if (!currentMainWindow()) {
        createWindow();
        return;
      }

      createBrowserTab({ url: homeUrl, active: true });
      forwardBrowserMessage('browser-tab-shortcut', {});
    } catch (error) {
      forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
    }
  });
}

function closeActiveTabFromShortcut() {
  runShortcutAction('close-tab', function () {
    if (!currentMainWindow()) return;

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
    if (!currentMainWindow()) return;

    try {
      activateRelativeBrowserTab(offset);
      forwardBrowserMessage('browser-tab-shortcut', {});
    } catch (error) {
      forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
    }
  });
}

function reloadActiveTabFromShortcut(ignoreCache?: boolean) {
  runShortcutAction('reload-tab', function () {
    if (!currentMainWindow()) return;

    void reloadBrowser(null, { ignoreCache: Boolean(ignoreCache) })
      .then(function () {
        forwardBrowserMessage('browser-tab-shortcut', {});
      })
      .catch(function (error) {
        forwardBrowserMessage('browser-error', { message: mainErrorMessage(error) });
      });
  });
}

function toggleCompactTabsFromShortcut() {
  runShortcutAction('toggle-compact-tabs', function () {
    forwardBrowserMessage('browser-tabs-compact-toggle-shortcut', {});
  });
}

function toggleSharedTabsFromShortcut() {
  runShortcutAction('toggle-shared-tabs', function () {
    forwardBrowserMessage('browser-tabs-shared-toggle-shortcut', {});
  });
}

function toggleDownloadSidebarFromShortcut() {
  runShortcutAction('toggle-download-sidebar', function () {
    forwardBrowserMessage('browser-download-sidebar-toggle-shortcut', {});
  });
}

function switchAppViewFromShortcut(view: AppView) {
  runShortcutAction('app-view-' + view, function () {
    if (!currentMainWindow()) return;

    forwardBrowserMessage('app-view-shortcut', { view: view });
  });
}

function registerAppShortcuts(webContents: Electron.WebContents) {
  webContents.on('before-input-event', function (event, input) {
    const shortcutView = appViewShortcut(input);
    if (shortcutView) {
      event.preventDefault();
      switchAppViewFromShortcut(shortcutView);
      return;
    }

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

    const reloadShortcut = browserTabReloadShortcut(input, isMacos);
    if (reloadShortcut) {
      event.preventDefault();
      reloadActiveTabFromShortcut(reloadShortcut === 'hard');
      return;
    }

    const tabSwitchOffset = browserTabShortcutOffset(input, isMacos);
    if (tabSwitchOffset) {
      event.preventDefault();
      activateRelativeBrowserTabFromShortcut(tabSwitchOffset);
      return;
    }

    if (isToggleCompactTabsShortcut(input)) {
      event.preventDefault();
      toggleCompactTabsFromShortcut();
      return;
    }

    if (isToggleSharedTabsShortcut(input)) {
      event.preventDefault();
      toggleSharedTabsFromShortcut();
      return;
    }

    if (isToggleDownloadSidebarShortcut(input)) {
      event.preventDefault();
      toggleDownloadSidebarFromShortcut();
    }
  });
}

export function createBrowserShortcutManager(context: BrowserShortcutManagerContext): BrowserShortcutManager {
  activateRelativeBrowserTab = context.activateRelativeBrowserTab;
  closeBrowserTab = context.closeBrowserTab;
  createBrowserTab = context.createBrowserTab;
  createWindow = context.createWindow;
  forwardBrowserMessage = context.forwardBrowserMessage;
  getMainWindow = context.getMainWindow;
  homeUrl = context.homeUrl;
  isMacos = context.isMacos;
  reloadBrowser = context.reloadBrowser;

  return {
    activateRelativeBrowserTabFromShortcut: activateRelativeBrowserTabFromShortcut,
    closeActiveTabFromShortcut: closeActiveTabFromShortcut,
    openHomeTabFromShortcut: openHomeTabFromShortcut,
    registerAppShortcuts: registerAppShortcuts,
    reloadActiveTabFromShortcut: reloadActiveTabFromShortcut,
    toggleCompactTabsFromShortcut: toggleCompactTabsFromShortcut,
    toggleDownloadSidebarFromShortcut: toggleDownloadSidebarFromShortcut,
    toggleSharedTabsFromShortcut: toggleSharedTabsFromShortcut
  };
}
