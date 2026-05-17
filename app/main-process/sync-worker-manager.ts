'use strict';

import type * as Electron from 'electron';
import type { BrowserLoadFailure } from './browser-tab-manager';
import type {
  BrowserTabKind,
  CollectionAction,
  CollectionKey,
  PendingRemoteOperationActionResult,
  SyncBrowserCollectionOptions,
  SyncMode,
  SyncQueuedOperationFailure,
  SyncQueueProgressPayload,
  SyncResult
} from '../types/jable';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
export type ActiveSyncRun = {
  mode: SyncMode;
  mutated: boolean;
  syncRunId: string;
};
type SyncWorker = {
  id: string;
  window: Electron.BrowserWindow;
  webContents: Electron.WebContents;
  collectionKey: CollectionKey;
  syncRunId: string;
  lastMainFrameLoadFailure: BrowserLoadFailure | null;
};
type DeferredSyncOperation = {
  id: number;
  action: 'add' | 'remove';
  videoUrl: string;
  remoteVideoId: string | null;
  remoteFavType: string | null;
};
type PendingCollectionOperationOverlay = Omit<DeferredSyncOperation, 'id'>;
export type PendingCollectionOperationOverlayState = {
  collections: Partial<Record<CollectionKey, PendingCollectionOperationOverlay[]>>;
};
type DeferredSyncOperationApplyResult = {
  applied: number[];
  failed: SyncQueuedOperationFailure[];
};
type SyncQueueProgressInput = Omit<SyncQueueProgressPayload, 'collectionKey' | 'mode' | 'syncRunId'>;
type SyncDataStore = {
  listDeferredSyncOutboxOperations(collectionKey: CollectionKey): DeferredSyncOperation[];
  markDeferredSyncOperationsApplied(collectionKey: CollectionKey, syncRunId: string | null, ids: unknown[]): number;
  markDeferredSyncOperationFailed(
    collectionKey: CollectionKey,
    syncRunId: string | null,
    id: unknown,
    message: unknown
  ): boolean;
  preparePendingRemoteOperationRetry(groupId: string): PendingRemoteOperationActionResult;
  markPendingRemoteOperationGroupAdded(groupId: string): boolean;
  markPendingRemoteOperationGroupRemoved(groupId: string): boolean;
  markPendingRemoteOperationGroupResolved(groupId: string): boolean;
  markPendingRemoteOperationGroupFailed(groupId: string, message: unknown): boolean;
};
type UrlPolicyModule = {
  isJableCollectionUrl(collectionKey: CollectionKey, value: unknown): boolean;
  jableCollectionUrl(collectionKey: CollectionKey, origin?: string): string;
};

