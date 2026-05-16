'use strict';

import type {
  CollectionKey,
  CollectionToggleResult,
  ExportResource,
  FinishSyncPayload,
  ListVideosOptions,
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
  JableDatabase: new (filePath: string) => DataEngine;
};

const databaseModule = require('./database') as DatabaseModule;

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

export function createDataEngine(filePath: string): DataEngine {
  return new databaseModule.JableDatabase(filePath);
}
