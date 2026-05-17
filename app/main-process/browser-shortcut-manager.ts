'use strict';

import type * as Electron from 'electron';
import type { BrowserTabsState, CreateBrowserTabPayload } from '../types/jable';

type BrowserTabShortcutInput = Electron.Input & {
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
};
type BrowserTabPolicyModule = {
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
};

export type BrowserShortcutManager = {
  activateRelativeBrowserTabFromShortcut(offset: number): void;
  closeActiveTabFromShortcut(): void;
  openHomeTabFromShortcut(): void;
  registerAppShortcuts(webContents: Electron.WebContents): void;
  toggleCompactTabsFromShortcut(): void;
};

const browserTabPolicy = require('../browser/browser-tab-policy') as BrowserTabPolicyModule;
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

function mainErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentMainWindow(): Electron.BrowserWindow | null {
  const mainWindow = getMainWindow();
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function isPrimaryShortcut(input: BrowserTabShortcutInput | null | undefined, key: string) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return false;
  if (String(input.key || '').toLowerCase() !== key) return false;
  if (input.alt || input.shift) return false;

  if (isMacos) return Boolean(input.meta) && !input.control;
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

    const tabSwitchOffset = browserTabShortcutOffset(input, isMacos);
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

export function createBrowserShortcutManager(context: BrowserShortcutManagerContext): BrowserShortcutManager {
  activateRelativeBrowserTab = context.activateRelativeBrowserTab;
  closeBrowserTab = context.closeBrowserTab;
  createBrowserTab = context.createBrowserTab;
  createWindow = context.createWindow;
  forwardBrowserMessage = context.forwardBrowserMessage;
  getMainWindow = context.getMainWindow;
  homeUrl = context.homeUrl;
  isMacos = context.isMacos;

  return {
    activateRelativeBrowserTabFromShortcut: activateRelativeBrowserTabFromShortcut,
    closeActiveTabFromShortcut: closeActiveTabFromShortcut,
    openHomeTabFromShortcut: openHomeTabFromShortcut,
    registerAppShortcuts: registerAppShortcuts,
    toggleCompactTabsFromShortcut: toggleCompactTabsFromShortcut
  };
}