export type SyncWorkerManagerContext = {
  activateFallbackOrigin(): void;
  browserTabWebPreferences(kind: BrowserTabKind, preloadPath: string, partition: string): Electron.WebPreferences;
  BrowserWindow: typeof Electron.BrowserWindow;
  fallbackUrlForLoadFailure(failure: BrowserLoadFailure | null | undefined): string | null;
  forwardBrowserMessage(channel: string, payload: unknown): void;
  getActiveJableOrigin(): string;
  getAutoReplayDeferredSyncOperations(): boolean;
  getDatabase(): SyncDataStore;
  rejectPreloadRequestsForWebContents(webContentsId: number, message: string): void;
  requestWebContentsPreload<T>(
    webContents: Electron.WebContents,
    channel: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T>;
  sendToAllBrowserTabs(channel: string, payload: unknown): void;
  sessionPartition: string;
  shouldDenyWebViewEnhancementNavigation(url: unknown): boolean;
  t(key: string, params?: TranslationParams | null): string;
  webviewPreloadPath: string;
};

export type SyncWorkerManager = {
  activeRunForCollection(collectionKey: CollectionKey): ActiveSyncRun | null;
  activeSyncRunsState(): { runs: Partial<Record<CollectionKey, { mode: SyncMode; syncRunId: string }>> };
  addPendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult>;
  closeAllWorkers(): void;
  markActiveSyncMutated(collectionKey: CollectionKey): void;
  notifyPendingCollectionOperationsChanged(): void;
  pendingCollectionOperationsState(): PendingCollectionOperationOverlayState;
  removePendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult>;
  resolvePendingRemoteOperationGroup(groupId: string): PendingRemoteOperationActionResult;
  syncBrowserCollection(payload: { tabId: string | null; options: SyncBrowserCollectionOptions }): Promise<SyncResult>;
};

const urlPolicy = require('../browser/url-policy') as UrlPolicyModule;

const BROWSER_SYNC_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;

let activateFallbackOrigin: () => void;
let browserTabWebPreferences: (kind: BrowserTabKind, preloadPath: string, partition: string) => Electron.WebPreferences;
let BrowserWindow: typeof Electron.BrowserWindow;
let fallbackUrlForLoadFailure: (failure: BrowserLoadFailure | null | undefined) => string | null;
let forwardBrowserMessage: (channel: string, payload: unknown) => void;
let getActiveJableOrigin: () => string;
let getAutoReplayDeferredSyncOperations: () => boolean;
let getDatabase: () => SyncDataStore;
let rejectPreloadRequestsForWebContents: (webContentsId: number, message: string) => void;
let requestWebContentsPreload: <T>(
  webContents: Electron.WebContents,
  channel: string,
  payload: Record<string, unknown>,
  timeoutMs: number
) => Promise<T>;
let sendToAllBrowserTabs: (channel: string, payload: unknown) => void;
let sessionPartition = '';
let shouldDenyWebViewEnhancementNavigation: (url: unknown) => boolean;
let translate: (key: string, params?: TranslationParams | null) => string;
let webviewPreloadPath = '';

const syncWorkersById: Record<string, SyncWorker> = {};
const activeSyncRunsByCollection: Partial<Record<CollectionKey, ActiveSyncRun>> = {};
let nextSyncWorkerId = 1;

function t(key: string, params?: TranslationParams | null): string {
  return translate(key, params);
}

function mainErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createSyncWorker(collectionKey: CollectionKey, syncRunId: string): SyncWorker {
  const preloadPath = webviewPreloadPath;
  const workerWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: browserTabWebPreferences('sync', preloadPath, sessionPartition)
  });
  const worker: SyncWorker = {
    id: 'sync-worker-' + nextSyncWorkerId++,
    window: workerWindow,
    webContents: workerWindow.webContents,
    collectionKey: collectionKey,
    syncRunId: syncRunId,
    lastMainFrameLoadFailure: null
  };

  syncWorkersById[worker.id] = worker;
  wireSyncWorker(worker);
  return worker;
}

function wireSyncWorker(worker: SyncWorker) {
  worker.webContents.setWindowOpenHandler(function (details: Electron.HandlerDetails) {
    if (details.url && shouldDenyWebViewEnhancementNavigation(details.url)) return { action: 'deny' };
    return { action: 'deny' };
  });

  worker.webContents.on('will-navigate', function (event: Electron.Event, url: string) {
    if (shouldDenyWebViewEnhancementNavigation(url)) event.preventDefault();
  });

  worker.webContents.on(
    'did-fail-load',
    function (
      _event: Electron.Event,
      errorCode: number,
      _errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean
    ) {
      if (!isMainFrame) return;

      worker.lastMainFrameLoadFailure = {
        url: validatedURL || worker.webContents.getURL(),
        errorCode: errorCode
      };
    }
  );

  worker.webContents.on('render-process-gone', function () {
    closeSyncWorker(worker.id, 'Sync worker renderer process ended');
  });

  worker.webContents.on('destroyed', function () {
    closeSyncWorker(worker.id, 'Sync worker was destroyed');
  });

  worker.window.on('closed', function () {
    closeSyncWorker(worker.id, 'Sync worker was closed');
  });
}

function closeSyncWorker(workerId: string | null | undefined, message?: string) {
  if (!workerId) return;

  const worker = syncWorkersById[workerId];
  if (!worker) return;

  delete syncWorkersById[worker.id];
  if (activeSyncRunsByCollection[worker.collectionKey]?.syncRunId === worker.syncRunId) {
    delete activeSyncRunsByCollection[worker.collectionKey];
  }
  rejectPreloadRequestsForWebContents(worker.webContents.id, message || 'Sync worker closed');

  try {
    if (!worker.window.isDestroyed()) worker.window.destroy();
  } catch (error) {}
}

