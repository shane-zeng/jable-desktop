'use strict';

import type * as Electron from 'electron';
import type { DataEngine } from '../data/data-engine';
import type {
  AppSettings,
  AppSettingsPatch,
  BrowserDiagnosis,
  BrowserBounds,
  BrowserNavigatePayload,
  BrowserNavigationState,
  BrowserTabLockedPayload,
  BrowserTabMenuPayload,
  BrowserTabMutedPayload,
  BrowserTabsState,
  CollectionKey,
  CreateBrowserTabPayload,
  ExportJsonFileResult,
  PendingRemoteOperationActionResult,
  SyncBrowserCollectionOptions,
  SyncMode,
  SyncResult
} from '../types/jable';
import type { BrowserTab } from './browser-tab-manager';
import type { DownloadManager } from './download-manager';
import type { UpdateCheckResult } from './app-menu-manager';
import type { ActiveSyncRun, PendingCollectionOperationOverlayState } from './sync-worker-manager';
import {
  normalizeBrowserBounds,
  normalizeBrowserNavigatePayload,
  normalizeBrowserSyncCollectionPayload,
  normalizeBrowserTabLockedPayload,
  normalizeBrowserTabMenuPayload,
  normalizeBrowserTabMutedPayload,
  normalizeBrowserTabPayload,
  normalizeCollectionKey,
  normalizeCollectionTogglePayload,
  normalizeCollectionUrlsKnownPayload,
  normalizeCreateBrowserTabPayload,
  normalizeFinishSyncPayload,
  normalizeImportJsonPayload,
  normalizeLibraryVideoMenuPayload,
  normalizeListVideosOptions,
  normalizeSyncPagePayload,
  normalizeTabIdValue,
  normalizeVideoMetadataRefreshPayload,
  requiredStringValue
} from './ipc-normalizers';

