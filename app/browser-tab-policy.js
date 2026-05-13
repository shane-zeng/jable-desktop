'use strict';

function shouldThrottleBackground(kind) {
  return kind !== 'sync';
}

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