function closeAllSyncWorkers() {
  const workerIds = Object.keys(syncWorkersById);

  for (let i = 0; i < workerIds.length; i++) {
    closeSyncWorker(workerIds[i], 'Application is quitting');
  }
}

function waitForSyncWorkerStop(worker: SyncWorker, timeoutMs?: number): Promise<string> {
  return new Promise(function (resolve, reject) {
    let done = false;
    const timer = setTimeout(finish, timeoutMs || 25000);

    function cleanup() {
      clearTimeout(timer);
      worker.webContents.removeListener('did-stop-loading', finish);
      worker.webContents.removeListener('destroyed', fail);
    }

    function finish() {
      if (done) return;
      done = true;
      cleanup();
      resolve(worker.webContents.getURL());
    }

    function fail() {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('Sync worker was destroyed while loading'));
    }

    worker.webContents.once('did-stop-loading', finish);
    worker.webContents.once('destroyed', fail);
  });
}

function loadSyncWorkerUrl(worker: SyncWorker, targetUrl: string, forceReload: boolean) {
  const currentUrl = worker.webContents.getURL();
  worker.lastMainFrameLoadFailure = null;

  if (forceReload && currentUrl === targetUrl) worker.webContents.reload();
  else worker.webContents.loadURL(targetUrl);
}

async function loadSyncWorkerCollection(worker: SyncWorker): Promise<string> {
  let targetUrl = urlPolicy.jableCollectionUrl(worker.collectionKey, getActiveJableOrigin());
  let wait = waitForSyncWorkerStop(worker);
  loadSyncWorkerUrl(worker, targetUrl, true);
  let loadedUrl = await wait;
  const fallbackUrl = fallbackUrlForLoadFailure(worker.lastMainFrameLoadFailure);

  if (fallbackUrl) {
    activateFallbackOrigin();
    targetUrl = fallbackUrl;
    wait = waitForSyncWorkerStop(worker);
    loadSyncWorkerUrl(worker, targetUrl, true);
    loadedUrl = await wait;
  }

  return loadedUrl;
}

function syncIncompleteResult(
  options: SyncBrowserCollectionOptions,
  reason: string,
  workerId?: string | null
): SyncResult {
  return {
    completed: false,
    mode: options.mode,
    syncRunId: options.syncRunId,
    syncWorkerId: workerId || null,
    incompleteReason: reason,
    stoppedByKnownPage: false,
    totalPages: 0,
    totalRows: 0,
    lastScrapedPage: options.startPage || null,
    lastKnownUrl: null
  };
}

function setActiveSyncRun(options: SyncBrowserCollectionOptions) {
  activeSyncRunsByCollection[options.collectionKey] = {
    mode: options.mode,
    mutated: false,
    syncRunId: options.syncRunId
  };
  notifyBrowserSyncLocksChanged();
  notifyPendingCollectionOperationsChanged();
}

function clearActiveSyncRun(options: SyncBrowserCollectionOptions) {
  const activeRun = activeSyncRunsByCollection[options.collectionKey];
  if (!activeRun || activeRun.syncRunId !== options.syncRunId) return;
  delete activeSyncRunsByCollection[options.collectionKey];
  notifyBrowserSyncLocksChanged();
  notifyPendingCollectionOperationsChanged();
}

function syncRunForCollection(collectionKey: CollectionKey): ActiveSyncRun | null {
  return activeSyncRunsByCollection[collectionKey] || null;
}

function activeSyncRunsState() {
  const runs: Partial<Record<CollectionKey, { mode: SyncMode; syncRunId: string }>> = {};

  for (const key of Object.keys(activeSyncRunsByCollection) as CollectionKey[]) {
    const activeRun = activeSyncRunsByCollection[key];
    if (activeRun) runs[key] = { mode: activeRun.mode, syncRunId: activeRun.syncRunId };
  }

  return { runs: runs };
}

