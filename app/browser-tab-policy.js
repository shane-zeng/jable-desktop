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

module.exports = {
  browserTabWebPreferences: browserTabWebPreferences,
  serializedMediaState: serializedMediaState,
  shouldThrottleBackground: shouldThrottleBackground
};
