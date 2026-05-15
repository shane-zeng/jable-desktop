'use strict';

import type { FileHandle } from 'node:fs/promises';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type * as NodeSqlite from 'node:sqlite';
import type { DatabaseSync as DatabaseSyncInstance, SQLInputValue } from 'node:sqlite';
import type {
  CollectionKey,
  ExportPage,
  ExportResource,
  ExportVideoRow,
  ListVideosOptions,
  SearchMode,
  SyncState,
  VideoRow
} from './types/jable';

type DatabaseCollection = { key: CollectionKey; name: string; sourcePath: string };
type VideoInput = {
  [key: string]: unknown;
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
type NormalizedVideo = {
  url: string;
  title: string | null;
  views: number | null;
  likes: number | null;
  img: string | null;
  preview: string | null;
  siteOrder: number | null;
  searchText: string;
};
type ImportResource = { data?: unknown[]; meta?: { completed?: unknown; last_scraped_page?: unknown } };
type SaveSyncPagePayload = { collectionKey: CollectionKey; page?: unknown; syncRunId?: unknown; rows?: unknown[] };
type CollectionTogglePayload = VideoInput & {
  collectionKey?: CollectionKey;
  action?: unknown;
  video?: VideoInput;
  syncRunId?: unknown;
  deferRemote?: unknown;
  remoteVideoId?: unknown;
  remoteFavType?: unknown;
  sourceUrl?: unknown;
};
type SyncResultInput = {
  completed?: unknown;
  lastScrapedPage?: unknown;
  lastKnownUrl?: unknown;
  mode?: unknown;
  syncRunId?: unknown;
};
type FinishSyncInput = {
  collectionKey: CollectionKey;
  mode?: unknown;
  syncRunId?: unknown;
  result?: SyncResultInput;
};
type SyncOperationRow = {
  id: number;
  collection_key: CollectionKey;
  sync_run_id: string;
  action: 'add' | 'remove';
  video_url: string;
  title: string | null;
  views: number | null;
  likes: number | null;
  img: string | null;
  preview: string | null;
  site_order: number | null;
  remote_deferred: number | boolean;
  remote_video_id: string | null;
  remote_fav_type: string | null;
};
type PendingSyncOperation = {
  id: number;
  action: 'add' | 'remove';
  videoUrl: string;
  remoteVideoId: string | null;
  remoteFavType: string | null;
};
type PendingSyncOperationRow = {
  id: number;
  action: 'add' | 'remove';
  video_url: string;
  remote_video_id: string | null;
  remote_fav_type: string | null;
};
type UrlPolicyModule = {
  JABLE_PRIMARY_ORIGIN: string;
  canonicalJableUrl(value: unknown): string;
};
type DatabaseSortKey = NonNullable<ListVideosOptions['sort']> | 'updated_at' | 'last_seen_at';
type DatabaseListOptions = Partial<ListVideosOptions> & { sort?: DatabaseSortKey };
type VideoListQuery = { joins: string[]; params: SQLInputValue[]; where: string; orderBy: string };
type NameRow = { name: string };
type CountRow = { total: number };
type VideoUrlRow = { video_url: string };
type VideoSearchRow = { title: string | null; url: string; search_text?: string | null };
type TableColumnRow = { name: string };

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');
const urlPolicy = require('./url-policy') as UrlPolicyModule;

let DatabaseSync: typeof NodeSqlite.DatabaseSync;
try {
  DatabaseSync = (require('node:sqlite') as typeof NodeSqlite).DatabaseSync;
} catch (error) {
  throw new Error('node:sqlite is required. Use Node.js 24+ or an Electron version that includes node:sqlite.');
}

const PAGE_SIZE = 24;
const EXPORT_BATCH_SIZE = PAGE_SIZE * 100;
const SEARCH_NGRAM_MAX = 3;

const COLLECTIONS: DatabaseCollection[] = [
  { key: 'favourites', name: '影片收藏', sourcePath: '/my/favourites/videos/' },
  { key: 'watch_later', name: '稍後觀看', sourcePath: '/my/favourites/videos-watch-later/' }
];

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {unknown} key
 * @returns {DatabaseCollection | null}
 */
function collectionByKey(key: unknown): DatabaseCollection | null {
  for (let i = 0; i < COLLECTIONS.length; i++) {
    if (COLLECTIONS[i].key === key) return COLLECTIONS[i];
  }

  return null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeNumber(value: unknown): number | null {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeText(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') return null;
  const text = String(value).trim();
  return text || null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeVideoUrl(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;

  try {
    const parsed = new URL(text);
    parsed.search = '';
    parsed.hash = '';
    if (/^\/videos\/[^/]+$/.test(parsed.pathname)) parsed.pathname += '/';
    return urlPolicy.canonicalJableUrl(parsed.href);
  } catch (error) {
    return text;
  }
}

/**
 * @param {VideoInput | null | undefined} row
 * @returns {NormalizedVideo | null}
 */
function normalizeVideo(row: VideoInput | null | undefined): NormalizedVideo | null {
  if (!row || !row.url) return null;
  const url = normalizeVideoUrl(row.url);
  if (!url) return null;

  const video: NormalizedVideo = {
    url: url,
    title: normalizeText(row.title),
    views: normalizeNumber(row.views),
    likes: normalizeNumber(row.likes),
    img: normalizeText(row.img),
    preview: normalizeText(row.preview),
    siteOrder: normalizeNumber(readSiteOrder(row)),
    searchText: ''
  };

  video.searchText = buildVideoSearchText(video.title, video.url);

  return video;
}

/**
 * @param {VideoInput | null | undefined} row
 * @returns {unknown}
 */
function readSiteOrder(row: VideoInput | null | undefined): unknown {
  if (!row) return null;
  if (typeof row.siteOrder !== 'undefined') return row.siteOrder;
  if (typeof row.site_order !== 'undefined') return row.site_order;
  return row.sort_order;
}

/**
 * @param {VideoRow} row
 * @returns {ExportVideoRow}
 */
function exportVideo(row: VideoRow): ExportVideoRow {
  return {
    title: row.title,
    url: row.url,
    views: row.views,
    likes: row.likes,
    img: row.img,
    preview: row.preview,
    site_order: row.site_order ?? null
  };
}

/**
 * @param {VideoRow[]} rows
 * @param {number} pageNumber
 * @param {string} exportedAt
 * @returns {ExportPage}
 */
function exportPage(rows: VideoRow[], pageNumber: number, exportedAt: string): ExportPage {
  const data = rows.map(exportVideo);

  return {
    data: data,
    meta: {
      current_page: pageNumber,
      per_page: PAGE_SIZE,
      count: data.length,
      first_url: data.length ? data[0].url : null,
      last_url: data.length ? data[data.length - 1].url : null,
      exported_at: exportedAt
    }
  };
}

/**
 * @param {DatabaseCollection} collection
 * @param {SyncState | null} state
 * @param {string} exportedAt
 * @param {number} total
 * @param {number} pageCount
 * @returns {ExportResource['meta']}
 */
function exportMeta(
  collection: DatabaseCollection,
  state: SyncState | null,
  exportedAt: string,
  total: number,
  pageCount: number
): ExportResource['meta'] {
  return {
    format_version: 2,
    source_path: collection.sourcePath,
    source_url: urlPolicy.JABLE_PRIMARY_ORIGIN + collection.sourcePath,
    exported_at: exportedAt,
    completed: Boolean(state && state.completed),
    per_page: PAGE_SIZE,
    page_count: pageCount,
    total: total,
    last_page: pageCount ? pageCount : null,
    last_scraped_page: state ? state.last_scraped_page : null
  };
}

/**
 * @param {ImportResource | null | undefined} resource
 * @returns {VideoInput[]}
 */
function flattenResource(resource: ImportResource | null | undefined): VideoInput[] {
  let rows: VideoInput[] = [];
  if (!resource || !Array.isArray(resource.data)) return rows;

  for (let i = 0; i < resource.data.length; i++) {
    const item = resource.data[i];
    if (!item) continue;

    const resourceItem = item as VideoInput & { data?: VideoInput[] };
    if (Array.isArray(resourceItem.data)) rows = rows.concat(resourceItem.data);
    else if (resourceItem.url) rows.push(resourceItem);
  }

  return rows;
}

/**
 * @param {VideoRow[]} rows
 * @returns {ExportPage[]}
 */
function rowsByPage(rows: VideoRow[]): ExportPage[] {
  const pages: ExportPage[] = [];
  const exportedAt = nowIso();

  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    pages.push(exportPage(rows.slice(i, i + PAGE_SIZE), Math.floor(i / PAGE_SIZE) + 1, exportedAt));
  }

  return pages;
}

/**
 * @param {string} char
 * @returns {boolean}
 */
function isCjkSearchChar(char: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);
}

/**
 * @param {string} char
 * @returns {boolean}
 */
function isSearchWordChar(char: string): boolean {
  return /[\p{Letter}\p{Number}]/u.test(char);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function searchRuns(value: unknown): string[] {
  const text = value ? String(value).normalize('NFKC').toLowerCase() : '';
  const runs: string[] = [];
  let current = '';
  let currentType: 'cjk' | 'word' | null = null;

  for (const char of text) {
    let charType: 'cjk' | 'word' | null = null;
    if (isCjkSearchChar(char)) charType = 'cjk';
    else if (isSearchWordChar(char)) charType = 'word';

    if (!charType) {
      if (current) runs.push(current);
      current = '';
      currentType = null;
      continue;
    }

    if (currentType && currentType !== charType) {
      runs.push(current);
      current = '';
    }

    current += char;
    currentType = charType;
  }

  if (current) runs.push(current);
  return runs;
}

/**
 * @param {Record<string, boolean>} tokens
 * @param {string | null | undefined} token
 */
function addSearchToken(tokens: Record<string, boolean>, token: string | null | undefined) {
  if (token) tokens[token] = true;
}

/**
 * @param {Record<string, boolean>} tokens
 * @param {string} run
 */
function addSearchNgrams(tokens: Record<string, boolean>, run: string) {
  const chars = Array.from(run);
  const maxSize = Math.min(SEARCH_NGRAM_MAX, chars.length);

  for (let size = 1; size <= maxSize; size++) {
    for (let i = 0; i <= chars.length - size; i++) {
      addSearchToken(tokens, chars.slice(i, i + size).join(''));
    }
  }
}

/**
 * @param {unknown[]} values
 * @returns {string[]}
 */
function collectSearchTokens(values: unknown[]): string[] {
  const tokens: Record<string, boolean> = {};

  for (let i = 0; i < values.length; i++) {
    const runs = searchRuns(values[i]);
    for (let n = 0; n < runs.length; n++) {
      addSearchNgrams(tokens, runs[n]);
    }
  }

  return Object.keys(tokens);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compactSearchValue(value: unknown): string {
  const text = value ? String(value).normalize('NFKC').toLowerCase() : '';
  let compact = '';

  for (const char of text) {
    if (isCjkSearchChar(char) || isSearchWordChar(char)) compact += char;
  }

  return compact;
}

/**
 * @param {unknown[]} values
 * @returns {string[]}
 */
function collectPhraseTokens(values: unknown[]): string[] {
  const tokens: Record<string, boolean> = {};

  for (let i = 0; i < values.length; i++) {
    const compact = compactSearchValue(values[i]);
    if (compact) addSearchNgrams(tokens, compact);
  }

  return Object.keys(tokens);
}

/**
 * @param {unknown} title
 * @param {unknown} url
 * @returns {string}
 */
function buildVideoSearchText(title: unknown, url: unknown): string {
  const tokens: Record<string, boolean> = {};
  const searchTokens = collectSearchTokens([title, url]);
  const phraseTokens = collectPhraseTokens([title, url]);

  for (let i = 0; i < searchTokens.length; i++) {
    addSearchToken(tokens, searchTokens[i]);
  }

  for (let n = 0; n < phraseTokens.length; n++) {
    addSearchToken(tokens, phraseTokens[n]);
  }

  return Object.keys(tokens).join(' ');
}

function pendingSyncOperationFromRow(row: PendingSyncOperationRow): PendingSyncOperation {
  return {
    id: row.id,
    action: row.action,
    videoUrl: row.video_url,
    remoteVideoId: row.remote_video_id,
    remoteFavType: row.remote_fav_type
  };
}

/**
 * @param {string} run
 * @returns {string[]}
 */
function searchQueryTokensForRun(run: string): string[] {
  const chars = Array.from(run);
  if (chars.length <= SEARCH_NGRAM_MAX) return [run];

  const tokens: string[] = [];
  for (let i = 0; i <= chars.length - SEARCH_NGRAM_MAX; i++) {
    tokens.push(chars.slice(i, i + SEARCH_NGRAM_MAX).join(''));
  }

  return tokens;
}

/**
 * @param {string} token
 * @returns {string}
 */
function quoteFtsToken(token: string): string {
  return '"' + String(token).replace(/"/g, '""') + '"';
}

/**
 * @param {string} run
 * @returns {string}
 */
function buildSearchRunQuery(run: string): string {
  return searchQueryTokensForRun(run).map(quoteFtsToken).join(' AND ');
}

/**
 * @param {string} term
 * @returns {string | null}
 */
function buildSearchTermQuery(term: string): string | null {
  const runs = searchRuns(term);
  const runQueries: string[] = [];

  for (let i = 0; i < runs.length; i++) {
    runQueries.push(buildSearchRunQuery(runs[i]));
  }

  return runQueries.length ? '(' + runQueries.join(' AND ') + ')' : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function buildSearchPhraseQuery(value: unknown): string | null {
  const compact = compactSearchValue(value);
  if (!compact) return null;

  return '(' + searchQueryTokensForRun(compact).map(quoteFtsToken).join(' AND ') + ')';
}

/**
 * @param {unknown} value
 * @param {SearchMode} mode
 * @returns {string | null}
 */
function buildSearchMatchQuery(value: unknown, mode: SearchMode): string | null {
  if (mode === 'phrase') return buildSearchPhraseQuery(value);

  const terms = value ? String(value).trim().split(/\s+/) : [];
  const termQueries: string[] = [];

  for (let i = 0; i < terms.length; i++) {
    const query = buildSearchTermQuery(terms[i]);
    if (query) termQueries.push(query);
  }

  if (!termQueries.length) return null;

  return termQueries.join(mode === 'all' ? ' AND ' : ' OR ');
}

/**
 * @param {CollectionKey} collectionKey
 * @param {DatabaseListOptions | null | undefined} options
 * @returns {VideoListQuery}
 */
function buildVideoListQuery(
  collectionKey: CollectionKey,
  options: DatabaseListOptions | null | undefined
): VideoListQuery {
  const normalizedOptions = options || {};

  const sortMap: Record<DatabaseSortKey, string> = {
    site_order: 'site_order',
    title: 'v.title',
    views: 'v.views',
    likes: 'v.likes',
    updated_at: 'v.updated_at',
    last_seen_at: 'ci.last_seen_at'
  };
  const requestedSort = normalizedOptions.sort;
  const sortKey: DatabaseSortKey = requestedSort && sortMap[requestedSort] ? requestedSort : 'site_order';
  const sort = sortMap[sortKey];
  const direction = normalizedOptions.direction
    ? normalizedOptions.direction === 'asc'
      ? 'ASC'
      : 'DESC'
    : sortKey === 'site_order'
      ? 'ASC'
      : 'DESC';
  const searchMode: SearchMode =
    normalizedOptions.searchMode === 'all' || normalizedOptions.searchMode === 'phrase'
      ? normalizedOptions.searchMode
      : 'any';
  const matchQuery = normalizedOptions.search ? buildSearchMatchQuery(normalizedOptions.search, searchMode) : null;
  const params: SQLInputValue[] = [collectionKey];
  const joins: string[] = [];
  let where = 'WHERE ci.collection_key = ?';

  if (!normalizedOptions.includeHidden) {
    where += ' AND ci.is_visible = 1';
  }

  if (matchQuery) {
    joins.push('JOIN video_search ON video_search.rowid = v.rowid');
    where += ' AND video_search MATCH ?';
    params.push(matchQuery);
  }

  const orderBy =
    sort === 'site_order'
      ? 'ci.site_order IS NULL ASC, ci.site_order ' + direction + ', ci.last_seen_at DESC, v.url ASC'
      : sort + ' ' + direction + ', v.url ASC';

  return {
    joins: joins,
    params: params,
    where: where,
    orderBy: orderBy
  };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeLimit(value: unknown): number | null {
  const number = normalizeNumber(value);
  if (number === null || number <= 0) return null;
  return Math.floor(number);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeOffset(value: unknown): number {
  const number = normalizeNumber(value);
  if (number === null || number <= 0) return 0;
  return Math.floor(number);
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function exportTempPath(filePath: string): string {
  return filePath + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

/**
 * @returns {Promise<void>}
 */
function nextTick(): Promise<void> {
  return new Promise(function (resolve) {
    setImmediate(resolve);
  });
}

/**
 * @param {string} filePath
 */
function ensureDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * @constructor
 * @param {string} filePath
 */
class JableDatabase {
  filePath: string;
  db: DatabaseSyncInstance;

  constructor(filePath: string) {
    ensureDirectory(filePath);
    this.filePath = filePath;
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.migrate();
    this.seedCollections();
  }

  close() {
    this.db.close();
  }

  migrate() {
    this.db.exec(
      [
        'CREATE TABLE IF NOT EXISTS videos (',
        '  url TEXT PRIMARY KEY,',
        '  title TEXT,',
        '  views INTEGER,',
        '  likes INTEGER,',
        '  img TEXT,',
        '  preview TEXT,',
        '  created_at TEXT NOT NULL,',
        '  updated_at TEXT NOT NULL',
        ');',
        'CREATE TABLE IF NOT EXISTS collections (',
        '  key TEXT PRIMARY KEY,',
        '  name TEXT NOT NULL',
        ');',
        'CREATE TABLE IF NOT EXISTS collection_items (',
        '  collection_key TEXT NOT NULL,',
        '  video_url TEXT NOT NULL,',
        '  first_seen_at TEXT NOT NULL,',
        '  last_seen_at TEXT NOT NULL,',
        '  PRIMARY KEY (collection_key, video_url),',
        '  FOREIGN KEY (collection_key) REFERENCES collections(key) ON DELETE CASCADE,',
        '  FOREIGN KEY (video_url) REFERENCES videos(url) ON DELETE CASCADE',
        ');',
        'CREATE TABLE IF NOT EXISTS sync_states (',
        '  collection_key TEXT PRIMARY KEY,',
        '  completed INTEGER NOT NULL DEFAULT 0,',
        '  last_scraped_page INTEGER,',
        '  last_known_url TEXT,',
        '  updated_at TEXT NOT NULL,',
        '  FOREIGN KEY (collection_key) REFERENCES collections(key) ON DELETE CASCADE',
        ');',
        'CREATE TABLE IF NOT EXISTS sync_operations (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
        '  collection_key TEXT NOT NULL,',
        '  sync_run_id TEXT NOT NULL,',
        "  action TEXT NOT NULL CHECK(action IN ('add', 'remove')),",
        '  video_url TEXT NOT NULL,',
        '  title TEXT,',
        '  views INTEGER,',
        '  likes INTEGER,',
        '  img TEXT,',
        '  preview TEXT,',
        '  site_order INTEGER,',
        '  remote_deferred INTEGER NOT NULL DEFAULT 0,',
        '  remote_video_id TEXT,',
        '  remote_fav_type TEXT,',
        '  source_url TEXT,',
        '  remote_applied_at TEXT,',
        '  remote_apply_error TEXT,',
        '  created_at TEXT NOT NULL,',
        '  reconciled_at TEXT,',
        '  FOREIGN KEY (collection_key) REFERENCES collections(key) ON DELETE CASCADE',
        ');',
        'CREATE INDEX IF NOT EXISTS sync_operations_run_idx ON sync_operations (collection_key, sync_run_id, reconciled_at, id);',
        'DROP TABLE IF EXISTS playback_states;'
      ].join('\n')
    );
    this.ensureColumn('collection_items', 'site_order', 'INTEGER');
    this.ensureColumn('collection_items', 'is_visible', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('collection_items', 'missing_at', 'TEXT');
    this.ensureColumn('collection_items', 'last_sync_run_id', 'TEXT');
    this.ensureColumn('sync_operations', 'remote_deferred', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('sync_operations', 'remote_video_id', 'TEXT');
    this.ensureColumn('sync_operations', 'remote_fav_type', 'TEXT');
    this.ensureColumn('sync_operations', 'source_url', 'TEXT');
    this.ensureColumn('sync_operations', 'remote_applied_at', 'TEXT');
    this.ensureColumn('sync_operations', 'remote_apply_error', 'TEXT');
    this.ensureColumn('videos', 'search_text', 'TEXT');
    this.ensureVideoSearchIndex(this.backfillVideoSearchText());
  }

  backfillVideoSearchText(): boolean {
    const rows = this.db.prepare('SELECT url, title FROM videos WHERE search_text IS NULL').all() as VideoSearchRow[];
    if (!rows.length) return false;

    const update = this.db.prepare('UPDATE videos SET search_text = ? WHERE url = ?');

    for (let i = 0; i < rows.length; i++) {
      update.run(buildVideoSearchText(rows[i].title, rows[i].url), rows[i].url);
    }

    return true;
  }

  videoSearchIndexHasExpectedColumns(): boolean {
    const columns = this.db.prepare('PRAGMA table_info(video_search)').all() as TableColumnRow[];
    const names: Record<string, boolean> = {};

    for (let i = 0; i < columns.length; i++) {
      names[columns[i].name] = true;
    }

    return Boolean(names.title && names.url && names.search_text);
  }

  dropVideoSearchTriggers() {
    this.db.exec(
      [
        'DROP TRIGGER IF EXISTS videos_ai;',
        'DROP TRIGGER IF EXISTS videos_ad;',
        'DROP TRIGGER IF EXISTS videos_au;'
      ].join('\n')
    );
  }

  /**
   * @param {boolean} searchTextChanged
   */
  ensureVideoSearchIndex(searchTextChanged: boolean) {
    let indexExists = this.db
      .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'video_search') as NameRow | null | undefined;
    const insertTriggerExists = this.db
      .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('trigger', 'videos_ai') as NameRow | undefined;
    const deleteTriggerExists = this.db
      .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('trigger', 'videos_ad') as NameRow | undefined;
    const updateTriggerExists = this.db
      .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('trigger', 'videos_au') as NameRow | undefined;
    let shouldRebuild =
      searchTextChanged || !indexExists || !insertTriggerExists || !deleteTriggerExists || !updateTriggerExists;

    this.dropVideoSearchTriggers();

    if (indexExists && !this.videoSearchIndexHasExpectedColumns()) {
      this.db.exec('DROP TABLE video_search');
      indexExists = null;
      shouldRebuild = true;
    }

    this.db.exec(
      [
        "CREATE VIRTUAL TABLE IF NOT EXISTS video_search USING fts5(title, url, search_text, content='videos', content_rowid='rowid', tokenize='unicode61');",
        'CREATE TRIGGER IF NOT EXISTS videos_ai AFTER INSERT ON videos BEGIN',
        '  INSERT INTO video_search(rowid, title, url, search_text) VALUES (new.rowid, new.title, new.url, new.search_text);',
        'END;',
        'CREATE TRIGGER IF NOT EXISTS videos_ad AFTER DELETE ON videos BEGIN',
        "  INSERT INTO video_search(video_search, rowid, title, url, search_text) VALUES('delete', old.rowid, old.title, old.url, old.search_text);",
        'END;',
        'CREATE TRIGGER IF NOT EXISTS videos_au AFTER UPDATE OF title, url, search_text ON videos BEGIN',
        "  INSERT INTO video_search(video_search, rowid, title, url, search_text) VALUES('delete', old.rowid, old.title, old.url, old.search_text);",
        '  INSERT INTO video_search(rowid, title, url, search_text) VALUES (new.rowid, new.title, new.url, new.search_text);',
        'END;'
      ].join('\n')
    );

    if (shouldRebuild) {
      this.db.prepare('INSERT INTO video_search(video_search) VALUES (?)').run('rebuild');
    }
  }

  /**
   * @param {string} tableName
   * @param {string} columnName
   * @param {string} definition
   */
  ensureColumn(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare('PRAGMA table_info(' + tableName + ')').all() as TableColumnRow[];

    for (let i = 0; i < columns.length; i++) {
      if (columns[i].name === columnName) return;
    }

    this.db.exec('ALTER TABLE ' + tableName + ' ADD COLUMN ' + columnName + ' ' + definition);
  }

  seedCollections() {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO collections (key, name) VALUES (?, ?)');

    for (let i = 0; i < COLLECTIONS.length; i++) {
      stmt.run(COLLECTIONS[i].key, COLLECTIONS[i].name);
    }
  }

  /**
   * @param {unknown} collectionKey
   */
  ensureCollection(collectionKey: unknown) {
    if (!collectionByKey(collectionKey)) throw new Error('Unknown collection: ' + collectionKey);
  }

  /**
   * @returns {{ key: string, name: string }[]}
   */
  listCollections(): { key: string; name: string }[] {
    return this.db.prepare('SELECT key, name FROM collections ORDER BY key').all() as { key: string; name: string }[];
  }

  /**
   * @param {CollectionKey} collectionKey
   * @returns {SyncState | null}
   */
  getSyncState(collectionKey: CollectionKey): SyncState | null {
    this.ensureCollection(collectionKey);

    const row = this.db
      .prepare(
        [
          'SELECT collection_key, completed, last_scraped_page, last_known_url, updated_at',
          'FROM sync_states',
          'WHERE collection_key = ?'
        ].join(' ')
      )
      .get(collectionKey) as (Omit<SyncState, 'completed'> & { completed: number | boolean }) | undefined;

    if (!row) return null;
    row.completed = Boolean(row.completed);
    return row as SyncState;
  }

  /**
   * @param {CollectionKey} collectionKey
   * @param {DatabaseListOptions | null | undefined} [options]
   * @returns {VideoRow[]}
   */
  listVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): VideoRow[] {
    this.ensureCollection(collectionKey);
    const normalizedOptions = options || {};

    const query = buildVideoListQuery(collectionKey, normalizedOptions);
    const limit = normalizeLimit(normalizedOptions.limit);
    let sql = [
      'SELECT v.url, v.title, v.views, v.likes, v.img, v.preview,',
      '       v.created_at, v.updated_at, ci.first_seen_at, ci.last_seen_at,',
      '       ci.site_order, ci.is_visible, ci.missing_at, ci.last_sync_run_id',
      'FROM collection_items ci',
      'JOIN videos v ON v.url = ci.video_url',
      query.joins.join(' '),
      query.where,
      'ORDER BY ' + query.orderBy
    ].join(' ');

    if (limit !== null) {
      sql += ' LIMIT ? OFFSET ?';
      query.params.push(limit, normalizeOffset(normalizedOptions.offset));
    }

    const stmt = this.db.prepare(sql);

    return stmt.all(...query.params) as unknown as VideoRow[];
  }

  /**
   * @param {CollectionKey} collectionKey
   * @param {DatabaseListOptions | null | undefined} [options]
   * @returns {number}
   */
  countVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): number {
    this.ensureCollection(collectionKey);

    const query = buildVideoListQuery(collectionKey, options);
    const stmt = this.db.prepare(
      [
        'SELECT COUNT(*) AS total',
        'FROM collection_items ci',
        'JOIN videos v ON v.url = ci.video_url',
        query.joins.join(' '),
        query.where
      ].join(' ')
    );
    const row = stmt.get(...query.params) as CountRow | undefined;

    return row ? row.total : 0;
  }

  /**
   * @param {CollectionKey} collectionKey
   * @returns {string[]}
   */
  getCollectionUrls(collectionKey: CollectionKey): string[] {
    this.ensureCollection(collectionKey);

    const rows = this.db
      .prepare(
        ['SELECT video_url', 'FROM collection_items', 'WHERE collection_key = ?', 'ORDER BY last_seen_at DESC'].join(
          ' '
        )
      )
      .all(collectionKey) as VideoUrlRow[];

    return rows.map(function (row) {
      return row.video_url;
    });
  }

  /**
   * @param {CollectionKey} collectionKey
   * @param {unknown[] | null | undefined} urls
   * @returns {boolean}
   */
  allCollectionUrlsKnown(collectionKey: CollectionKey, urls: unknown[] | null | undefined): boolean {
    this.ensureCollection(collectionKey);

    if (!Array.isArray(urls) || !urls.length) return false;

    const seen: Record<string, boolean> = {};
    const normalizedUrls: string[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = normalizeVideoUrl(urls[i]);
      if (!url) return false;

      if (!seen[url]) {
        seen[url] = true;
        normalizedUrls.push(url);
      }
    }

    if (!normalizedUrls.length) return false;

    const placeholders: string[] = [];
    for (let n = 0; n < normalizedUrls.length; n++) {
      placeholders.push('?');
    }

    const stmt = this.db.prepare(
      [
        'SELECT COUNT(*) AS total',
        'FROM collection_items',
        'WHERE collection_key = ?',
        '  AND video_url IN (' + placeholders.join(', ') + ')'
      ].join(' ')
    );
    const params: SQLInputValue[] = [collectionKey];
    for (let p = 0; p < normalizedUrls.length; p++) {
      params.push(normalizedUrls[p]);
    }
    const row = stmt.get(...params) as CountRow | undefined;

    if (!row) return false;
    return row.total === normalizedUrls.length;
  }

  /**
   * @param {SaveSyncPagePayload} payload
   * @returns {{ saved: number, collectionKey: CollectionKey, page: number | null }}
   */
  saveSyncPage(payload: SaveSyncPagePayload): { saved: number; collectionKey: CollectionKey; page: number | null } {
    const collectionKey = payload.collectionKey;
    this.ensureCollection(collectionKey);

    const page = normalizeNumber(payload.page) || null;
    const syncRunId = normalizeText(payload.syncRunId);
    const preserveExistingSiteOrder =
      Boolean(syncRunId) &&
      Boolean(
        this.db
          .prepare(
            ['SELECT id', 'FROM sync_operations', 'WHERE collection_key = ?', '  AND sync_run_id = ?', 'LIMIT 1'].join(
              ' '
            )
          )
          .get(collectionKey, syncRunId)
      );
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const normalizedRows: NormalizedVideo[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = normalizeVideo(rows[i] as VideoInput);
      if (row) normalizedRows.push(row);
    }

    const timestamp = nowIso();
    const upsertVideo = this.db.prepare(
      [
        'INSERT INTO videos (url, title, views, likes, img, preview, search_text, created_at, updated_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(url) DO UPDATE SET',
        '  title = COALESCE(excluded.title, videos.title),',
        '  views = COALESCE(excluded.views, videos.views),',
        '  likes = COALESCE(excluded.likes, videos.likes),',
        '  img = COALESCE(excluded.img, videos.img),',
        '  preview = COALESCE(excluded.preview, videos.preview),',
        '  search_text = CASE WHEN excluded.title IS NULL THEN videos.search_text ELSE excluded.search_text END,',
        '  updated_at = excluded.updated_at'
      ].join(' ')
    );
    const upsertItem = this.db.prepare(
      [
        'INSERT INTO collection_items (',
        '  collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id',
        ')',
        'VALUES (?, ?, ?, ?, ?, 1, NULL, ?)',
        'ON CONFLICT(collection_key, video_url) DO UPDATE SET',
        '  last_seen_at = excluded.last_seen_at,',
        '  site_order = CASE',
        '    WHEN ? = 1 THEN collection_items.site_order',
        '    ELSE COALESCE(excluded.site_order, collection_items.site_order)',
        '  END,',
        '  is_visible = CASE',
        '    WHEN collection_items.is_visible = 0',
        '      AND excluded.last_sync_run_id IS NOT NULL',
        '      AND collection_items.last_sync_run_id = excluded.last_sync_run_id THEN 0',
        '    ELSE 1',
        '  END,',
        '  missing_at = CASE',
        '    WHEN collection_items.is_visible = 0',
        '      AND excluded.last_sync_run_id IS NOT NULL',
        '      AND collection_items.last_sync_run_id = excluded.last_sync_run_id THEN collection_items.missing_at',
        '    ELSE NULL',
        '  END,',
        '  last_sync_run_id = COALESCE(excluded.last_sync_run_id, collection_items.last_sync_run_id)'
      ].join(' ')
    );
    const upsertState = this.db.prepare(
      [
        'INSERT INTO sync_states (collection_key, completed, last_scraped_page, last_known_url, updated_at)',
        'VALUES (?, 0, ?, ?, ?)',
        'ON CONFLICT(collection_key) DO UPDATE SET',
        '  completed = 0,',
        '  last_scraped_page = excluded.last_scraped_page,',
        '  last_known_url = excluded.last_known_url,',
        '  updated_at = excluded.updated_at'
      ].join(' ')
    );
    const selectDuplicateAddOperation = this.db.prepare(
      [
        'SELECT latest.id',
        'FROM sync_operations latest',
        'WHERE latest.collection_key = ?',
        '  AND latest.sync_run_id = ?',
        '  AND latest.video_url = ?',
        "  AND latest.action = 'add'",
        '  AND latest.site_order IS NULL',
        '  AND latest.reconciled_at IS NULL',
        '  AND latest.id = (',
        '    SELECT MAX(id)',
        '    FROM sync_operations',
        '    WHERE collection_key = latest.collection_key',
        '      AND sync_run_id = latest.sync_run_id',
        '      AND video_url = latest.video_url',
        '      AND reconciled_at IS NULL',
        '  )',
        '  AND NOT EXISTS (',
        '    SELECT 1',
        '    FROM sync_operations prior',
        '    WHERE prior.collection_key = latest.collection_key',
        '      AND prior.sync_run_id = latest.sync_run_id',
        '      AND prior.video_url = latest.video_url',
        "      AND prior.action = 'remove'",
        '      AND prior.id < latest.id',
        '  )',
        'LIMIT 1'
      ].join(' ')
    );

    this.db.exec('BEGIN IMMEDIATE');

    try {
      for (let n = 0; n < normalizedRows.length; n++) {
        const video = normalizedRows[n];
        const shouldUseScrapedSiteOrder =
          preserveExistingSiteOrder &&
          video.siteOrder !== null &&
          Boolean(selectDuplicateAddOperation.get(collectionKey, syncRunId, video.url));
        upsertVideo.run(
          video.url,
          video.title,
          video.views,
          video.likes,
          video.img,
          video.preview,
          video.searchText,
          timestamp,
          timestamp
        );
        upsertItem.run(
          collectionKey,
          video.url,
          timestamp,
          timestamp,
          video.siteOrder,
          syncRunId,
          preserveExistingSiteOrder && !shouldUseScrapedSiteOrder ? 1 : 0
        );
      }

      upsertState.run(
        collectionKey,
        page,
        normalizedRows.length ? normalizedRows[normalizedRows.length - 1].url : null,
        timestamp
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return {
      saved: normalizedRows.length,
      collectionKey: collectionKey,
      page: page
    };
  }

  recordSyncOperation(
    collectionKey: CollectionKey,
    syncRunId: string | null,
    action: 'add' | 'remove',
    video: NormalizedVideo,
    timestamp: string,
    options?: {
      remoteDeferred?: boolean;
      remoteVideoId?: string | null;
      remoteFavType?: string | null;
      sourceUrl?: string | null;
    } | null
  ) {
    if (!syncRunId) return;
    const normalizedOptions = options || {};

    this.db
      .prepare(
        [
          'INSERT INTO sync_operations (',
          '  collection_key, sync_run_id, action, video_url, title, views, likes, img, preview, site_order,',
          '  remote_deferred, remote_video_id, remote_fav_type, source_url, created_at',
          ')',
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ].join(' ')
      )
      .run(
        collectionKey,
        syncRunId,
        action,
        video.url,
        video.title,
        video.views,
        video.likes,
        video.img,
        video.preview,
        video.siteOrder,
        normalizedOptions.remoteDeferred ? 1 : 0,
        normalizedOptions.remoteVideoId || null,
        normalizedOptions.remoteFavType || null,
        normalizedOptions.sourceUrl || null,
        timestamp
      );
  }

  listDeferredSyncOperations(collectionKey: CollectionKey, syncRunId: string | null): PendingSyncOperation[] {
    if (!syncRunId) return [];

    const rows = this.db
      .prepare(
        [
          'SELECT id, action, video_url, remote_video_id, remote_fav_type',
          'FROM sync_operations',
          'WHERE collection_key = ?',
          '  AND sync_run_id = ?',
          '  AND remote_deferred = 1',
          '  AND remote_applied_at IS NULL',
          'ORDER BY id ASC'
        ].join(' ')
      )
      .all(collectionKey, syncRunId) as PendingSyncOperationRow[];

    return rows.map(pendingSyncOperationFromRow);
  }

  listDeferredSyncOutboxOperations(collectionKey: CollectionKey): PendingSyncOperation[] {
    this.ensureCollection(collectionKey);

    const rows = this.db
      .prepare(
        [
          'SELECT id, action, video_url, remote_video_id, remote_fav_type',
          'FROM sync_operations',
          'WHERE collection_key = ?',
          '  AND remote_deferred = 1',
          '  AND remote_applied_at IS NULL',
          'ORDER BY id ASC'
        ].join(' ')
      )
      .all(collectionKey) as PendingSyncOperationRow[];

    return rows.map(pendingSyncOperationFromRow);
  }

  markDeferredSyncOperationsApplied(collectionKey: CollectionKey, syncRunId: string | null, ids: unknown[]): number {
    if (!Array.isArray(ids) || !ids.length) return 0;

    const timestamp = nowIso();
    const update = this.db.prepare(
      [
        'UPDATE sync_operations',
        'SET remote_applied_at = ?, remote_apply_error = NULL',
        'WHERE collection_key = ?',
        syncRunId ? '  AND sync_run_id = ?' : '',
        '  AND id = ?'
      ]
        .filter(Boolean)
        .join(' ')
    );
    let applied = 0;

    this.db.exec('BEGIN IMMEDIATE');

    try {
      for (let i = 0; i < ids.length; i++) {
        const id = normalizeNumber(ids[i]);
        if (id === null) continue;

        const result = syncRunId
          ? update.run(timestamp, collectionKey, syncRunId, id)
          : update.run(timestamp, collectionKey, id);
        applied += Number(result.changes || 0);
      }

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return applied;
  }

  markDeferredSyncOperationFailed(
    collectionKey: CollectionKey,
    syncRunId: string | null,
    id: unknown,
    message: unknown
  ): boolean {
    const operationId = normalizeNumber(id);
    if (operationId === null) return false;

    const update = this.db.prepare(
      [
        'UPDATE sync_operations',
        'SET remote_apply_error = ?',
        'WHERE collection_key = ?',
        syncRunId ? '  AND sync_run_id = ?' : '',
        '  AND id = ?'
      ]
        .filter(Boolean)
        .join(' ')
    );
    const messageText = normalizeText(message) || 'Failed to apply queued operation';
    const result = syncRunId
      ? update.run(messageText, collectionKey, syncRunId, operationId)
      : update.run(messageText, collectionKey, operationId);

    return Boolean(result.changes);
  }

  reconcileSyncOperations(collectionKey: CollectionKey, syncRunId: string | null, timestamp: string): number {
    if (!syncRunId) return 0;

    const operations = this.db
      .prepare(
        [
          'SELECT id, collection_key, sync_run_id, action, video_url, title, views, likes, img, preview, site_order,',
          '  remote_deferred, remote_video_id, remote_fav_type',
          'FROM sync_operations',
          'WHERE collection_key = ?',
          '  AND sync_run_id = ?',
          '  AND reconciled_at IS NULL',
          'ORDER BY id ASC'
        ].join(' ')
      )
      .all(collectionKey, syncRunId) as SyncOperationRow[];

    if (!operations.length) return 0;

    const latestByUrl: Record<string, SyncOperationRow> = {};

    for (let i = 0; i < operations.length; i++) {
      latestByUrl[operations[i].video_url] = operations[i];
    }

    const upsertVideo = this.db.prepare(
      [
        'INSERT INTO videos (url, title, views, likes, img, preview, search_text, created_at, updated_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(url) DO UPDATE SET',
        '  title = COALESCE(excluded.title, videos.title),',
        '  views = COALESCE(excluded.views, videos.views),',
        '  likes = COALESCE(excluded.likes, videos.likes),',
        '  img = COALESCE(excluded.img, videos.img),',
        '  preview = COALESCE(excluded.preview, videos.preview),',
        '  search_text = CASE WHEN excluded.title IS NULL THEN videos.search_text ELSE excluded.search_text END,',
        '  updated_at = excluded.updated_at'
      ].join(' ')
    );
    const upsertVisibleItem = this.db.prepare(
      [
        'INSERT INTO collection_items (',
        '  collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id',
        ')',
        'VALUES (?, ?, ?, ?, ?, 1, NULL, ?)',
        'ON CONFLICT(collection_key, video_url) DO UPDATE SET',
        '  last_seen_at = excluded.last_seen_at,',
        '  site_order = CASE',
        '    WHEN collection_items.is_visible = 1 AND excluded.site_order < 0 THEN collection_items.site_order',
        '    ELSE COALESCE(excluded.site_order, collection_items.site_order)',
        '  END,',
        '  is_visible = 1,',
        '  missing_at = NULL,',
        '  last_sync_run_id = excluded.last_sync_run_id'
      ].join(' ')
    );
    const upsertHiddenItem = this.db.prepare(
      [
        'INSERT INTO collection_items (',
        '  collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id',
        ')',
        'VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        'ON CONFLICT(collection_key, video_url) DO UPDATE SET',
        '  last_seen_at = excluded.last_seen_at,',
        '  is_visible = 0,',
        '  missing_at = excluded.missing_at,',
        '  last_sync_run_id = excluded.last_sync_run_id'
      ].join(' ')
    );
    const markReconciled = this.db.prepare(
      [
        'UPDATE sync_operations',
        'SET reconciled_at = ?',
        'WHERE collection_key = ?',
        '  AND sync_run_id = ?',
        '  AND reconciled_at IS NULL'
      ].join(' ')
    );
    const selectVisibleOrder = this.db.prepare(
      [
        'SELECT video_url',
        'FROM collection_items',
        'WHERE collection_key = ?',
        '  AND is_visible = 1',
        'ORDER BY site_order IS NULL ASC, site_order ASC, last_seen_at DESC, video_url ASC'
      ].join(' ')
    );
    const updateSiteOrder = this.db.prepare(
      'UPDATE collection_items SET site_order = ? WHERE collection_key = ? AND video_url = ?'
    );
    const latestOperations = Object.keys(latestByUrl).map(function (url) {
      return latestByUrl[url];
    });
    latestOperations.sort(function (left, right) {
      return left.id - right.id;
    });

    this.db.exec('BEGIN IMMEDIATE');

    try {
      for (let i = 0; i < latestOperations.length; i++) {
        const operation = latestOperations[i];
        const siteOrder = operation.site_order === null ? -Date.now() - i : operation.site_order;

        upsertVideo.run(
          operation.video_url,
          operation.title,
          operation.views,
          operation.likes,
          operation.img,
          operation.preview,
          buildVideoSearchText(operation.title, operation.video_url),
          timestamp,
          timestamp
        );

        if (operation.action === 'remove') {
          upsertHiddenItem.run(
            collectionKey,
            operation.video_url,
            timestamp,
            timestamp,
            siteOrder,
            timestamp,
            syncRunId
          );
        } else {
          upsertVisibleItem.run(collectionKey, operation.video_url, timestamp, timestamp, siteOrder, syncRunId);
        }
      }

      const visibleRows = selectVisibleOrder.all(collectionKey) as VideoUrlRow[];
      for (let i = 0; i < visibleRows.length; i++) {
        updateSiteOrder.run(i + 1, collectionKey, visibleRows[i].video_url);
      }

      markReconciled.run(timestamp, collectionKey, syncRunId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return operations.length;
  }

  /**
   * @param {CollectionTogglePayload | null | undefined} payload
   * @returns {{ action: 'add' | 'remove', changed: boolean, collectionKey: CollectionKey, url: string, visible: boolean }}
   */
  applyCollectionToggle(payload: CollectionTogglePayload | null | undefined): {
    action: 'add' | 'remove';
    changed: boolean;
    collectionKey: CollectionKey;
    queued: boolean;
    url: string;
    visible: boolean;
  } {
    payload = payload || {};

    const collectionKey = payload.collectionKey;
    if (!collectionKey) throw new Error('Collection toggle requires a collection key');
    this.ensureCollection(collectionKey);

    const action: 'add' | 'remove' = payload.action === 'remove' ? 'remove' : 'add';
    const video = normalizeVideo(payload.video || payload);
    if (!video || !video.url) throw new Error('Collection toggle requires a video URL');

    const timestamp = nowIso();
    const syncRunId = normalizeText(payload.syncRunId);
    const remoteDeferred = payload.deferRemote === true;
    const operationOptions = {
      remoteDeferred: remoteDeferred,
      remoteVideoId: normalizeText(payload.remoteVideoId),
      remoteFavType: normalizeText(payload.remoteFavType),
      sourceUrl: normalizeText(payload.sourceUrl)
    };

    if (action === 'remove') {
      const removeResult = this.db
        .prepare(
          [
            'UPDATE collection_items',
            'SET is_visible = 0, missing_at = ?, last_seen_at = ?,',
            '  last_sync_run_id = COALESCE(?, last_sync_run_id)',
            'WHERE collection_key = ?',
            '  AND video_url = ?',
            '  AND is_visible = 1'
          ].join(' ')
        )
        .run(timestamp, timestamp, syncRunId, collectionKey, video.url);

      if (!removeResult.changes && syncRunId) {
        const upsertVideo = this.db.prepare(
          [
            'INSERT INTO videos (url, title, views, likes, img, preview, search_text, created_at, updated_at)',
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            'ON CONFLICT(url) DO UPDATE SET',
            '  title = COALESCE(excluded.title, videos.title),',
            '  views = COALESCE(excluded.views, videos.views),',
            '  likes = COALESCE(excluded.likes, videos.likes),',
            '  img = COALESCE(excluded.img, videos.img),',
            '  preview = COALESCE(excluded.preview, videos.preview),',
            '  search_text = CASE WHEN excluded.title IS NULL THEN videos.search_text ELSE excluded.search_text END,',
            '  updated_at = excluded.updated_at'
          ].join(' ')
        );
        const upsertHiddenItem = this.db.prepare(
          [
            'INSERT INTO collection_items (',
            '  collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id',
            ')',
            'VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
            'ON CONFLICT(collection_key, video_url) DO UPDATE SET',
            '  last_seen_at = excluded.last_seen_at,',
            '  is_visible = 0,',
            '  missing_at = excluded.missing_at,',
            '  last_sync_run_id = excluded.last_sync_run_id'
          ].join(' ')
        );

        this.db.exec('BEGIN IMMEDIATE');

        try {
          upsertVideo.run(
            video.url,
            video.title,
            video.views,
            video.likes,
            video.img,
            video.preview,
            video.searchText,
            timestamp,
            timestamp
          );
          upsertHiddenItem.run(
            collectionKey,
            video.url,
            timestamp,
            timestamp,
            video.siteOrder === null ? -Date.now() : video.siteOrder,
            timestamp,
            syncRunId
          );
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      }

      this.recordSyncOperation(collectionKey, syncRunId, action, video, timestamp, operationOptions);

      return {
        action: action,
        changed: Boolean(removeResult && removeResult.changes),
        collectionKey: collectionKey,
        queued: remoteDeferred,
        url: video.url,
        visible: false
      };
    }

    const upsertVideo = this.db.prepare(
      [
        'INSERT INTO videos (url, title, views, likes, img, preview, search_text, created_at, updated_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'ON CONFLICT(url) DO UPDATE SET',
        '  title = COALESCE(excluded.title, videos.title),',
        '  views = COALESCE(excluded.views, videos.views),',
        '  likes = COALESCE(excluded.likes, videos.likes),',
        '  img = COALESCE(excluded.img, videos.img),',
        '  preview = COALESCE(excluded.preview, videos.preview),',
        '  search_text = CASE WHEN excluded.title IS NULL THEN videos.search_text ELSE excluded.search_text END,',
        '  updated_at = excluded.updated_at'
      ].join(' ')
    );
    const upsertItem = this.db.prepare(
      [
        'INSERT INTO collection_items (',
        '  collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id',
        ')',
        'VALUES (?, ?, ?, ?, ?, 1, NULL, ?)',
        'ON CONFLICT(collection_key, video_url) DO UPDATE SET',
        '  last_seen_at = excluded.last_seen_at,',
        '  site_order = CASE',
        '    WHEN collection_items.is_visible = 1 AND excluded.site_order < 0 THEN collection_items.site_order',
        '    ELSE COALESCE(excluded.site_order, collection_items.site_order)',
        '  END,',
        '  is_visible = 1,',
        '  missing_at = NULL,',
        '  last_sync_run_id = COALESCE(excluded.last_sync_run_id, collection_items.last_sync_run_id)'
      ].join(' ')
    );

    this.db.exec('BEGIN IMMEDIATE');

    try {
      upsertVideo.run(
        video.url,
        video.title,
        video.views,
        video.likes,
        video.img,
        video.preview,
        video.searchText,
        timestamp,
        timestamp
      );
      upsertItem.run(
        collectionKey,
        video.url,
        timestamp,
        timestamp,
        video.siteOrder === null ? -Date.now() : video.siteOrder,
        syncRunId
      );
      this.recordSyncOperation(collectionKey, syncRunId, action, video, timestamp, operationOptions);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return {
      action: action,
      changed: true,
      collectionKey: collectionKey,
      queued: remoteDeferred,
      url: video.url,
      visible: true
    };
  }

  /**
   * @param {FinishSyncInput} payload
   * @returns {SyncState}
   */
  finishSync(payload: FinishSyncInput): SyncState {
    const collectionKey = payload.collectionKey;
    this.ensureCollection(collectionKey);

    const result: SyncResultInput = payload.result || {};
    const timestamp = nowIso();
    const lastScrapedPage = normalizeNumber(result.lastScrapedPage);
    const lastKnownUrl = normalizeText(result.lastKnownUrl);
    const completed = result.completed === false ? 0 : 1;
    const mode = normalizeText(payload.mode || result.mode);
    const syncRunId = normalizeText(payload.syncRunId || result.syncRunId);
    let hidden = 0;
    let mutationsReconciled = 0;

    this.db
      .prepare(
        [
          'INSERT INTO sync_states (collection_key, completed, last_scraped_page, last_known_url, updated_at)',
          'VALUES (?, ?, ?, ?, ?)',
          'ON CONFLICT(collection_key) DO UPDATE SET',
          '  completed = excluded.completed,',
          '  last_scraped_page = COALESCE(excluded.last_scraped_page, sync_states.last_scraped_page),',
          '  last_known_url = COALESCE(excluded.last_known_url, sync_states.last_known_url),',
          '  updated_at = excluded.updated_at'
        ].join(' ')
      )
      .run(collectionKey, completed, lastScrapedPage, lastKnownUrl, timestamp);

    if (mode === 'full' && completed && syncRunId) {
      const update = this.db
        .prepare(
          [
            'UPDATE collection_items',
            'SET is_visible = 0, missing_at = ?',
            'WHERE collection_key = ?',
            '  AND is_visible = 1',
            '  AND (last_sync_run_id IS NULL OR last_sync_run_id <> ?)'
          ].join(' ')
        )
        .run(timestamp, collectionKey, syncRunId);
      hidden = Number(update.changes || 0);
    }

    mutationsReconciled = this.reconcileSyncOperations(collectionKey, syncRunId, timestamp);

    const state = this.getSyncState(collectionKey);
    if (!state) throw new Error('Sync state was not saved for collection: ' + collectionKey);
    state.hidden = hidden;
    state.mutationsReconciled = mutationsReconciled;
    return state;
  }

  /**
   * @param {CollectionKey} collectionKey
   * @returns {{ collectionKey: CollectionKey, cleared: boolean }}
   */
  clearSyncState(collectionKey: CollectionKey): { collectionKey: CollectionKey; cleared: boolean } {
    this.ensureCollection(collectionKey);
    this.db.prepare('DELETE FROM sync_states WHERE collection_key = ?').run(collectionKey);

    return { collectionKey: collectionKey, cleared: true };
  }

  /**
   * @param {CollectionKey} collectionKey
   * @param {ImportResource} resource
   * @returns {{ imported: number, collectionKey: CollectionKey }}
   */
  importResource(
    collectionKey: CollectionKey,
    resource: ImportResource
  ): { imported: number; collectionKey: CollectionKey } {
    this.ensureCollection(collectionKey);

    const rows = flattenResource(resource);
    for (let i = 0; i < rows.length; i++) {
      const siteOrder = normalizeNumber(readSiteOrder(rows[i]));
      rows[i].siteOrder = siteOrder === null ? i + 1 : siteOrder;
    }
    const saved = this.saveSyncPage({
      collectionKey: collectionKey,
      page: resource && resource.meta ? resource.meta.last_scraped_page : null,
      rows: rows
    });

    if (resource && resource.meta && resource.meta.completed) {
      this.finishSync({
        collectionKey: collectionKey,
        result: {
          lastScrapedPage: resource.meta.last_scraped_page,
          lastKnownUrl: rows.length ? rows[rows.length - 1].url : null
        }
      });
    }

    return {
      imported: saved.saved,
      collectionKey: collectionKey
    };
  }

  /**
   * @param {CollectionKey} collectionKey
   * @returns {ExportResource}
   */
  exportResource(collectionKey: CollectionKey): ExportResource {
    this.ensureCollection(collectionKey);

    const collection = collectionByKey(collectionKey);
    if (!collection) throw new Error('Unknown collection: ' + collectionKey);
    const rows = this.listVideos(collectionKey, { sort: 'site_order', direction: 'asc' });
    const state = this.getSyncState(collectionKey);
    const pages = rowsByPage(rows);
    const exportedAt = nowIso();

    return {
      data: pages,
      meta: exportMeta(collection, state, exportedAt, rows.length, pages.length)
    };
  }

  /**
   * @param {CollectionKey} collectionKey
   * @param {string} filePath
   * @returns {Promise<{ filePath: string, total: number }>}
   */
  async exportResourceToFile(
    collectionKey: CollectionKey,
    filePath: string
  ): Promise<{ filePath: string; total: number }> {
    this.ensureCollection(collectionKey);
    if (!filePath) throw new Error('Export file path is required');

    ensureDirectory(filePath);

    const collection = collectionByKey(collectionKey);
    if (!collection) throw new Error('Unknown collection: ' + collectionKey);
    const state = this.getSyncState(collectionKey);
    const exportedAt = nowIso();
    const total = this.countVideos(collectionKey);
    const pageCount = Math.ceil(total / PAGE_SIZE);
    const meta = exportMeta(collection, state, exportedAt, total, pageCount);
    const tempPath = exportTempPath(filePath);
    let handle: FileHandle | null = null;
    let offset = 0;
    let pageNumber = 1;
    let hasPages = false;

    try {
      handle = await fs.promises.open(tempPath, 'w');
      await handle.write('{"data":[');

      while (offset < total) {
        const rows = this.listVideos(collectionKey, {
          sort: 'site_order',
          direction: 'asc',
          limit: EXPORT_BATCH_SIZE,
          offset: offset
        });

        if (!rows.length) break;

        for (let i = 0; i < rows.length; i += PAGE_SIZE) {
          if (hasPages) await handle.write(',');
          await handle.write(JSON.stringify(exportPage(rows.slice(i, i + PAGE_SIZE), pageNumber, exportedAt)));
          hasPages = true;
          pageNumber++;
        }

        offset += rows.length;
        await nextTick();
      }

      await handle.write('],"meta":' + JSON.stringify(meta) + '}\n');
      await handle.close();
      handle = null;
      await fs.promises.rename(tempPath, filePath);

      return {
        filePath: filePath,
        total: total
      };
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch (closeError) {}
      }

      try {
        await fs.promises.unlink(tempPath);
      } catch (unlinkError) {}

      throw error;
    }
  }
}

module.exports = {
  COLLECTIONS: COLLECTIONS,
  JableDatabase: JableDatabase,
  flattenResource: flattenResource,
  normalizeVideoUrl: normalizeVideoUrl
};
