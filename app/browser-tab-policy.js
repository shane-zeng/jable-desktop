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
  browserTabWebPreferences: browserTabWebPreferences,
  nextActiveTabIdAfterClose: nextActiveTabIdAfterClose,
  serializedMediaState: serializedMediaState,
  shouldThrottleBackground: shouldThrottleBackground
};
