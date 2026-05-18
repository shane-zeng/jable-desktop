'use strict';

import type {
  BrowserBounds,
  BrowserNavigatePayload,
  BrowserTabLockedPayload,
  BrowserTabMenuPayload,
  BrowserTabMutedPayload,
  BrowserTabPayload,
  CollectionKey,
  CollectionDownloadFilter,
  CreateBrowserTabPayload,
  ExportResource,
  FinishSyncPayload,
  ImportJsonPayload,
  LibraryVideoMenuPayload,
  ListVideosOptions,
  SearchMode,
  SortDirection,
  SortKey,
  SyncBrowserCollectionOptions,
  SyncMode,
  SyncPagePayload,
  VideoMetadataRefreshPayload
} from '../types/jable';
import * as urlPolicy from '../browser/url-policy';

export type CollectionTogglePayload = {
  collectionKey?: CollectionKey;
  action?: unknown;
  syncRunId?: unknown;
  deferRemote?: unknown;
  deferLocal?: unknown;
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

export function ipcPayloadError(channel: string, field?: string): Error {
  return new Error('Invalid IPC payload for ' + channel + (field ? ': ' + field : ''));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalRecord(value: unknown, channel: string): Record<string, unknown> {
  if (value === null || typeof value === 'undefined') return {};
  if (isRecord(value)) return value;
  throw ipcPayloadError(channel);
}

export function requiredRecord(value: unknown, channel: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw ipcPayloadError(channel);
}

export function optionalStringField(
  record: Record<string, unknown>,
  field: string,
  channel: string
): string | undefined {
  const value = record[field];
  if (value === null || typeof value === 'undefined') return undefined;
  if (typeof value === 'string') return value;
  throw ipcPayloadError(channel, field);
}

export function requiredStringValue(value: unknown, field: string, channel: string): string {
  if (typeof value === 'string') return value;
  throw ipcPayloadError(channel, field);
}

export function optionalBooleanField(
  record: Record<string, unknown>,
  field: string,
  channel: string
): boolean | undefined {
  const value = record[field];
  if (value === null || typeof value === 'undefined') return undefined;
  if (typeof value === 'boolean') return value;
  throw ipcPayloadError(channel, field);
}

function optionalNumberField(record: Record<string, unknown>, field: string, channel: string): number | undefined {
  const value = record[field];
  if (value === null || typeof value === 'undefined') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw ipcPayloadError(channel, field);
}

function nullableNumberField(record: Record<string, unknown>, field: string, channel: string): number | null {
  const value = record[field];
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw ipcPayloadError(channel, field);
}

export function normalizeCollectionKey(value: unknown, channel = 'collection'): CollectionKey {
  if (value === 'favourites' || value === 'watch_later') return value;
  throw ipcPayloadError(channel, 'collectionKey');
}

export function normalizeTabIdValue(value: unknown, channel: string): string | null {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'string') return value;
  throw ipcPayloadError(channel, 'tabId');
}

export function normalizeBrowserTabPayload(payload: unknown, channel: string): BrowserTabPayload {
  const record = optionalRecord(payload, channel);
  return {
    tabId: normalizeTabIdValue(record.tabId, channel)
  };
}

export function normalizeSearchMode(value: unknown, channel: string): SearchMode | undefined {
  if (value === null || typeof value === 'undefined') return undefined;
  if (value === 'any' || value === 'all' || value === 'phrase') return value;
  throw ipcPayloadError(channel, 'searchMode');
}

export function normalizeCollectionDownloadFilter(
  value: unknown,
  channel: string
): CollectionDownloadFilter | undefined {
  if (value === null || typeof value === 'undefined') return undefined;
  if (value === 'all' || value === 'downloadable') return value;
  throw ipcPayloadError(channel, 'downloadFilter');
}

export function normalizeSortKey(value: unknown, channel: string): SortKey | undefined {
  if (value === null || typeof value === 'undefined') return undefined;
  if (value === 'site_order' || value === 'title' || value === 'views' || value === 'likes') return value;
  throw ipcPayloadError(channel, 'sort');
}

export function normalizeSortDirection(value: unknown, channel: string): SortDirection | undefined {
  if (value === null || typeof value === 'undefined') return undefined;
  if (value === 'asc' || value === 'desc') return value;
  throw ipcPayloadError(channel, 'direction');
}

export function normalizeSyncMode(value: unknown, channel: string): SyncMode {
  if (value === 'quick' || value === 'full') return value;
  throw ipcPayloadError(channel, 'mode');
}

export function normalizeListVideosOptions(payload: unknown, channel: string): ListVideosOptions {
  const record = requiredRecord(payload, channel);
  const options: ListVideosOptions = {
    collectionKey: normalizeCollectionKey(record.collectionKey, channel)
  };
  const search = optionalStringField(record, 'search', channel);
  const searchMode = normalizeSearchMode(record.searchMode, channel);
  const downloadFilter = normalizeCollectionDownloadFilter(record.downloadFilter, channel);
  const sort = normalizeSortKey(record.sort, channel);
  const direction = normalizeSortDirection(record.direction, channel);
  const includeHidden = optionalBooleanField(record, 'includeHidden', channel);
  const limit = optionalNumberField(record, 'limit', channel);
  const offset = optionalNumberField(record, 'offset', channel);

  if (typeof search !== 'undefined') options.search = search;
  if (typeof searchMode !== 'undefined') options.searchMode = searchMode;
  if (typeof downloadFilter !== 'undefined') options.downloadFilter = downloadFilter;
  if (typeof sort !== 'undefined') options.sort = sort;
  if (typeof direction !== 'undefined') options.direction = direction;
  if (typeof includeHidden !== 'undefined') options.includeHidden = includeHidden;
  if (typeof limit !== 'undefined') options.limit = limit;
  if (typeof offset !== 'undefined') options.offset = offset;

  return options;
}

export function normalizeCollectionUrlsKnownPayload(payload: unknown) {
  const channel = 'db:collection-urls-known';
  const record = requiredRecord(payload, channel);

  if (!Array.isArray(record.urls)) throw ipcPayloadError(channel, 'urls');

  return {
    collectionKey: normalizeCollectionKey(record.collectionKey, channel),
    urls: record.urls
  };
}

export function normalizeSyncPagePayload(payload: unknown): SyncPagePayload {
  const channel = 'db:save-sync-page';
  const record = requiredRecord(payload, channel);
  const page = optionalNumberField(record, 'page', channel);
  const rows = record.rows;

  if (typeof page === 'undefined') throw ipcPayloadError(channel, 'page');
  if (!Array.isArray(rows)) throw ipcPayloadError(channel, 'rows');

  return {
    tabId: normalizeTabIdValue(record.tabId, channel),
    collectionKey: normalizeCollectionKey(record.collectionKey, channel),
    mode: normalizeSyncMode(record.mode, channel),
    syncRunId: requiredStringValue(record.syncRunId, 'syncRunId', channel),
    page: page,
    rows: rows as SyncPagePayload['rows'],
    url: requiredStringValue(record.url, 'url', channel)
  };
}

export function normalizeCollectionTogglePayload(payload: unknown): CollectionTogglePayload {
  const channel = 'db:apply-collection-toggle';
  const record = requiredRecord(payload, channel);
  return Object.assign({}, record, {
    collectionKey: normalizeCollectionKey(record.collectionKey, channel)
  });
}

export function normalizeVideoMetadataRefreshPayload(payload: unknown): VideoMetadataRefreshPayload {
  const channel = 'db:refresh-video-metadata';
  const record = requiredRecord(payload, channel);
  const url = urlPolicy.canonicalJableVideoUrl(record.url);

  if (!url) throw ipcPayloadError(channel, 'url');

  return {
    title: optionalStringField(record, 'title', channel) || null,
    url: url,
    views: optionalNumberField(record, 'views', channel) ?? null,
    likes: optionalNumberField(record, 'likes', channel) ?? null,
    img: optionalStringField(record, 'img', channel) || null,
    preview: optionalStringField(record, 'preview', channel) || null
  };
}

function normalizeSyncResultPayload(value: unknown, channel: string): FinishSyncPayload['result'] {
  const record = requiredRecord(value, channel + '.result');
  return {
    completed: optionalBooleanField(record, 'completed', channel) !== false,
    mode: normalizeSyncMode(record.mode, channel),
    syncRunId: requiredStringValue(record.syncRunId, 'syncRunId', channel),
    incompleteReason: optionalStringField(record, 'incompleteReason', channel) || null,
    stoppedByKnownPage: optionalBooleanField(record, 'stoppedByKnownPage', channel) || false,
    totalPages: optionalNumberField(record, 'totalPages', channel) || 0,
    totalRows: optionalNumberField(record, 'totalRows', channel) || 0,
    lastScrapedPage: nullableNumberField(record, 'lastScrapedPage', channel),
    lastKnownUrl: optionalStringField(record, 'lastKnownUrl', channel) || null,
    ajaxFallbackReason: optionalStringField(record, 'ajaxFallbackReason', channel) || null,
    ajaxRetryCount: optionalNumberField(record, 'ajaxRetryCount', channel) || 0,
    queuedOperationsApplied: optionalNumberField(record, 'queuedOperationsApplied', channel) || 0,
    queuedOperationsFailed: optionalNumberField(record, 'queuedOperationsFailed', channel) || 0,
    queuedOperationsSkipped: optionalNumberField(record, 'queuedOperationsSkipped', channel) || 0
  };
}

export function normalizeFinishSyncPayload(payload: unknown): FinishSyncPayload {
  const channel = 'db:finish-sync';
  const record = requiredRecord(payload, channel);
  return {
    collectionKey: normalizeCollectionKey(record.collectionKey, channel),
    mode: normalizeSyncMode(record.mode, channel),
    syncRunId: requiredStringValue(record.syncRunId, 'syncRunId', channel),
    result: normalizeSyncResultPayload(record.result, channel)
  };
}

export function normalizeImportJsonPayload(payload: unknown): ImportJsonPayload {
  const channel = 'db:import-json';
  const record = requiredRecord(payload, channel);
  return {
    collectionKey: normalizeCollectionKey(record.collectionKey, channel),
    resource: requiredRecord(record.resource, channel + '.resource') as unknown as ExportResource
  };
}

export function normalizeCreateBrowserTabPayload(payload: unknown): CreateBrowserTabPayload {
  const channel = 'browser:create-tab';
  const record = optionalRecord(payload, channel);
  const normalized: CreateBrowserTabPayload = {};
  const url = optionalStringField(record, 'url', channel);
  const title = optionalStringField(record, 'title', channel);
  const favicon = optionalStringField(record, 'favicon', channel);
  const openerTabId = optionalStringField(record, 'openerTabId', channel);
  const active = optionalBooleanField(record, 'active', channel);
  const locked = optionalBooleanField(record, 'locked', channel);
  const muted = optionalBooleanField(record, 'muted', channel);
  const forceReload = optionalBooleanField(record, 'forceReload', channel);

  if (record.kind === 'normal' || record.kind === 'sync') normalized.kind = record.kind;
  else if (typeof record.kind !== 'undefined' && record.kind !== null) throw ipcPayloadError(channel, 'kind');

  if (typeof url !== 'undefined') normalized.url = url;
  if (typeof title !== 'undefined') normalized.title = title;
  if (typeof favicon !== 'undefined') normalized.favicon = favicon;
  if (typeof openerTabId !== 'undefined') normalized.openerTabId = openerTabId;
  if (typeof active !== 'undefined') normalized.active = active;
  if (typeof locked !== 'undefined') normalized.locked = locked;
  if (typeof muted !== 'undefined') normalized.muted = muted;
  if (typeof forceReload !== 'undefined') normalized.forceReload = forceReload;

  return normalized;
}

export function normalizeBrowserTabLockedPayload(payload: unknown): BrowserTabLockedPayload {
  const channel = 'browser:set-tab-locked';
  const record = optionalRecord(payload, channel);
  return {
    tabId: normalizeTabIdValue(record.tabId, channel),
    locked: optionalBooleanField(record, 'locked', channel) || false
  };
}

export function normalizeBrowserTabMutedPayload(payload: unknown): BrowserTabMutedPayload {
  const channel = 'browser:set-tab-muted';
  const record = optionalRecord(payload, channel);
  return {
    tabId: normalizeTabIdValue(record.tabId, channel),
    muted: optionalBooleanField(record, 'muted', channel) || false
  };
}

export function normalizeBrowserBounds(payload: unknown): BrowserBounds {
  const channel = 'browser:set-bounds';
  const record = requiredRecord(payload, channel);
  const visible = optionalBooleanField(record, 'visible', channel);

  if (visible === false) return { visible: false };

  return {
    visible: true,
    x: optionalNumberField(record, 'x', channel) || 0,
    y: optionalNumberField(record, 'y', channel) || 0,
    width: optionalNumberField(record, 'width', channel) || 0,
    height: optionalNumberField(record, 'height', channel) || 0
  };
}

export function normalizeBrowserNavigatePayload(payload: unknown): BrowserNavigatePayload {
  const channel = 'browser:navigate';
  const record = optionalRecord(payload, channel);
  return {
    tabId: normalizeTabIdValue(record.tabId, channel),
    url: optionalStringField(record, 'url', channel) || '',
    forceReload: optionalBooleanField(record, 'forceReload', channel) || false
  };
}

export function normalizeBrowserTabMenuPayload(payload: unknown): BrowserTabMenuPayload {
  const channel = 'browser:show-tab-menu';
  const record = optionalRecord(payload, channel);
  const normalized: BrowserTabMenuPayload = {
    tabId: normalizeTabIdValue(record.tabId, channel)
  };
  const x = optionalNumberField(record, 'x', channel);
  const y = optionalNumberField(record, 'y', channel);
  const compactMode = optionalBooleanField(record, 'compactMode', channel);

  if (typeof x !== 'undefined') normalized.x = x;
  if (typeof y !== 'undefined') normalized.y = y;
  if (typeof compactMode !== 'undefined') normalized.compactMode = compactMode;

  return normalized;
}

export function normalizeLibraryVideoMenuPayload(payload: unknown): LibraryVideoMenuPayload {
  const channel = 'library:show-video-menu';
  const record = optionalRecord(payload, channel);
  const normalized: LibraryVideoMenuPayload = {
    url: optionalStringField(record, 'url', channel) || ''
  };
  const title = optionalStringField(record, 'title', channel);
  const x = optionalNumberField(record, 'x', channel);
  const y = optionalNumberField(record, 'y', channel);

  if (typeof title !== 'undefined') normalized.title = title;
  if (typeof x !== 'undefined') normalized.x = x;
  if (typeof y !== 'undefined') normalized.y = y;

  return normalized;
}

export function normalizeBrowserSyncCollectionPayload(payload: unknown): {
  tabId: string | null;
  options: SyncBrowserCollectionOptions;
} {
  const channel = 'browser:sync-collection';
  const record = requiredRecord(payload, channel);
  const rawOptions = isRecord(record.options) ? record.options : record;

  return {
    tabId: normalizeTabIdValue(record.tabId, channel),
    options: {
      collectionKey: normalizeCollectionKey(rawOptions.collectionKey, channel),
      mode: normalizeSyncMode(rawOptions.mode, channel),
      syncRunId: requiredStringValue(rawOptions.syncRunId, 'syncRunId', channel),
      siteOrderOffset: optionalNumberField(rawOptions, 'siteOrderOffset', channel) || 0,
      startPage: nullableNumberField(rawOptions, 'startPage', channel),
      stopOnKnownPage: optionalBooleanField(rawOptions, 'stopOnKnownPage', channel) || false,
      batchLimit: nullableNumberField(rawOptions, 'batchLimit', channel)
    }
  };
}
