'use strict';

import type { IpcRendererEvent } from 'electron';
import type * as Electron from 'electron';
import type { BrowserMessage, JableAppApi } from './types/jable';

const electron: typeof Electron = require('electron');
const contextBridge = electron.contextBridge;
const ipcRenderer = electron.ipcRenderer;

const jableApp: JableAppApi = {
  getAppInfo: function () {
    return ipcRenderer.invoke('app:info');
  },
  getSettings: function () {
    return ipcRenderer.invoke('app:get-settings');
  },
  updateSettings: function (patch) {
    return ipcRenderer.invoke('app:update-settings', patch);
  },
  setLocale: function (locale) {
    return ipcRenderer.invoke('app:set-locale', locale);
  },
  getFfmpegStatus: function () {
    return ipcRenderer.invoke('app:get-ffmpeg-status');
  },
  refreshFfmpegStatus: function () {
    return ipcRenderer.invoke('app:refresh-ffmpeg-status');
  },
  chooseFfmpegPath: function () {
    return ipcRenderer.invoke('app:choose-ffmpeg-path');
  },
  setFfmpegPath: function (filePath) {
    return ipcRenderer.invoke('app:set-ffmpeg-path', filePath);
  },
  clearFfmpegPath: function () {
    return ipcRenderer.invoke('app:clear-ffmpeg-path');
  },
  openLocalDataFolder: function () {
    return ipcRenderer.invoke('app:open-local-data-folder');
  },
  checkForUpdates: function () {
    return ipcRenderer.invoke('app:check-for-updates');
  },
  listVideos: function (options) {
    return ipcRenderer.invoke('db:list-videos', options);
  },
  countVideos: function (options) {
    return ipcRenderer.invoke('db:count-videos', options);
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
  exportJsonFile: function (collectionKey) {
    return ipcRenderer.invoke('db:export-json-file', collectionKey);
  },
  listPendingRemoteOperationGroups: function () {
    return ipcRenderer.invoke('db:list-pending-remote-operation-groups');
  },
  addPendingRemoteOperationGroup: function (groupId) {
    return ipcRenderer.invoke('db:add-pending-remote-operation-group', groupId);
  },
  removePendingRemoteOperationGroup: function (groupId) {
    return ipcRenderer.invoke('db:remove-pending-remote-operation-group', groupId);
  },
  resolvePendingRemoteOperationGroup: function (groupId) {
    return ipcRenderer.invoke('db:resolve-pending-remote-operation-group', groupId);
  },
  listBrowserTabs: function () {
    return ipcRenderer.invoke('browser:list-tabs');
  },
  showBrowserTabMenu: function (payload) {
    return ipcRenderer.invoke('browser:show-tab-menu', payload);
  },
  showLibraryVideoMenu: function (payload) {
    return ipcRenderer.invoke('library:show-video-menu', payload);
  },
  createBrowserTab: function (payload) {
    return ipcRenderer.invoke('browser:create-tab', payload);
  },
  activateBrowserTab: function (tabId) {
    return ipcRenderer.invoke('browser:activate-tab', tabId);
  },
  closeBrowserTab: function (tabId) {
    return ipcRenderer.invoke('browser:close-tab', tabId);
  },
  setBrowserTabLocked: function (payload) {
    return ipcRenderer.invoke('browser:set-tab-locked', payload);
  },
  setBrowserTabMuted: function (payload) {
    return ipcRenderer.invoke('browser:set-tab-muted', payload);
  },
  setBrowserBounds: function (bounds) {
    return ipcRenderer.invoke('browser:set-bounds', bounds);
  },
  navigateBrowser: function (payload) {
    return ipcRenderer.invoke('browser:navigate', payload);
  },
  reloadBrowser: function (payload) {
    return ipcRenderer.invoke('browser:reload', payload);
  },
  goBackBrowser: function (payload) {
    return ipcRenderer.invoke('browser:go-back', payload);
  },
  goForwardBrowser: function (payload) {
    return ipcRenderer.invoke('browser:go-forward', payload);
  },
  getBrowserNavigationState: function (payload) {
    return ipcRenderer.invoke('browser:navigation-state', payload);
  },
  getBrowserUrl: function (payload) {
    return ipcRenderer.invoke('browser:get-url', payload);
  },
  syncBrowserCollection: function (payload) {
    return ipcRenderer.invoke('browser:sync-collection', payload);
  },
  diagnoseBrowser: function (payload) {
    return ipcRenderer.invoke('browser:diagnose', payload);
  },
  onBrowserMessage: function (callback) {
    ipcRenderer.on('browser-message', function (_event: IpcRendererEvent, message: BrowserMessage) {
      callback(message);
    });
  }
};

contextBridge.exposeInMainWorld('jableApp', jableApp);
