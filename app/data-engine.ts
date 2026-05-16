'use strict';

import type {
  CollectionKey,
  CollectionToggleResult,
  ExportResource,
  FinishSyncPayload,
  ListVideosOptions,
  PendingRemoteOperationGroup,
  PendingRemoteOperationRetryResult,
  SyncPagePayload,
  SyncState,
  VideoRow
} from './types/jable';

type DatabaseCollection = { key: CollectionKey; name: string; sourcePath: string };
type DatabaseListOptions = Partial<ListVideosOptions> & {
  sort?: ListVideosOptions['sort'] | 'updated_at' | 'last_seen_at';
};
type CollectionTogglePayload = {
  collectionKey?: CollectionKey;
  action?: unknown;
  syncRunId?: unknown;
  deferRemote?: unknown;
  remoteVideoId?: unknown;
  remoteFavType?: unknown;
  sourceUrl?: unknown;
  video?: unknown;
  url?: unknown;
  title?: unknown;
  views?: unknown;
  likes?: unknown;
  img?: unknown;
  preview?: unknown;
  siteOrder?: unknown;
  site_order?: unknown;
  sort_order?: unknown;
};
type DeferredSyncOperation = {
  id: number;
  action: 'add' | 'remove';
  videoUrl: string;
  remoteVideoId: string | null;
  remoteFavType: string | null;
};
type DatabaseModule = {
  COLLECTIONS: DatabaseCollection[];
  /**
   * @deprecated Use `createDataEngine()` without `JABLE_DATA_ENGINE=ts` for the Rust data engine.
   */
  JableDatabase: new (filePath: string) => DataEngine;
};
type NativeDataEngineModule = {
  loadNativeDataEngine(): {
    JableDataEngine: new (filePath: string) => {
      call(method: string, payload: string): string;
      close(): void;
    };
  };
};

const databaseModule = require('./database') as DatabaseModule;
const nativeDataEngine = require('./native-data-engine') as NativeDataEngineModule;

export type DataEngine = {
  close(): void;
  listVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): VideoRow[];
  countVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): number;
  getCollectionUrls(collectionKey: CollectionKey): string[];
  allCollectionUrlsKnown(collectionKey: CollectionKey, urls?: unknown[] | null): boolean;
  saveSyncPage(payload: SyncPagePayload): { saved: number; collectionKey: CollectionKey; page: number | null };
  applyCollectionToggle(payload?: CollectionTogglePayload | null): CollectionToggleResult;
  listDeferredSyncOperations(collectionKey: CollectionKey, syncRunId: string | null): DeferredSyncOperation[];
  listDeferredSyncOutboxOperations(collectionKey: CollectionKey): DeferredSyncOperation[];
  markDeferredSyncOperationsApplied(collectionKey: CollectionKey, syncRunId: string | null, ids: unknown[]): number;
  markDeferredSyncOperationFailed(
    collectionKey: CollectionKey,
    syncRunId: string | null,
    id: unknown,
    message: unknown
  ): boolean;
  listPendingRemoteOperationGroups(): PendingRemoteOperationGroup[];
  preparePendingRemoteOperationRetry(groupId: string): PendingRemoteOperationRetryResult;
  markPendingRemoteOperationGroupResolved(groupId: string): boolean;
  markPendingRemoteOperationGroupFailed(groupId: string, message: unknown): boolean;
  finishSync(payload: FinishSyncPayload): SyncState;
  clearSyncState(collectionKey: CollectionKey): { collectionKey: CollectionKey; cleared: boolean };
  importResource(
    collectionKey: CollectionKey,
    resource: ExportResource
  ): { imported: number; collectionKey: CollectionKey };
  exportResource(collectionKey: CollectionKey): ExportResource;
  exportResourceToFile(collectionKey: CollectionKey, filePath: string): Promise<{ filePath: string; total: number }>;
};

export const COLLECTIONS = databaseModule.COLLECTIONS;

class RustDataEngine implements DataEngine {
  native: {
    call(method: string, payload: string): string;
    close(): void;
  };

  constructor(filePath: string) {
    const nativeModule = nativeDataEngine.loadNativeDataEngine();
    this.native = new nativeModule.JableDataEngine(filePath);
  }

