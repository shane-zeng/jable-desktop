'use strict';

type BrowserTabKind = 'normal' | 'sync';

type BrowserTabLike = {
  id: string;
  openerTabId?: unknown;
  muted?: unknown;
  audible?: unknown;
  mediaPlaying?: unknown;
  pictureInPicture?: unknown;
  discarded?: unknown;
};

type BrowserTabWebPreferences = {
  preload: string;
  contextIsolation: boolean;
  nodeIntegration: boolean;
  sandbox: boolean;
  partition: string;
  backgroundThrottling: boolean;
};

type BrowserTabShortcutInput = {
  type?: string;
  key?: string;
  code?: string;
  isAutoRepeat?: boolean;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
};
type BrowserTabReloadShortcut = 'normal' | 'hard';

function shouldThrottleBackground(kind: BrowserTabKind | string | null | undefined): boolean {
  return kind !== 'sync';
}

function browserTabWebPreferences(
  kind: BrowserTabKind | string | null | undefined,
  preloadPath: string,
  partition: string
): BrowserTabWebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    partition: partition,
    backgroundThrottling: shouldThrottleBackground(kind)
  };
}

function serializedMediaState(tab: Partial<BrowserTabLike> | null | undefined) {
  tab = tab || {};

  return {
    muted: Boolean(tab.muted),
    audible: Boolean(tab.audible),
    mediaPlaying: Boolean(tab.mediaPlaying),
    pictureInPicture: Boolean(tab.pictureInPicture),
    discarded: Boolean(tab.discarded)
  };
}

function nextActiveTabIdByOffset(
  tabs: Partial<BrowserTabLike>[],
  activeTabId: string | null | undefined,
  offset: number
): string | null {
  tabs = Array.isArray(tabs) ? tabs : [];

  if (!activeTabId || !tabs.length) return null;

  let activeIndex = -1;

  for (let i = 0; i < tabs.length; i++) {
    if (!tabs[i] || tabs[i].id !== activeTabId) continue;
    activeIndex = i;
    break;
  }

  if (activeIndex === -1) return null;
  if (tabs.length === 1 || !offset) return activeTabId;

  let nextIndex = (activeIndex + offset) % tabs.length;
  if (nextIndex < 0) nextIndex += tabs.length;

  const nextTab = tabs[nextIndex];
  return nextTab && typeof nextTab.id === 'string' ? nextTab.id : null;
}

function tabIdValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function tabOpenedBy(tab: Partial<BrowserTabLike> | null | undefined, openerTabId: string): boolean {
  return Boolean(tab && tabIdValue(tab.openerTabId) === openerTabId);
}

function browserTabInsertionIndex(
  tabs: Partial<BrowserTabLike>[],
  anchorTabId: string | null | undefined,
  openerTabId?: string | null
): number {
  tabs = Array.isArray(tabs) ? tabs : [];

  const openerId = tabIdValue(openerTabId);
  const anchorId = tabIdValue(anchorTabId) || openerId;

  let fallbackIndex = -1;
  let insertionIndex = -1;

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (!tab) continue;

    if (anchorId && tab.id === anchorId) fallbackIndex = i + 1;
    if (openerId && tabOpenedBy(tab, openerId)) insertionIndex = i + 1;
  }

  if (insertionIndex !== -1) return insertionIndex;
  if (fallbackIndex !== -1) return fallbackIndex;
  return tabs.length;
}

function browserTabShortcutOffset(input: BrowserTabShortcutInput | null | undefined, isMacos: boolean): number {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return 0;

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();

  if (key === 'tab' || code === 'tab') {
    if (!input.control || input.meta || input.alt) return 0;
    return input.shift ? -1 : 1;
  }

  if (!isMacos) {
    if (!input.control || input.meta || input.alt || input.shift) return 0;
    if (key === 'pagedown' || code === 'pagedown') return 1;
    if (key === 'pageup' || code === 'pageup') return -1;
    return 0;
  }

  if (input.meta && input.alt && !input.control && !input.shift) {
    if (key === 'arrowright' || key === 'right' || code === 'arrowright') return 1;
    if (key === 'arrowleft' || key === 'left' || code === 'arrowleft') return -1;
    return 0;
  }

  if (input.meta && input.shift && !input.control && !input.alt) {
    if (key === ']' || key === '}' || code === 'bracketright') return 1;
    if (key === '[' || key === '{' || code === 'bracketleft') return -1;
  }

  return 0;
}

function browserTabReloadShortcut(
  input: BrowserTabShortcutInput | null | undefined,
  isMacos: boolean
): BrowserTabReloadShortcut | null {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return null;

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();
  const isF5 = key === 'f5' || code === 'f5';

  if (isF5) {
    if (input.meta || input.alt) return null;
    if (input.control) return isMacos ? null : 'hard';
    return input.shift ? 'hard' : 'normal';
  }

  if (key !== 'r' && code !== 'keyr') return null;

  if (isMacos) {
    if (!input.meta || input.control) return null;
    if (input.alt) return input.shift ? null : 'hard';
    return input.shift ? 'hard' : 'normal';
  }

  if (!input.control || input.meta || input.alt) return null;
  return input.shift ? 'hard' : 'normal';
}

function nextActiveTabIdAfterClose(
  tabs: BrowserTabLike[],
  activeTabId: string | null | undefined,
  closingTabId: string | null | undefined
): string | null {
  tabs = Array.isArray(tabs) ? tabs : [];

  if (activeTabId !== closingTabId) return activeTabId || null;

  for (let i = 0; i < tabs.length; i++) {
    const closingTab = tabs[i];
    if (!closingTab || closingTab.id !== closingTabId) continue;

    for (let childIndex = i + 1; childIndex < tabs.length; childIndex++) {
      const childTab = tabs[childIndex];
      if (childTab && childTab.id !== closingTabId && tabOpenedBy(childTab, closingTab.id)) return childTab.id;
    }

    const openerTabId = tabIdValue(closingTab.openerTabId);

    if (openerTabId) {
      for (let siblingIndex = i + 1; siblingIndex < tabs.length; siblingIndex++) {
        const siblingTab = tabs[siblingIndex];
        if (siblingTab && siblingTab.id !== closingTabId && tabOpenedBy(siblingTab, openerTabId)) {
          return siblingTab.id;
        }
      }

      for (let openerIndex = 0; openerIndex < tabs.length; openerIndex++) {
        const openerTab = tabs[openerIndex];
        if (openerTab && openerTab.id === openerTabId) return openerTab.id;
      }
    }

    const nextTab = tabs[i + 1] || tabs[i - 1] || null;
    return nextTab ? nextTab.id : null;
  }

  return activeTabId || null;
}

module.exports = {
  browserTabInsertionIndex: browserTabInsertionIndex,
  browserTabReloadShortcut: browserTabReloadShortcut,
  browserTabShortcutOffset: browserTabShortcutOffset,
  browserTabWebPreferences: browserTabWebPreferences,
  nextActiveTabIdByOffset: nextActiveTabIdByOffset,
  nextActiveTabIdAfterClose: nextActiveTabIdAfterClose,
  serializedMediaState: serializedMediaState,
  shouldThrottleBackground: shouldThrottleBackground
};