function pendingCollectionOperationsState(): PendingCollectionOperationOverlayState {
  const collections: Partial<Record<CollectionKey, PendingCollectionOperationOverlay[]>> = {};
  const keys = Object.keys(activeSyncRunsByCollection) as CollectionKey[];

  for (let i = 0; i < keys.length; i++) {
    const collectionKey = keys[i];
    const activeRun = activeSyncRunsByCollection[collectionKey];
    if (!activeRun) continue;

    const latestByUrl: Record<string, PendingCollectionOperationOverlay> = {};
    const operations = getDatabase().listDeferredSyncOutboxOperations(collectionKey);

    for (let n = 0; n < operations.length; n++) {
      const operation = operations[n];
      latestByUrl[operation.videoUrl] = {
        action: operation.action,
        videoUrl: operation.videoUrl,
        remoteVideoId: operation.remoteVideoId,
        remoteFavType: operation.remoteFavType
      };
    }

    collections[collectionKey] = Object.keys(latestByUrl).map(function (url) {
      return latestByUrl[url];
    });
  }

  return { collections: collections };
}

function notifyBrowserSyncLocksChanged() {
  const state = activeSyncRunsState();
  sendToAllBrowserTabs('browser:sync-lock-state', state);
}

function notifyPendingCollectionOperationsChanged() {
  const state = pendingCollectionOperationsState();
  sendToAllBrowserTabs('browser:pending-collection-operations', state);
}

function markActiveSyncMutated(collectionKey: CollectionKey) {
  const activeRun = activeSyncRunsByCollection[collectionKey];
  if (activeRun) activeRun.mutated = true;
}

function resolveSyncWorker(
  workerId: string | null,
  options: SyncBrowserCollectionOptions
): {
  worker: SyncWorker;
  reused: boolean;
} {
  if (!workerId) {
    return {
      worker: createSyncWorker(options.collectionKey, options.syncRunId),
      reused: false
    };
  }

  const worker = syncWorkersById[workerId];
  if (!worker || worker.webContents.isDestroyed()) {
    closeSyncWorker(workerId, 'Sync continuation expired');
    throw new Error('Sync continuation is no longer available');
  }
  if (worker.collectionKey !== options.collectionKey || worker.syncRunId !== options.syncRunId) {
    throw new Error('Sync continuation does not match the requested collection');
  }

  return {
    worker: worker,
    reused: true
  };
}

function notifySyncQueueProgress(options: SyncBrowserCollectionOptions, payload: SyncQueueProgressInput) {
  forwardBrowserMessage(
    'sync-queue-progress',
    Object.assign(
      {
        collectionKey: options.collectionKey,
        mode: options.mode,
        syncRunId: options.syncRunId
      },
      payload
    )
  );
}

async function applyDeferredSyncOperationsInWorker(
  worker: SyncWorker,
  options: SyncBrowserCollectionOptions
): Promise<{ applied: number; failed: number; failures: SyncQueuedOperationFailure[] }> {
  const operations = getDatabase().listDeferredSyncOutboxOperations(options.collectionKey);
  if (!operations.length) return { applied: 0, failed: 0, failures: [] };
  let applied = 0;
  const failures: SyncQueuedOperationFailure[] = [];

  notifySyncQueueProgress(options, {
    phase: 'start',
    total: operations.length,
    processed: 0,
    applied: 0,
    failed: 0
  });

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    const result = await requestWebContentsPreload<DeferredSyncOperationApplyResult>(
      worker.webContents,
      'browser:apply-deferred-sync-operations-request',
      { operations: [operation] },
      BROWSER_SYNC_REQUEST_TIMEOUT_MS
    );
    const normalized = (result || {}) as DeferredSyncOperationApplyResult;
    const appliedIds = Array.isArray(normalized.applied) ? normalized.applied : [];
    const failedRows = Array.isArray(normalized.failed) ? normalized.failed : [];
    const failedRow =
      failedRows.find(function (row) {
        return !row.blocked;
      }) || failedRows[0];

    if (failedRow) {
      getDatabase().markDeferredSyncOperationFailed(
        options.collectionKey,
        null,
        failedRow.id || operation.id,
        failedRow.message
      );
      failures.push(failedRow);

      for (let blocked = i + 1; blocked < operations.length; blocked++) {
        failures.push({
          id: operations[blocked].id,
          url: operations[blocked].videoUrl,
          message: 'Blocked by earlier failed operation',
          blocked: true
        });
      }

      notifyPendingCollectionOperationsChanged();
      notifySyncQueueProgress(options, {
        phase: 'complete',
        total: operations.length,
        processed: operations.length,
        applied: applied,
        failed: failures.length
      });
      return { applied: applied, failed: failures.length, failures: failures };
    }

    applied += getDatabase().markDeferredSyncOperationsApplied(options.collectionKey, null, appliedIds);
    notifyPendingCollectionOperationsChanged();
    notifySyncQueueProgress(options, {
      phase: i + 1 === operations.length ? 'complete' : 'progress',
      total: operations.length,
      processed: i + 1,
      applied: applied,
      failed: 0
    });
  }

  return { applied: applied, failed: 0, failures: [] };
}

