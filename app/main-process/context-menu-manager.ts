'use strict';

import type * as Electron from 'electron';
import type { BrowserTab } from './browser-tab-manager';
import type {
  BrowserNavigationState,
  BrowserTabMenuPayload,
  BrowserTabMutedPayload,
  BrowserTabsState,
  CreateBrowserTabPayload,
  LibraryVideoMenuPayload
} from '../types/jable';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type ClipboardWriter = { writeText(text: string): void };
type PopupOptions = Parameters<Electron.Menu['popup']>[0];

export type ContextMenuManagerContext = {
  activateBrowserTab(tabId: string | null): BrowserTabsState;
  canCreateBrowserTab(): boolean;
  clipboard: ClipboardWriter;
  closeBrowserTab(tabId: string | null): BrowserTabsState;
  forwardBrowserMessage(channel: string, payload: unknown): void;
  getActiveBrowserTabId(): string | null;
  getBrowserTab(tabId?: string | null): BrowserTab;
  getMainWindow(): Electron.BrowserWindow | null;
  goBrowserBack(tabId?: string | null): Promise<BrowserNavigationState>;
  goBrowserForward(tabId?: string | null): Promise<BrowserNavigationState>;
  homeUrl: string;
  Menu: typeof Electron.Menu;
  reloadBrowser(tabId?: string | null): Promise<BrowserNavigationState>;
  safeCreateBrowserTab(options?: CreateBrowserTabPayload | null): BrowserTabsState;
  setBrowserTabMuted(payload?: BrowserTabMutedPayload | null): BrowserTabsState;
  syncBrowserTabMediaState(tab: BrowserTab | null | undefined): void;
  t(key: string, params?: TranslationParams | null): string;
};

export type ContextMenuManager = {
  showBrowserContextMenu(tab: BrowserTab, params: Electron.ContextMenuParams): void;
  showBrowserTabMenu(payload?: BrowserTabMenuPayload | null): { shown: boolean };
  showLibraryVideoMenu(payload?: LibraryVideoMenuPayload | null): { shown: boolean };
};

let activateBrowserTab: (tabId: string | null) => BrowserTabsState;
let canCreateBrowserTab: () => boolean;
let clipboard: ClipboardWriter;
let closeBrowserTab: (tabId: string | null) => BrowserTabsState;
let forwardBrowserMessage: (channel: string, payload: unknown) => void;
let getActiveBrowserTabId: () => string | null;
let getBrowserTab: (tabId?: string | null) => BrowserTab;
let getMainWindow: () => Electron.BrowserWindow | null;
let goBrowserBack: (tabId?: string | null) => Promise<BrowserNavigationState>;
let goBrowserForward: (tabId?: string | null) => Promise<BrowserNavigationState>;
let homeUrl = '';
let Menu: typeof Electron.Menu;
let reloadBrowser: (tabId?: string | null) => Promise<BrowserNavigationState>;
let safeCreateBrowserTab: (options?: CreateBrowserTabPayload | null) => BrowserTabsState;
let setBrowserTabMuted: (payload?: BrowserTabMutedPayload | null) => BrowserTabsState;
let syncBrowserTabMediaState: (tab: BrowserTab | null | undefined) => void;
let translate: (key: string, params?: TranslationParams | null) => string;

function t(key: string, params?: TranslationParams | null): string {
  return translate(key, params);
}

function currentMainWindow(): Electron.BrowserWindow | null {
  const mainWindow = getMainWindow();
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function copyText(value: unknown) {
  if (!value) return;
  clipboard.writeText(String(value));
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

function showEditableContextMenu(tab: BrowserTab, params: Electron.ContextMenuParams) {
  const mainWindow = currentMainWindow();
  if (!mainWindow) return;

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

  Menu.buildFromTemplate(items).popup({ window: mainWindow });
}

function showBrowserContextMenu(tab: BrowserTab, params: Electron.ContextMenuParams) {
  const mainWindow = currentMainWindow();
  if (!mainWindow || !tab) return;

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
        safeCreateBrowserTab({ url: linkUrl, active: false, openerTabId: tab.id });
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
        safeCreateBrowserTab({ url: srcUrl, active: false, openerTabId: tab.id });
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
    enabled: canCreateBrowserTab(),
    click: function () {
      safeCreateBrowserTab({ url: homeUrl, active: true, openerTabId: tab.id });
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
  const mainWindow = currentMainWindow();
  if (!mainWindow) return { shown: false };

  const normalizedPayload: BrowserTabMenuPayload = payload || {};
  const tab = getBrowserTab(normalizedPayload.tabId);
  syncBrowserTabMediaState(tab);

  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('context.newTab'),
      enabled: canCreateBrowserTab(),
      click: function () {
        safeCreateBrowserTab({ url: homeUrl, active: true, openerTabId: tab.id });
      }
    },
    {
      label: t('context.switchToTab'),
      enabled: getActiveBrowserTabId() !== tab.id,
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
  const mainWindow = currentMainWindow();
  if (!mainWindow) return { shown: false };

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
      enabled: canCreateBrowserTab(),
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

export function createContextMenuManager(context: ContextMenuManagerContext): ContextMenuManager {
  activateBrowserTab = context.activateBrowserTab;
  canCreateBrowserTab = context.canCreateBrowserTab;
  clipboard = context.clipboard;
  closeBrowserTab = context.closeBrowserTab;
  forwardBrowserMessage = context.forwardBrowserMessage;
  getActiveBrowserTabId = context.getActiveBrowserTabId;
  getBrowserTab = context.getBrowserTab;
  getMainWindow = context.getMainWindow;
  goBrowserBack = context.goBrowserBack;
  goBrowserForward = context.goBrowserForward;
  homeUrl = context.homeUrl;
  Menu = context.Menu;
  reloadBrowser = context.reloadBrowser;
  safeCreateBrowserTab = context.safeCreateBrowserTab;
  setBrowserTabMuted = context.setBrowserTabMuted;
  syncBrowserTabMediaState = context.syncBrowserTabMediaState;
  translate = context.t;

  return {
    showBrowserContextMenu: showBrowserContextMenu,
    showBrowserTabMenu: showBrowserTabMenu,
    showLibraryVideoMenu: showLibraryVideoMenu
  };
}
