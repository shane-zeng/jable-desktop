'use strict';

import type { FileHandle } from 'node:fs/promises';
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
type DatabaseSortKey = NonNullable<ListVideosOptions['sort']> | 'updated_at' | 'last_seen_at';
type DatabaseListOptions = Partial<ListVideosOptions> & { sort?: DatabaseSortKey };
type VideoListQuery = { joins: string[]; params: SQLInputValue[]; where: string; orderBy: string };
type NameRow = { name: string };
type CountRow = { total: number };
type VideoUrlRow = { video_url: string };
type VideoSearchRow = { title: string | null; url: string; search_text?: string | null };
type TableColumnRow = { name: string };

var fs = require('node:fs') as typeof import('node:fs');
var path = require('node:path') as typeof import('node:path');

var DatabaseSync: typeof import('node:sqlite').DatabaseSync;
try {
  DatabaseSync = (require('node:sqlite') as typeof import('node:sqlite')).DatabaseSync;
} catch (error) {
  throw new Error('node:sqlite is required. Use Node.js 24+ or an Electron version that includes node:sqlite.');
}

var PAGE_SIZE = 24;
var EXPORT_BATCH_SIZE = PAGE_SIZE * 100;
var SEARCH_NGRAM_MAX = 3;

var COLLECTIONS: DatabaseCollection[] = [
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
  for (var i = 0; i < COLLECTIONS.length; i++) {
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
  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeText(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') return null;
  var text = String(value).trim();
  return text || null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeVideoUrl(value: unknown): string | null {
  var text = normalizeText(value);
  if (!text) return null;

  try {
    var parsed = new URL(text);
    parsed.search = '';
    parsed.hash = '';
    if (/^\/videos\/[^/]+$/.test(parsed.pathname)) parsed.pathname += '/';
    return parsed.href;
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
  var url = normalizeVideoUrl(row.url);
  if (!url) return null;

  var video: NormalizedVideo = {
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
  var data = rows.map(exportVideo);

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
    source_url: 'https://jable.tv' + collection.sourcePath,
    exported_at: exportedAt,
    completed: !!(state && state.completed),
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
  var rows: VideoInput[] = [];
  if (!resource || !Array.isArray(resource.data)) return rows;

  for (var i = 0; i < resource.data.length; i++) {
    var item = resource.data[i];
    if (!item) continue;

    var resourceItem = item as VideoInput & { data?: VideoInput[] };
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
  var pages: ExportPage[] = [];
  var exportedAt = nowIso();

  for (var i = 0; i < rows.length; i += PAGE_SIZE) {
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
  var text = value ? String(value).normalize('NFKC').toLowerCase() : '';
  var runs: string[] = [];
  var current = '';
  var currentType: 'cjk' | 'word' | null = null;

  for (var char of text) {
    var charType: 'cjk' | 'word' | null = null;
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
  var chars = Array.from(run);
  var maxSize = Math.min(SEARCH_NGRAM_MAX, chars.length);

  for (var size = 1; size <= maxSize; size++) {
    for (var i = 0; i <= chars.length - size; i++) {
      addSearchToken(tokens, chars.slice(i, i + size).join(''));
    }
  }
}

/**
 * @param {unknown[]} values
 * @returns {string[]}
 */
function collectSearchTokens(values: unknown[]): string[] {
  var tokens: Record<string, boolean> = {};

  for (var i = 0; i < values.length; i++) {
    var runs = searchRuns(values[i]);
    for (var n = 0; n < runs.length; n++) {
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
  var text = value ? String(value).normalize('NFKC').toLowerCase() : '';
  var compact = '';

  for (var char of text) {
    if (isCjkSearchChar(char) || isSearchWordChar(char)) compact += char;
  }

  return compact;
}

/**
 * @param {unknown[]} values
 * @returns {string[]}
 */
function collectPhraseTokens(values: unknown[]): string[] {
  var tokens: Record<string, boolean> = {};

  for (var i = 0; i < values.length; i++) {
    var compact = compactSearchValue(values[i]);
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
  var tokens: Record<string, boolean> = {};
  var searchTokens = collectSearchTokens([title, url]);
  var phraseTokens = collectPhraseTokens([title, url]);

  for (var i = 0; i < searchTokens.length; i++) {
    addSearchToken(tokens, searchTokens[i]);
  }

  for (var n = 0; n < phraseTokens.length; n++) {
    addSearchToken(tokens, phraseTokens[n]);
  }

  return Object.keys(tokens).join(' ');
}

/**
 * @param {string} run
 * @returns {string[]}
 */
function searchQueryTokensForRun(run: string): string[] {
  var chars = Array.from(run);
  if (chars.length <= SEARCH_NGRAM_MAX) return [run];

  var tokens: string[] = [];
  for (var i = 0; i <= chars.length - SEARCH_NGRAM_MAX; i++) {
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
  var runs = searchRuns(term);
  var runQueries: string[] = [];

  for (var i = 0; i < runs.length; i++) {
    runQueries.push(buildSearchRunQuery(runs[i]));
  }

  return runQueries.length ? '(' + runQueries.join(' AND ') + ')' : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function buildSearchPhraseQuery(value: unknown): string | null {
  var compact = compactSearchValue(value);
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

  var terms = value ? String(value).trim().split(/\s+/) : [];
  var termQueries: string[] = [];

  for (var i = 0; i < terms.length; i++) {
    var query = buildSearchTermQuery(terms[i]);
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
  var normalizedOptions = options || {};

  var sortMap: Record<DatabaseSortKey, string> = {
    site_order: 'site_order',
    title: 'v.title',
    views: 'v.views',
    likes: 'v.likes',
    updated_at: 'v.updated_at',
    last_seen_at: 'ci.last_seen_at'
  };
  var requestedSort = normalizedOptions.sort;
  var sortKey: DatabaseSortKey = requestedSort && sortMap[requestedSort] ? requestedSort : 'site_order';
  var sort = sortMap[sortKey];
  var direction = normalizedOptions.direction
    ? normalizedOptions.direction === 'asc'
      ? 'ASC'
      : 'DESC'
    : sortKey === 'site_order'
      ? 'ASC'
      : 'DESC';
  var searchMode: SearchMode =
    normalizedOptions.searchMode === 'all' || normalizedOptions.searchMode === 'phrase'
      ? normalizedOptions.searchMode
      : 'any';
  var matchQuery = normalizedOptions.search ? buildSearchMatchQuery(normalizedOptions.search, searchMode) : null;
  var params: SQLInputValue[] = [collectionKey];
  var joins: string[] = [];
  var where = 'WHERE ci.collection_key = ?';

  if (!normalizedOptions.includeHidden) {
    where += ' AND ci.is_visible = 1';
  }

  if (matchQuery) {
    joins.push('JOIN video_search ON video_search.rowid = v.rowid');
    where += ' AND video_search MATCH ?';
    params.push(matchQuery);
  }

  var orderBy =
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
  var number = normalizeNumber(value);
  if (number === null || number <= 0) return null;
  return Math.floor(number);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeOffset(value: unknown): number {
  var number = normalizeNumber(value);
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
        'DROP TABLE IF EXISTS playback_states;'
      ].join('\n')
    );
    this.ensureColumn('collection_items', 'site_order', 'INTEGER');
    this.ensureColumn('collection_items', 'is_visible', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('collection_items', 'missing_at', 'TEXT');
    this.ensureColumn('collection_items', 'last_sync_run_id', 'TEXT');
    this.ensureColumn('videos', 'search_text', 'TEXT');
    this.ensureVideoSearchIndex(this.backfillVideoSearchText());
  }

  backfillVideoSearchText(): boolean {
    var rows = this.db.prepare('SELECT url, title FROM videos WHERE search_text IS NULL').all() as VideoSearchRow[];
    if (!rows.length) return false;

    var update = this.db.prepare('UPDATE videos SET search_text = ? WHERE url = ?');

    for (var i = 0; i < rows.length; i++) {
      update.run(buildVideoSearchText(rows[i].title, rows[i].url), rows[i].url);
    }

    return true;
  }

  videoSearchIndexHasExpectedColumns(): boolean {
    var columns = this.db.prepare('PRAGMA table_info(video_search)').all() as TableColumnRow[];
    var names: Record<string, boolean> = {};

    for (var i = 0; i < columns.length; i++) {
      names[columns[i].name] = true;
    }

    return !!(names.title && names.url && names.search_text);
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
    var indexExists = this.db
      .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'video_search') as NameRow | null | undefined;
    var insertTriggerExists = this.db
      .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('trigger', 'videos_ai') as NameRow | undefined;
    var deleteTriggerExists = this.db
      .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('trigger', 'videos_ad') as NameRow | undefined;
    var updateTriggerExists = this.db
      .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('trigger', 'videos_au') as NameRow | undefined;
    var shouldRebuild =
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
    var columns = this.db.prepare('PRAGMA table_info(' + tableName + ')').all() as TableColumnRow[];

    for (var i = 0; i < columns.length; i++) {
      if (columns[i].name === columnName) return;
    }

    this.db.exec('ALTER TABLE ' + tableName + ' ADD COLUMN ' + columnName + ' ' + definition);
  }

  seedCollections() {
    var stmt = this.db.prepare('INSERT OR IGNORE INTO collections (key, name) VALUES (?, ?)');

    for (var i = 0; i < COLLECTIONS.length; i++) {
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

    var row = this.db
      .prepare(
        [
          'SELECT collection_key, completed, last_scraped_page, last_known_url, updated_at',
          'FROM sync_states',
          'WHERE collection_key = ?'
        ].join(' ')
      )
      .get(collectionKey) as (Omit<SyncState, 'completed'> & { completed: number | boolean }) | undefined;

    if (!row) return null;
    row.completed = !!row.completed;
    return row as SyncState;
  }

  /**
   * @param {CollectionKey} collectionKey
   * @param {DatabaseListOptions | null | undefined} [options]
   * @returns {VideoRow[]}
   */
  listVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): VideoRow[] {
    this.ensureCollection(collectionKey);
    var normalizedOptions = options || {};

    var query = buildVideoListQuery(collectionKey, normalizedOptions);
    var limit = normalizeLimit(normalizedOptions.limit);
    var sql = [
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

    var stmt = this.db.prepare(sql);

    return stmt.all(...query.params) as unknown as VideoRow[];
  }

  /**
   * @param {CollectionKey} collectionKey
   * @param {DatabaseListOptions | null | undefined} [options]
   * @returns {number}
   */
  countVideos(collectionKey: CollectionKey, options?: DatabaseListOptions | null): number {
    this.ensureCollection(collectionKey);

    var query = buildVideoListQuery(collectionKey, options);
    var stmt = this.db.prepare(
      [
        'SELECT COUNT(*) AS total',
        'FROM collection_items ci',
        'JOIN videos v ON v.url = ci.video_url',
        query.joins.join(' '),
        query.where
      ].join(' ')
    );
    var row = stmt.get(...query.params) as CountRow | undefined;

    return row ? row.total : 0;
  }

  /**
   * @param {CollectionKey} collectionKey
   * @returns {string[]}
   */
  getCollectionUrls(collectionKey: CollectionKey): string[] {
    this.ensureCollection(collectionKey);

    var rows = this.db
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

    var seen: Record<string, boolean> = {};
    var normalizedUrls: string[] = [];

    for (var i = 0; i < urls.length; i++) {
      var url = normalizeVideoUrl(urls[i]);
      if (!url) return false;

      if (!seen[url]) {
        seen[url] = true;
        normalizedUrls.push(url);
      }
    }

    if (!normalizedUrls.length) return false;

    var placeholders: string[] = [];
    for (var n = 0; n < normalizedUrls.length; n++) {
      placeholders.push('?');
    }

    var stmt = this.db.prepare(
      [
        'SELECT COUNT(*) AS total',
        'FROM collection_items',
        'WHERE collection_key = ?',
        '  AND video_url IN (' + placeholders.join(', ') + ')'
      ].join(' ')
    );
    var params: SQLInputValue[] = [collectionKey];
    for (var p = 0; p < normalizedUrls.length; p++) {
      params.push(normalizedUrls[p]);
    }
    var row = stmt.get(...params) as CountRow | undefined;

    return !!row && row.total === normalizedUrls.length;
  }

  /**
   * @param {SaveSyncPagePayload} payload
   * @returns {{ saved: number, collectionKey: CollectionKey, page: number | null }}
   */
  saveSyncPage(payload: SaveSyncPagePayload): { saved: number; collectionKey: CollectionKey; page: number | null } {
    var collectionKey = payload.collectionKey;
    this.ensureCollection(collectionKey);

    var page = normalizeNumber(payload.page) || null;
    var syncRunId = normalizeText(payload.syncRunId);
    var rows = Array.isArray(payload.rows) ? payload.rows : [];
    var normalizedRows: NormalizedVideo[] = [];

    for (var i = 0; i < rows.length; i++) {
      var row = normalizeVideo(rows[i] as VideoInput);
      if (row) normalizedRows.push(row);
    }

    var timestamp = nowIso();
    var upsertVideo = this.db.prepare(
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
    var upsertItem = this.db.prepare(
      [
        'INSERT INTO collection_items (',
        '  collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id',
        ')',
        'VALUES (?, ?, ?, ?, ?, 1, NULL, ?)',
        'ON CONFLICT(collection_key, video_url) DO UPDATE SET',
        '  last_seen_at = excluded.last_seen_at,',
        '  site_order = COALESCE(excluded.site_order, collection_items.site_order),',
        '  is_visible = 1,',
        '  missing_at = NULL,',
        '  last_sync_run_id = COALESCE(excluded.last_sync_run_id, collection_items.last_sync_run_id)'
      ].join(' ')
    );
    var upsertState = this.db.prepare(
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

    this.db.exec('BEGIN IMMEDIATE');

    try {
      for (var n = 0; n < normalizedRows.length; n++) {
        var video = normalizedRows[n];
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
        upsertItem.run(collectionKey, video.url, timestamp, timestamp, video.siteOrder, syncRunId);
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

  /**
   * @param {CollectionTogglePayload | null | undefined} payload
   * @returns {{ action: 'add' | 'remove', changed: boolean, collectionKey: CollectionKey, url: string, visible: boolean }}
   */
  applyCollectionToggle(payload: CollectionTogglePayload | null | undefined): {
    action: 'add' | 'remove';
    changed: boolean;
    collectionKey: CollectionKey;
    url: string;
    visible: boolean;
  } {
    payload = payload || {};

    var collectionKey = payload.collectionKey;
    if (!collectionKey) throw new Error('Collection toggle requires a collection key');
    this.ensureCollection(collectionKey);

    var action: 'add' | 'remove' = payload.action === 'remove' ? 'remove' : 'add';
    var video = normalizeVideo(payload.video || payload);
    if (!video || !video.url) throw new Error('Collection toggle requires a video URL');

    var timestamp = nowIso();

    if (action === 'remove') {
      var removeResult = this.db
        .prepare(
          [
            'UPDATE collection_items',
            'SET is_visible = 0, missing_at = ?, last_seen_at = ?',
            'WHERE collection_key = ?',
            '  AND video_url = ?',
            '  AND is_visible = 1'
          ].join(' ')
        )
        .run(timestamp, timestamp, collectionKey, video.url);

      return {
        action: action,
        changed: !!(removeResult && removeResult.changes),
        collectionKey: collectionKey,
        url: video.url,
        visible: false
      };
    }

    var upsertVideo = this.db.prepare(
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
    var upsertItem = this.db.prepare(
      [
        'INSERT INTO collection_items (',
        '  collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id',
        ')',
        'VALUES (?, ?, ?, ?, ?, 1, NULL, NULL)',
        'ON CONFLICT(collection_key, video_url) DO UPDATE SET',
        '  last_seen_at = excluded.last_seen_at,',
        '  site_order = COALESCE(excluded.site_order, collection_items.site_order),',
        '  is_visible = 1,',
        '  missing_at = NULL'
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
        video.siteOrder === null ? -Date.now() : video.siteOrder
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return {
      action: action,
      changed: true,
      collectionKey: collectionKey,
      url: video.url,
      visible: true
    };
  }

  /**
   * @param {FinishSyncInput} payload
   * @returns {SyncState}
   */
  finishSync(payload: FinishSyncInput): SyncState {
    var collectionKey = payload.collectionKey;
    this.ensureCollection(collectionKey);

    var result: SyncResultInput = payload.result || {};
    var timestamp = nowIso();
    var lastScrapedPage = normalizeNumber(result.lastScrapedPage);
    var lastKnownUrl = normalizeText(result.lastKnownUrl);
    var completed = result.completed === false ? 0 : 1;
    var mode = normalizeText(payload.mode || result.mode);
    var syncRunId = normalizeText(payload.syncRunId || result.syncRunId);
    var hidden = 0;

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
      var update = this.db
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

    var state = this.getSyncState(collectionKey);
    if (!state) throw new Error('Sync state was not saved for collection: ' + collectionKey);
    state.hidden = hidden;
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

    var rows = flattenResource(resource);
    for (var i = 0; i < rows.length; i++) {
      var siteOrder = normalizeNumber(readSiteOrder(rows[i]));
      rows[i].siteOrder = siteOrder === null ? i + 1 : siteOrder;
    }
    var saved = this.saveSyncPage({
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

    var collection = collectionByKey(collectionKey);
    if (!collection) throw new Error('Unknown collection: ' + collectionKey);
    var rows = this.listVideos(collectionKey, { sort: 'site_order', direction: 'asc' });
    var state = this.getSyncState(collectionKey);
    var pages = rowsByPage(rows);
    var exportedAt = nowIso();

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

    var collection = collectionByKey(collectionKey);
    if (!collection) throw new Error('Unknown collection: ' + collectionKey);
    var state = this.getSyncState(collectionKey);
    var exportedAt = nowIso();
    var total = this.countVideos(collectionKey);
    var pageCount = Math.ceil(total / PAGE_SIZE);
    var meta = exportMeta(collection, state, exportedAt, total, pageCount);
    var tempPath = exportTempPath(filePath);
    var handle: FileHandle | null = null;
    var offset = 0;
    var pageNumber = 1;
    var hasPages = false;

    try {
      handle = await fs.promises.open(tempPath, 'w');
      await handle.write('{"data":[');

      while (offset < total) {
        var rows = this.listVideos(collectionKey, {
          sort: 'site_order',
          direction: 'asc',
          limit: EXPORT_BATCH_SIZE,
          offset: offset
        });

        if (!rows.length) break;

        for (var i = 0; i < rows.length; i += PAGE_SIZE) {
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