export type IpcHandlersContext = {
  activeSyncRunsState(): { runs: Partial<Record<CollectionKey, { mode: SyncMode; syncRunId: string }>> };
  addPendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult>;
  applyBrowserSyncCollectionSettings(payload: { tabId: string | null; options: SyncBrowserCollectionOptions }): {
    tabId: string | null;
    options: SyncBrowserCollectionOptions;
  };
  browserDiagnosisTimeoutMs: number;
  browserNavigationState(tabId?: string | null): BrowserNavigationState;
  browserTabsState(): BrowserTabsState;
  checkForUpdates(options?: { manual?: boolean } | null): Promise<UpdateCheckResult>;
  closeBrowserTab(tabId: string | null): BrowserTabsState;
  createBrowserTab(options?: CreateBrowserTabPayload | null): BrowserTabsState;
  currentLocale(): string;
  exportJsonFile(collectionKey: CollectionKey): Promise<ExportJsonFileResult>;
  forwardBrowserMessage(channel: string, payload: unknown): void;
  getAppSettings(): AppSettings;
  getBrowserTab(tabId?: string | null): BrowserTab;
  getBrowserTabByWebContents(webContents: Electron.WebContents | null | undefined): BrowserTab | null;
  getDatabase(): DataEngine;
  getDatabasePath(): string | null;
  getDownloadManager(): DownloadManager;
  getSystemLocale(): string;
  goBrowserBack(tabId?: string | null): Promise<BrowserNavigationState>;
  goBrowserForward(tabId?: string | null): Promise<BrowserNavigationState>;
  ipcMain: typeof Electron.ipcMain;
  mainErrorMessage(error: unknown): string;
  markActiveSyncMutated(collectionKey: CollectionKey): void;
  navigateBrowser(payload?: BrowserNavigatePayload | null): Promise<string>;
  notifyPendingCollectionOperationsChanged(): void;
  openLocalDataFolder(): Promise<{ opened: boolean; path: string }>;
  pendingCollectionOperationsState(): PendingCollectionOperationOverlayState;
  reloadBrowser(tabId?: string | null): Promise<BrowserNavigationState>;
  removePendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult>;
  requestBrowserPreload<T>(
    tab: BrowserTab,
    channel: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T>;
  resolveBrowserPreloadResponse(event: Electron.IpcMainEvent, payload: unknown): void;
  resolvePendingRemoteOperationGroup(groupId: string): PendingRemoteOperationActionResult;
  safeCreateBrowserTab(options?: CreateBrowserTabPayload | null): BrowserTabsState;
  setCurrentLocale(locale: unknown): string;
  setBrowserBounds(bounds: BrowserBounds | null | undefined): BrowserBounds | null;
  setBrowserTabLocked(payload?: BrowserTabLockedPayload | null): BrowserTabsState;
  setBrowserTabMuted(payload?: BrowserTabMutedPayload | null): BrowserTabsState;
  showBrowserTabMenu(payload?: BrowserTabMenuPayload | null): { shown: boolean };
  showLibraryVideoMenu(payload?: unknown): { shown: boolean };
  syncBrowserCollectionInWorker(payload: {
    tabId: string | null;
    options: SyncBrowserCollectionOptions;
  }): Promise<SyncResult>;
  syncPayloadForEvent(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, payload: unknown): unknown;
  syncRunForCollection(collectionKey: CollectionKey): ActiveSyncRun | null;
  updateAppSettings(patch: unknown): AppSettings;
  activateBrowserTab(tabId: string | null): BrowserTabsState;
};

function registerAppHandlers(context: IpcHandlersContext) {
  context.ipcMain.handle('app:info', function () {
    context.getDatabase();

    return {
      databasePath: context.getDatabasePath(),
      locale: context.currentLocale(),
      systemLocale: context.getSystemLocale()
    };
  });

  context.ipcMain.handle('app:get-settings', function () {
    return context.getAppSettings();
  });

  context.ipcMain.handle('app:update-settings', function (_event, patch: AppSettingsPatch) {
    return context.updateAppSettings(patch);
  });

  context.ipcMain.handle('app:set-locale', function (_event, locale) {
    return {
      locale: context.setCurrentLocale(locale)
    };
  });

  context.ipcMain.handle('app:open-local-data-folder', function () {
    return context.openLocalDataFolder();
  });

  context.ipcMain.handle('app:check-for-updates', function () {
    return context.checkForUpdates({ manual: true });
  });
}

function registerDownloadHandlers(context: IpcHandlersContext) {
  context.ipcMain.handle('app:get-ffmpeg-status', function () {
    return context.getDownloadManager().getFfmpegStatus();
  });

  context.ipcMain.handle('app:refresh-ffmpeg-status', function () {
    return context.getDownloadManager().getFfmpegStatus();
  });

  context.ipcMain.handle('app:choose-ffmpeg-path', function () {
    return context.getDownloadManager().chooseFfmpegPath();
  });

  context.ipcMain.handle('app:set-ffmpeg-path', function (_event, filePath) {
    return context.getDownloadManager().setFfmpegPath(filePath);
  });

  context.ipcMain.handle('app:clear-ffmpeg-path', function () {
    return context.getDownloadManager().clearFfmpegPath();
  });

  context.ipcMain.handle('app:get-download-root', function () {
    return context.getDownloadManager().getDownloadRoot();
  });

  context.ipcMain.handle('app:choose-download-root', function () {
    return context.getDownloadManager().chooseDownloadRoot();
  });

  context.ipcMain.handle('app:set-download-root', function (_event, filePath) {
    return context.getDownloadManager().setDownloadRoot(filePath);
  });

  context.ipcMain.handle('app:clear-download-root', function () {
    return context.getDownloadManager().clearDownloadRoot();
  });

  context.ipcMain.handle('app:open-download-root', function () {
    return context.getDownloadManager().openDownloadRoot();
  });

  context.ipcMain.handle('download:list', function () {
    return context.getDownloadManager().listDownloads();
  });

  context.ipcMain.handle('download:enqueue', function (_event, payload) {
    return context.getDownloadManager().enqueueDownload(payload);
  });

  context.ipcMain.handle('download:retry', function (_event, videoUrl) {
    return context.getDownloadManager().retryDownload(videoUrl);
  });

  context.ipcMain.handle('download:retry-failed', function () {
    return context.getDownloadManager().retryFailedDownloads();
  });

  context.ipcMain.handle('download:pause', function (_event, videoUrl) {
    return context.getDownloadManager().pauseDownload(videoUrl);
  });

  context.ipcMain.handle('download:pause-all', function () {
    return context.getDownloadManager().pauseAllDownloads();
  });

  context.ipcMain.handle('download:resume', function (_event, videoUrl) {
    return context.getDownloadManager().resumeDownload(videoUrl);
  });

  context.ipcMain.handle('download:resume-paused', function () {
    return context.getDownloadManager().resumePausedDownloads();
  });

  context.ipcMain.handle('download:cancel', function (_event, videoUrl) {
    return context.getDownloadManager().cancelDownload(videoUrl);
  });

  context.ipcMain.handle('download:cancel-queued', function () {
    return context.getDownloadManager().cancelQueuedDownloads();
  });

  context.ipcMain.handle('download:open-file', function (_event, videoUrl) {
    return context.getDownloadManager().openDownloadFile(videoUrl);
  });

  context.ipcMain.handle('download:reveal-file', function (_event, videoUrl) {
    return context.getDownloadManager().revealDownloadFile(videoUrl);
  });

  context.ipcMain.handle('download:delete', function (_event, videoUrl) {
    return context.getDownloadManager().deleteDownload(videoUrl);
  });

  context.ipcMain.handle('download:delete-many', function (_event, videoUrls) {
    return context.getDownloadManager().deleteDownloads(videoUrls);
  });

  context.ipcMain.handle('download:local-playback-source', function (_event, videoUrl) {
    return context.getDownloadManager().localPlaybackSource(videoUrl);
  });
}

function registerDatabaseHandlers(context: IpcHandlersContext) {
  context.ipcMain.handle('db:list-videos', function (_event, options) {
    const normalizedOptions = normalizeListVideosOptions(options, 'db:list-videos');
    return context.getDatabase().listVideos(normalizedOptions.collectionKey, normalizedOptions);
  });

  context.ipcMain.handle('db:count-videos', function (_event, options) {
    const normalizedOptions = normalizeListVideosOptions(options, 'db:count-videos');
    return context.getDatabase().countVideos(normalizedOptions.collectionKey, normalizedOptions);
  });

  context.ipcMain.handle('db:collection-urls', function (_event, collectionKey) {
    return context.getDatabase().getCollectionUrls(normalizeCollectionKey(collectionKey, 'db:collection-urls'));
  });

  context.ipcMain.handle('db:collection-urls-known', function (_event, payload) {
    const normalizedPayload = normalizeCollectionUrlsKnownPayload(payload);
    return context.getDatabase().allCollectionUrlsKnown(normalizedPayload.collectionKey, normalizedPayload.urls);
  });

  context.ipcMain.handle('db:refresh-video-metadata', function (_event, payload) {
    return context.getDatabase().refreshVideoMetadata(normalizeVideoMetadataRefreshPayload(payload));
  });

  context.ipcMain.handle('db:save-sync-page', function (_event, payload) {
    return context.getDatabase().saveSyncPage(normalizeSyncPagePayload(payload));
  });

  context.ipcMain.handle('db:apply-collection-toggle', function (event, payload) {
    try {
      const normalizedPayload = normalizeCollectionTogglePayload(payload);
      const activeRun = context.syncRunForCollection(normalizedPayload.collectionKey as CollectionKey);
      if (activeRun) {
        if (normalizedPayload.deferRemote !== true) {
          context.markActiveSyncMutated(normalizedPayload.collectionKey as CollectionKey);
        } else {
          normalizedPayload.deferLocal = true;
        }
        normalizedPayload.syncRunId = activeRun.syncRunId;
      }

      const result = context.getDatabase().applyCollectionToggle(normalizedPayload);
      context.forwardBrowserMessage('collection-toggle', context.syncPayloadForEvent(event, result));
      if (result.queued) context.notifyPendingCollectionOperationsChanged();
      return result;
    } catch (error) {
      context.forwardBrowserMessage('browser-error', { message: context.mainErrorMessage(error) });
      throw error;
    }
  });

  context.ipcMain.handle('db:finish-sync', function (_event, payload) {
    return context.getDatabase().finishSync(normalizeFinishSyncPayload(payload));
  });

  context.ipcMain.handle('db:clear-sync-state', function (_event, collectionKey) {
    return context.getDatabase().clearSyncState(normalizeCollectionKey(collectionKey, 'db:clear-sync-state'));
  });

  context.ipcMain.handle('db:import-json', function (_event, payload) {
    const normalizedPayload = normalizeImportJsonPayload(payload);
    return context.getDatabase().importResource(normalizedPayload.collectionKey, normalizedPayload.resource);
  });

  context.ipcMain.handle('db:export-json', function (_event, collectionKey) {
    return context.getDatabase().exportResource(normalizeCollectionKey(collectionKey, 'db:export-json'));
  });

  context.ipcMain.handle('db:export-json-file', function (_event, collectionKey) {
    return context.exportJsonFile(normalizeCollectionKey(collectionKey, 'db:export-json-file'));
  });

  context.ipcMain.handle('db:list-pending-remote-operation-groups', function () {
    return context.getDatabase().listPendingRemoteOperationGroups();
  });

  context.ipcMain.handle('db:add-pending-remote-operation-group', function (_event, groupId) {
    return context.addPendingRemoteOperationGroup(
      requiredStringValue(groupId, 'groupId', 'db:add-pending-remote-operation-group')
    );
  });

  context.ipcMain.handle('db:remove-pending-remote-operation-group', function (_event, groupId) {
    return context.removePendingRemoteOperationGroup(
      requiredStringValue(groupId, 'groupId', 'db:remove-pending-remote-operation-group')
    );
  });

  context.ipcMain.handle('db:resolve-pending-remote-operation-group', function (_event, groupId) {
    return context.resolvePendingRemoteOperationGroup(
      requiredStringValue(groupId, 'groupId', 'db:resolve-pending-remote-operation-group')
    );
  });
}

function registerLibraryHandlers(context: IpcHandlersContext) {
  context.ipcMain.handle('library:show-video-menu', function (_event, payload) {
    return context.showLibraryVideoMenu(normalizeLibraryVideoMenuPayload(payload));
  });
}

function registerBrowserHandlers(context: IpcHandlersContext) {
  context.ipcMain.handle('browser:list-tabs', function () {
    return context.browserTabsState();
  });

  context.ipcMain.handle('browser:active-sync-runs', function () {
    return context.activeSyncRunsState();
  });

  context.ipcMain.handle('browser:pending-collection-operations', function () {
    return context.pendingCollectionOperationsState();
  });

  context.ipcMain.handle('browser:show-tab-menu', function (_event, payload) {
    return context.showBrowserTabMenu(normalizeBrowserTabMenuPayload(payload));
  });

  context.ipcMain.handle('browser:create-tab', function (_event, payload) {
    return context.createBrowserTab(normalizeCreateBrowserTabPayload(payload));
  });

  context.ipcMain.handle('browser:activate-tab', function (_event, tabId) {
    return context.activateBrowserTab(normalizeTabIdValue(tabId, 'browser:activate-tab'));
  });

  context.ipcMain.handle('browser:close-tab', function (_event, tabId) {
    return context.closeBrowserTab(normalizeTabIdValue(tabId, 'browser:close-tab'));
  });

  context.ipcMain.handle('browser:set-tab-locked', function (_event, payload) {
    return context.setBrowserTabLocked(normalizeBrowserTabLockedPayload(payload));
  });

  context.ipcMain.handle('browser:set-tab-muted', function (_event, payload) {
    return context.setBrowserTabMuted(normalizeBrowserTabMutedPayload(payload));
  });

  context.ipcMain.handle('browser:set-bounds', function (_event, bounds) {
    return context.setBrowserBounds(normalizeBrowserBounds(bounds));
  });

  context.ipcMain.handle('browser:navigate', function (_event, payload) {
    return context.navigateBrowser(normalizeBrowserNavigatePayload(payload));
  });

  context.ipcMain.handle('browser:reload', async function (_event, payload) {
    return context.reloadBrowser(normalizeBrowserTabPayload(payload, 'browser:reload').tabId);
  });

  context.ipcMain.handle('browser:go-back', async function (_event, payload) {
    return context.goBrowserBack(normalizeBrowserTabPayload(payload, 'browser:go-back').tabId);
  });

  context.ipcMain.handle('browser:go-forward', async function (_event, payload) {
    return context.goBrowserForward(normalizeBrowserTabPayload(payload, 'browser:go-forward').tabId);
  });

  context.ipcMain.handle('browser:navigation-state', function (_event, payload) {
    return context.browserNavigationState(normalizeBrowserTabPayload(payload, 'browser:navigation-state').tabId);
  });

  context.ipcMain.handle('browser:get-url', function (_event, payload) {
    return context
      .getBrowserTab(normalizeBrowserTabPayload(payload, 'browser:get-url').tabId)
      .view.webContents.getURL();
  });

  context.ipcMain.handle('browser:sync-collection', function (_event, payload) {
    const normalizedPayload = normalizeBrowserSyncCollectionPayload(payload);
    return context.syncBrowserCollectionInWorker(context.applyBrowserSyncCollectionSettings(normalizedPayload));
  });

  context.ipcMain.handle('browser:diagnose', function (_event, payload) {
    const tab = context.getBrowserTab(normalizeBrowserTabPayload(payload, 'browser:diagnose').tabId);
    return context.requestBrowserPreload<BrowserDiagnosis>(
      tab,
      'browser:diagnose-request',
      {},
      context.browserDiagnosisTimeoutMs
    );
  });

  context.ipcMain.on('browser:preload-response', context.resolveBrowserPreloadResponse);

  context.ipcMain.on('browser:sync-page', function (event, payload) {
    context.forwardBrowserMessage('sync-page', context.syncPayloadForEvent(event, payload));
  });

  context.ipcMain.on('browser:sync-progress', function (event, payload) {
    context.forwardBrowserMessage('sync-progress', context.syncPayloadForEvent(event, payload));
  });

  context.ipcMain.on('browser:trackpad-history', function (event, direction) {
    const tab = context.getBrowserTabByWebContents(event.sender);
    if (!tab) return;

    if (direction === 'back') context.goBrowserBack(tab.id);
    else if (direction === 'forward') context.goBrowserForward(tab.id);
  });

  context.ipcMain.on('browser:open-url-new-tab', function (event, payload) {
    const tab = context.getBrowserTabByWebContents(event.sender);
    if (!tab) return;

    payload = payload || {};
    if (!payload.url) return;

    context.safeCreateBrowserTab({ url: payload.url, active: false, openerTabId: tab.id });
  });
}

export function registerIpcHandlers(context: IpcHandlersContext) {
  registerAppHandlers(context);
  registerDownloadHandlers(context);
  registerDatabaseHandlers(context);
  registerLibraryHandlers(context);
  registerBrowserHandlers(context);
}