async function applyPendingRemoteOperationGroup(
  groupId: string,
  action: CollectionAction
): Promise<PendingRemoteOperationActionResult> {
  const operation = getDatabase().preparePendingRemoteOperationRetry(groupId);
  const worker = createSyncWorker(operation.collectionKey, 'pending-remote-retry:' + Date.now());

  try {
    const loadedUrl = await loadSyncWorkerCollection(worker);
    if (!urlPolicy.isJableCollectionUrl(operation.collectionKey, loadedUrl)) {
      throw new Error(t('status.loginRequired', { collection: t('collections.' + operation.collectionKey) }));
    }

    const result = await requestWebContentsPreload<DeferredSyncOperationApplyResult>(
      worker.webContents,
      'browser:apply-deferred-sync-operations-request',
      {
        operations: [
          {
            id: operation.id || 0,
            action: action,
            videoUrl: operation.videoUrl,
            remoteVideoId: operation.remoteVideoId || null,
            remoteFavType: operation.remoteFavType || null
          }
        ]
      },
      BROWSER_SYNC_REQUEST_TIMEOUT_MS
    );
    const normalized = (result || {}) as DeferredSyncOperationApplyResult;
    const failed = Array.isArray(normalized.failed) ? normalized.failed[0] : null;

    if (failed) {
      getDatabase().markPendingRemoteOperationGroupFailed(groupId, failed.message);
      notifyPendingCollectionOperationsChanged();
      return Object.assign({}, operation, {
        resolved: false,
        error: failed.message || t('status.unknownError')
      });
    }

    if (action === 'remove') {
      getDatabase().markPendingRemoteOperationGroupRemoved(groupId);
    } else {
      getDatabase().markPendingRemoteOperationGroupAdded(groupId);
    }
    notifyPendingCollectionOperationsChanged();
    return Object.assign({}, operation, { resolved: true, error: null });
  } catch (error) {
    const message = mainErrorMessage(error);
    getDatabase().markPendingRemoteOperationGroupFailed(groupId, message);
    notifyPendingCollectionOperationsChanged();
    return Object.assign({}, operation, { resolved: false, error: message });
  } finally {
    closeSyncWorker(worker.id, 'Pending remote retry finished');
  }
}

async function addPendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult> {
  return applyPendingRemoteOperationGroup(groupId, 'add');
}

async function removePendingRemoteOperationGroup(groupId: string): Promise<PendingRemoteOperationActionResult> {
  return applyPendingRemoteOperationGroup(groupId, 'remove');
}

function resolvePendingRemoteOperationGroup(groupId: string): PendingRemoteOperationActionResult {
  const operation = getDatabase().preparePendingRemoteOperationRetry(groupId);
  const resolved = getDatabase().markPendingRemoteOperationGroupResolved(groupId);
  notifyPendingCollectionOperationsChanged();
  return Object.assign({}, operation, { resolved: resolved, error: null });
}

function shouldApplyDeferredSyncOperations(result: SyncResult) {
  if (result.incompleteReason === 'login-required') return false;
  if (result.incompleteReason === 'batch-limit') return false;
  return true;
}

