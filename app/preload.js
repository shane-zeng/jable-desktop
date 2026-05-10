'use strict';

var electron = require('electron');
var contextBridge = electron.contextBridge;
var ipcRenderer = electron.ipcRenderer;

contextBridge.exposeInMainWorld('jableApp', {
  getAppInfo: function () {
    return ipcRenderer.invoke('app:info');
  },
  listVideos: function (options) {
    return ipcRenderer.invoke('db:list-videos', options);
  },
  getCollectionUrls: function (collectionKey) {
    return ipcRenderer.invoke('db:collection-urls', collectionKey);
  },
  saveSyncPage: function (payload) {
    return ipcRenderer.invoke('db:save-sync-page', payload);
  },
  finishSync: function (payload) {
    return ipcRenderer.invoke('db:finish-sync', payload);
  },
  clearSyncState: function (collectionKey) {
    return ipcRenderer.invoke('db:clear-sync-state', collectionKey);
  },
  importJson: function (payload) {
    return ipcRenderer.invoke('db:import-json', payload);
  },
  exportJson: function (collectionKey) {
    return ipcRenderer.invoke('db:export-json', collectionKey);
  },
  clearJableSession: function () {
    return ipcRenderer.invoke('session:clear-jable');
  },
  setBrowserBounds: function (bounds) {
    return ipcRenderer.invoke('browser:set-bounds', bounds);
  },
  navigateBrowser: function (payload) {
    return ipcRenderer.invoke('browser:navigate', payload);
  },
  reloadBrowser: function () {
    return ipcRenderer.invoke('browser:reload');
  },
  goBackBrowser: function () {
    return ipcRenderer.invoke('browser:go-back');
  },
  getBrowserUrl: function () {
    return ipcRenderer.invoke('browser:get-url');
  },
  syncBrowserCollection: function (options) {
    return ipcRenderer.invoke('browser:sync-collection', options);
  },
  diagnoseBrowser: function () {
    return ipcRenderer.invoke('browser:diagnose');
  },
  onBrowserMessage: function (callback) {
    ipcRenderer.on('browser-message', function (_event, message) {
      callback(message);
    });
  }
});