  callNative<T>(method: string, payload: unknown): T {
    return JSON.parse(this.native.call(method, JSON.stringify(payload === undefined ? null : payload))) as T;
  }

  close() {
    this.native.close();
  }

  listVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): VideoRow[] {
    return this.callNative('listVideos', Object.assign({}, options || {}, { collectionKey: collectionKey }));
  }

  countVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): number {
    return this.callNative('countVideos', Object.assign({}, options || {}, { collectionKey: collectionKey }));
  }

  getCollectionUrls(collectionKey: CollectionKey): string[] {
    return this.callNative('getCollectionUrls', collectionKey);
  }

  allCollectionUrlsKnown(collectionKey: CollectionKey, urls?: unknown[] | null): boolean {
    return this.callNative('allCollectionUrlsKnown', { collectionKey: collectionKey, urls: urls || [] });
  }

  saveSyncPage(payload: SyncPagePayload): { saved: number; collectionKey: CollectionKey; page: number | null } {
    return this.callNative('saveSyncPage', payload);
  }

  applyCollectionToggle(payload?: CollectionTogglePayload | null): CollectionToggleResult {
    return this.callNative('applyCollectionToggle', payload || {});
  }

  listDeferredSyncOperations(collectionKey: CollectionKey, syncRunId: string | null): DeferredSyncOperation[] {
    return this.callNative('listDeferredSyncOperations', { collectionKey: collectionKey, syncRunId: syncRunId });
  }

  listDeferredSyncOutboxOperations(collectionKey: CollectionKey): DeferredSyncOperation[] {
    return this.callNative('listDeferredSyncOutboxOperations', { collectionKey: collectionKey });
  }

  markDeferredSyncOperationsApplied(collectionKey: CollectionKey, syncRunId: string | null, ids: unknown[]): number {
    return this.callNative('markDeferredSyncOperationsApplied', {
      collectionKey: collectionKey,
      syncRunId: syncRunId,
      ids: ids
    });
  }

  markDeferredSyncOperationFailed(
    collectionKey: CollectionKey,
    syncRunId: string | null,
    id: unknown,
    message: unknown
  ): boolean {
    return this.callNative('markDeferredSyncOperationFailed', {
      collectionKey: collectionKey,
      syncRunId: syncRunId,
      id: id,
      message: message
    });
  }

  listPendingRemoteOperationGroups(): PendingRemoteOperationGroup[] {
    return this.callNative('listPendingRemoteOperationGroups', {});
  }

  preparePendingRemoteOperationRetry(groupId: string): PendingRemoteOperationRetryResult {
    return this.callNative('preparePendingRemoteOperationRetry', { groupId: groupId });
  }

  markPendingRemoteOperationGroupResolved(groupId: string): boolean {
    return this.callNative('markPendingRemoteOperationGroupResolved', { groupId: groupId });
  }

  markPendingRemoteOperationGroupFailed(groupId: string, message: unknown): boolean {
    return this.callNative('markPendingRemoteOperationGroupFailed', { groupId: groupId, message: message });
  }

  finishSync(payload: FinishSyncPayload): SyncState {
    return this.callNative('finishSync', payload);
  }

  clearSyncState(collectionKey: CollectionKey): { collectionKey: CollectionKey; cleared: boolean } {
    return this.callNative('clearSyncState', collectionKey);
  }

  importResource(
    collectionKey: CollectionKey,
    resource: ExportResource
  ): { imported: number; collectionKey: CollectionKey } {
    return this.callNative('importResource', { collectionKey: collectionKey, resource: resource });
  }

  exportResource(collectionKey: CollectionKey): ExportResource {
    return this.callNative('exportResource', collectionKey);
  }

  exportResourceToFile(collectionKey: CollectionKey, filePath: string): Promise<{ filePath: string; total: number }> {
    return Promise.resolve(
      this.callNative('exportResourceToFile', { collectionKey: collectionKey, filePath: filePath })
    );
  }
}

export function createDataEngine(filePath: string): DataEngine {
  if (process.env.JABLE_DATA_ENGINE === 'ts') return new databaseModule.JableDatabase(filePath);
  return new RustDataEngine(filePath);
}