async function syncBrowserCollectionInWorker(payload: {
  tabId: string | null;
  options: SyncBrowserCollectionOptions;
}): Promise<SyncResult> {
  const resolved = resolveSyncWorker(payload.tabId, payload.options);
  const worker = resolved.worker;
  let keepWorker = false;

  setActiveSyncRun(payload.options);

  try {
    if (!resolved.reused) {
      const loadedUrl = await loadSyncWorkerCollection(worker);
      if (!urlPolicy.isJableCollectionUrl(payload.options.collectionKey, loadedUrl)) {
        return syncIncompleteResult(payload.options, 'login-required', worker.id);
      }
    }

    const result = await requestWebContentsPreload<SyncResult>(
      worker.webContents,
      'browser:sync-collection-request',
      { options: payload.options },
      BROWSER_SYNC_REQUEST_TIMEOUT_MS
    );
    const activeRun = syncRunForCollection(payload.options.collectionKey);
    const resultWithWorker = Object.assign({}, result, { syncWorkerId: worker.id });

    if (payload.options.mode === 'full' && activeRun && activeRun.mutated) {
      resultWithWorker.completed = false;
      resultWithWorker.incompleteReason = 'collection-mutated-during-sync';
    }

    keepWorker = resultWithWorker.completed === false && resultWithWorker.incompleteReason === 'batch-limit';

    if (!keepWorker && shouldApplyDeferredSyncOperations(resultWithWorker) && getAutoReplayDeferredSyncOperations()) {
      const applied = await applyDeferredSyncOperationsInWorker(worker, payload.options);
      resultWithWorker.queuedOperationsApplied = applied.applied;
      resultWithWorker.queuedOperationsFailed = applied.failed;
      resultWithWorker.queuedOperationFailures = applied.failures;
    } else if (!keepWorker && shouldApplyDeferredSyncOperations(resultWithWorker)) {
      const skipped = getDatabase().listDeferredSyncOutboxOperations(payload.options.collectionKey).length;
      resultWithWorker.queuedOperationsSkipped = skipped;
      if (skipped) notifyPendingCollectionOperationsChanged();
    }

    return resultWithWorker;
  } finally {
    if (!keepWorker) clearActiveSyncRun(payload.options);
    if (!keepWorker) closeSyncWorker(worker.id, 'Sync worker finished');
  }
}

export function createSyncWorkerManager(context: SyncWorkerManagerContext): SyncWorkerManager {
  activateFallbackOrigin = context.activateFallbackOrigin;
  browserTabWebPreferences = context.browserTabWebPreferences;
  BrowserWindow = context.BrowserWindow;
  fallbackUrlForLoadFailure = context.fallbackUrlForLoadFailure;
  forwardBrowserMessage = context.forwardBrowserMessage;
  getActiveJableOrigin = context.getActiveJableOrigin;
  getAutoReplayDeferredSyncOperations = context.getAutoReplayDeferredSyncOperations;
  getDatabase = context.getDatabase;
  rejectPreloadRequestsForWebContents = context.rejectPreloadRequestsForWebContents;
  requestWebContentsPreload = context.requestWebContentsPreload;
  sendToAllBrowserTabs = context.sendToAllBrowserTabs;
  sessionPartition = context.sessionPartition;
  shouldDenyWebViewEnhancementNavigation = context.shouldDenyWebViewEnhancementNavigation;
  translate = context.t;
  webviewPreloadPath = context.webviewPreloadPath;

  return {
    activeRunForCollection: syncRunForCollection,
    activeSyncRunsState: activeSyncRunsState,
    addPendingRemoteOperationGroup: addPendingRemoteOperationGroup,
    closeAllWorkers: closeAllSyncWorkers,
    markActiveSyncMutated: markActiveSyncMutated,
    notifyPendingCollectionOperationsChanged: notifyPendingCollectionOperationsChanged,
    pendingCollectionOperationsState: pendingCollectionOperationsState,
    removePendingRemoteOperationGroup: removePendingRemoteOperationGroup,
    resolvePendingRemoteOperationGroup: resolvePendingRemoteOperationGroup,
    syncBrowserCollection: syncBrowserCollectionInWorker
  };
}
