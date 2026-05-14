// @ts-check
'use strict';

/**
 * @typedef {'normal' | 'sync'} BrowserTabKind
 * @typedef {object} BrowserTabLike
 * @property {string} id
 * @property {unknown} [muted]
 * @property {unknown} [audible]
 * @property {unknown} [mediaPlaying]
 * @property {unknown} [pictureInPicture]
 * @property {unknown} [discarded]
 */

/**
 * @param {BrowserTabKind | string | null | undefined} kind
 * @returns {boolean}
 */
function shouldThrottleBackground(kind) {
  return kind !== 'sync';
}

/**
 * @param {BrowserTabKind | string | null | undefined} kind
 * @param {string} preloadPath
 * @param {string} partition
 * @returns {{
 *   preload: string,
 *   contextIsolation: boolean,
 *   nodeIntegration: boolean,
 *   sandbox: boolean,
 *   partition: string,
 *   backgroundThrottling: boolean
 * }}
 */
function browserTabWebPreferences(kind, preloadPath, partition) {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    partition: partition,
    backgroundThrottling: shouldThrottleBackground(kind)
  };
}

/**
 * @param {Partial<BrowserTabLike> | null | undefined} tab
 * @returns {{
 *   muted: boolean,
 *   audible: boolean,
 *   mediaPlaying: boolean,
 *   pictureInPicture: boolean,
 *   discarded: boolean
 * }}
 */
function serializedMediaState(tab) {
  tab = tab || {};

  return {
    muted: !!tab.muted,
    audible: !!tab.audible,
    mediaPlaying: !!tab.mediaPlaying,
    pictureInPicture: !!tab.pictureInPicture,
    discarded: !!tab.discarded
  };
}

/**
 * @param {Partial<BrowserTabLike>[]} tabs
 * @param {string | null | undefined} activeTabId
 * @param {number} offset
 * @returns {string | null}
 */
function nextActiveTabIdByOffset(tabs, activeTabId, offset) {
  tabs = Array.isArray(tabs) ? tabs : [];

  if (!activeTabId || !tabs.length) return null;

  var activeIndex = -1;

  for (var i = 0; i < tabs.length; i++) {
    if (!tabs[i] || tabs[i].id !== activeTabId) continue;
    activeIndex = i;
    break;
  }

  if (activeIndex === -1) return null;
  if (tabs.length === 1 || !offset) return activeTabId;

  var nextIndex = (activeIndex + offset) % tabs.length;
  if (nextIndex < 0) nextIndex += tabs.length;

  var nextTab = tabs[nextIndex];
  return nextTab && typeof nextTab.id === 'string' ? nextTab.id : null;
}

/**
 * @param {{
 *   type?: string,
 *   key?: string,
 *   code?: string,
 *   isAutoRepeat?: boolean,
 *   control?: boolean,
 *   meta?: boolean,
 *   alt?: boolean,
 *   shift?: boolean
 * } | null | undefined} input
 * @param {boolean} isMacos
 * @returns {number}
 */
function browserTabShortcutOffset(input, isMacos) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return 0;

  var key = String(input.key || '').toLowerCase();
  var code = String(input.code || '').toLowerCase();

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

/**
 * @param {BrowserTabLike[]} tabs
 * @param {string | null | undefined} activeTabId
 * @param {string | null | undefined} closingTabId
 * @returns {string | null}
 */
function nextActiveTabIdAfterClose(tabs, activeTabId, closingTabId) {
  tabs = Array.isArray(tabs) ? tabs : [];

  if (activeTabId !== closingTabId) return activeTabId || null;

  for (var i = 0; i < tabs.length; i++) {
    if (!tabs[i] || tabs[i].id !== closingTabId) continue;

    var nextTab = tabs[i + 1] || tabs[i - 1] || null;
    return nextTab ? nextTab.id : null;
  }

  return activeTabId || null;
}

module.exports = {
  browserTabShortcutOffset: browserTabShortcutOffset,
  browserTabWebPreferences: browserTabWebPreferences,
  nextActiveTabIdByOffset: nextActiveTabIdByOffset,
  nextActiveTabIdAfterClose: nextActiveTabIdAfterClose,
  serializedMediaState: serializedMediaState,
  shouldThrottleBackground: shouldThrottleBackground
};
