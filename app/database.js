'use strict';

var fs = require('node:fs');
var path = require('node:path');

var DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (error) {
  throw new Error('node:sqlite is required. Use Node.js 24+ or an Electron version that includes node:sqlite.');
}

var PAGE_SIZE = 24;
var EXPORT_BATCH_SIZE = PAGE_SIZE * 100;
var SEARCH_NGRAM_MAX = 3;

var COLLECTIONS = [
  { key: 'favourites', name: '影片收藏', sourcePath: '/my/favourites/videos/' },
  { key: 'watch_later', name: '稍後觀看', sourcePath: '/my/favourites/videos-watch-later/' }
];

function nowIso() {
  return new Date().toISOString();
}

function collectionByKey(key) {
  for (var i = 0; i < COLLECTIONS.length; i++) {
    if (COLLECTIONS[i].key === key) return COLLECTIONS[i];
  }

  return null;
}

function normalizeNumber(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  if (value === null || typeof value === 'undefined') return null;
  var text = String(value).trim();
  return text || null;
}

function normalizeVideoUrl(value) {
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

function normalizeVideo(row) {
  if (!row || !row.url) return null;

  var video = {
    url: normalizeVideoUrl(row.url),
    title: normalizeText(row.title),
    views: normalizeNumber(row.views),
    likes: normalizeNumber(row.likes),
    img: normalizeText(row.img),
    preview: normalizeText(row.preview),
    siteOrder: normalizeNumber(readSiteOrder(row))
  };

  video.searchText = buildVideoSearchText(video.title, video.url);

  return video;
}

function readSiteOrder(row) {
  if (!row) return null;
  if (typeof row.siteOrder !== 'undefined') return row.siteOrder;
  if (typeof row.site_order !== 'undefined') return row.site_order;
  return row.sort_order;
}

function exportVideo(row) {
  return {
    title: row.title,
    url: row.url,
    views: row.views,
    likes: row.likes,
    img: row.img,
    preview: row.preview,
    site_order: row.site_order
  };
}

function exportPage(rows, pageNumber, exportedAt) {
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

function exportMeta(collection, state, exportedAt, total, pageCount) {
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

function flattenResource(resource) {
  var rows = [];
  if (!resource || !Array.isArray(resource.data)) return rows;

  for (var i = 0; i < resource.data.length; i++) {
    var item = resource.data[i];
    if (!item) continue;

    if (Array.isArray(item.data)) rows = rows.concat(item.data);
    else if (item.url) rows.push(item);
  }

  return rows;
}

function rowsByPage(rows) {
  var pages = [];
  var exportedAt = nowIso();

  for (var i = 0; i < rows.length; i += PAGE_SIZE) {
    pages.push(exportPage(rows.slice(i, i + PAGE_SIZE), Math.floor(i / PAGE_SIZE) + 1, exportedAt));
  }

  return pages;
}

function isCjkSearchChar(char) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);
}

function isSearchWordChar(char) {
  return /[\p{Letter}\p{Number}]/u.test(char);
}

function searchRuns(value) {
  var text = value ? String(value).normalize('NFKC').toLowerCase() : '';
  var runs = [];
  var current = '';
  var currentType = null;

  for (var char of text) {
    var charType = null;
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

function addSearchToken(tokens, token) {
  if (token) tokens[token] = true;
}

function addSearchNgrams(tokens, run) {
  var chars = Array.from(run);
  var maxSize = Math.min(SEARCH_NGRAM_MAX, chars.length);

  for (var size = 1; size <= maxSize; size++) {
    for (var i = 0; i <= chars.length - size; i++) {
      addSearchToken(tokens, chars.slice(i, i + size).join(''));
    }
  }
}

function collectSearchTokens(values) {
  var tokens = {};

  for (var i = 0; i < values.length; i++) {
    var runs = searchRuns(values[i]);
    for (var n = 0; n < runs.length; n++) {
      addSearchNgrams(tokens, runs[n]);
    }
  }

  return Object.keys(tokens);
}

function compactSearchValue(value) {
  var text = value ? String(value).normalize('NFKC').toLowerCase() : '';
  var compact = '';

  for (var char of text) {
    if (isCjkSearchChar(char) || isSearchWordChar(char)) compact += char;
  }

  return compact;
}

function collectPhraseTokens(values) {
  var tokens = {};

  for (var i = 0; i < values.length; i++) {
    var compact = compactSearchValue(values[i]);
    if (compact) addSearchNgrams(tokens, compact);
  }

  return Object.keys(tokens);
}

function buildVideoSearchText(title, url) {
  var tokens = {};
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

function searchQueryTokensForRun(run) {
  var chars = Array.from(run);
  if (chars.length <= SEARCH_NGRAM_MAX) return [run];

  var tokens = [];
  for (var i = 0; i <= chars.length - SEARCH_NGRAM_MAX; i++) {
    tokens.push(chars.slice(i, i + SEARCH_NGRAM_MAX).join(''));
  }

  return tokens;
}

function quoteFtsToken(token) {
  return '"' + String(token).replace(/"/g, '""') + '"';
}

function buildSearchRunQuery(run) {
  return searchQueryTokensForRun(run).map(quoteFtsToken).join(' AND ');
}

function buildSearchTermQuery(term) {
  var runs = searchRuns(term);
  var runQueries = [];

  for (var i = 0; i < runs.length; i++) {
    runQueries.push(buildSearchRunQuery(runs[i]));
  }

  return runQueries.length ? '(' + runQueries.join(' AND ') + ')' : null;
}

function buildSearchPhraseQuery(value) {
  var compact = compactSearchValue(value);
  if (!compact) return null;

  return '(' + searchQueryTokensForRun(compact).map(quoteFtsToken).join(' AND ') + ')';
}

function buildSearchMatchQuery(value, mode) {
  if (mode === 'phrase') return buildSearchPhraseQuery(value);

  var terms = value ? String(value).trim().split(/\s+/) : [];
  var termQueries = [];

  for (var i = 0; i < terms.length; i++) {
    var query = buildSearchTermQuery(terms[i]);
    if (query) termQueries.push(query);
  }

  if (!termQueries.length) return null;

  return termQueries.join(mode === 'all' ? ' AND ' : ' OR ');
}

function buildVideoListQuery(collectionKey, options) {
  options = options || {};

  var sortMap = {
    site_order: 'site_order',
    title: 'v.title',
    views: 'v.views',
    likes: 'v.likes',
    updated_at: 'v.updated_at',
    last_seen_at: 'ci.last_seen_at'
  };
  var sortKey = sortMap[options.sort] ? options.sort : 'site_order';
  var sort = sortMap[sortKey];
  var direction = options.direction
    ? options.direction === 'asc'
      ? 'ASC'
      : 'DESC'
    : sortKey === 'site_order'
      ? 'ASC'
      : 'DESC';
  var searchMode = options.searchMode === 'all' || options.searchMode === 'phrase' ? options.searchMode : 'any';
  var matchQuery = options.search ? buildSearchMatchQuery(options.search, searchMode) : null;
  var params = [collectionKey];
  var joins = [];
  var where = 'WHERE ci.collection_key = ?';

  if (!options.includeHidden) {
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

function normalizeLimit(value) {
  var number = normalizeNumber(value);
  if (number === null || number <= 0) return null;
  return Math.floor(number);
}

function normalizeOffset(value) {
  var number = normalizeNumber(value);
  if (number === null || number <= 0) return 0;
  return Math.floor(number);
}

function exportTempPath(filePath) {
  return filePath + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function nextTick() {
  return new Promise(function (resolve) {
    setImmediate(resolve);
  });
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function JableDatabase(filePath) {
  ensureDirectory(filePath);
  this.filePath = filePath;
  this.db = new DatabaseSync(filePath);
  this.db.exec('PRAGMA foreign_keys = ON');
  this.db.exec('PRAGMA journal_mode = WAL');
  this.migrate();
  this.seedCollections();
}

JableDatabase.prototype.close = function () {
  this.db.close();
};

JableDatabase.prototype.migrate = function () {
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
};

JableDatabase.prototype.backfillVideoSearchText = function () {
  var rows = this.db.prepare('SELECT url, title FROM videos WHERE search_text IS NULL').all();
  if (!rows.length) return false;

  var update = this.db.prepare('UPDATE videos SET search_text = ? WHERE url = ?');

  for (var i = 0; i < rows.length; i++) {
    update.run(buildVideoSearchText(rows[i].title, rows[i].url), rows[i].url);
  }

  return true;
};

JableDatabase.prototype.videoSearchIndexHasExpectedColumns = function () {
  var columns = this.db.prepare('PRAGMA table_info(video_search)').all();
  var names = {};

  for (var i = 0; i < columns.length; i++) {
    names[columns[i].name] = true;
  }

  return !!(names.title && names.url && names.search_text);
};

JableDatabase.prototype.dropVideoSearchTriggers = function () {
  this.db.exec(
    [
      'DROP TRIGGER IF EXISTS videos_ai;',
      'DROP TRIGGER IF EXISTS videos_ad;',
      'DROP TRIGGER IF EXISTS videos_au;'
    ].join('\n')
  );
};

JableDatabase.prototype.ensureVideoSearchIndex = function (searchTextChanged) {
  var indexExists = this.db
    .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', 'video_search');
  var insertTriggerExists = this.db
    .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
    .get('trigger', 'videos_ai');
  var deleteTriggerExists = this.db
    .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
    .get('trigger', 'videos_ad');
  var updateTriggerExists = this.db
    .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
    .get('trigger', 'videos_au');
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
};

JableDatabase.prototype.ensureColumn = function (tableName, columnName, definition) {
  var columns = this.db.prepare('PRAGMA table_info(' + tableName + ')').all();

  for (var i = 0; i < columns.length; i++) {
    if (columns[i].name === columnName) return;
  }

  this.db.exec('ALTER TABLE ' + tableName + ' ADD COLUMN ' + columnName + ' ' + definition);
};

JableDatabase.prototype.seedCollections = function () {
  var stmt = this.db.prepare('INSERT OR IGNORE INTO collections (key, name) VALUES (?, ?)');

  for (var i = 0; i < COLLECTIONS.length; i++) {
    stmt.run(COLLECTIONS[i].key, COLLECTIONS[i].name);
  }
};

JableDatabase.prototype.ensureCollection = function (collectionKey) {
  if (!collectionByKey(collectionKey)) throw new Error('Unknown collection: ' + collectionKey);
};

JableDatabase.prototype.listCollections = function () {
  return this.db.prepare('SELECT key, name FROM collections ORDER BY key').all();
};

JableDatabase.prototype.getSyncState = function (collectionKey) {
  this.ensureCollection(collectionKey);

  var row = this.db
    .prepare(
      [
        'SELECT collection_key, completed, last_scraped_page, last_known_url, updated_at',
        'FROM sync_states',
        'WHERE collection_key = ?'
      ].join(' ')
    )
    .get(collectionKey);

  if (!row) return null;
  row.completed = !!row.completed;
  return row;
};

JableDatabase.prototype.listVideos = function (collectionKey, options) {
  this.ensureCollection(collectionKey);
  options = options || {};

  var query = buildVideoListQuery(collectionKey, options);
  var limit = normalizeLimit(options.limit);
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
    query.params.push(limit, normalizeOffset(options.offset));
  }

  var stmt = this.db.prepare(sql);

  return stmt.all.apply(stmt, query.params);
};

JableDatabase.prototype.countVideos = function (collectionKey, options) {
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
  var row = stmt.get.apply(stmt, query.params);

  return row ? row.total : 0;
};

JableDatabase.prototype.getCollectionUrls = function (collectionKey) {
  this.ensureCollection(collectionKey);

  var rows = this.db
    .prepare(
      ['SELECT video_url', 'FROM collection_items', 'WHERE collection_key = ?', 'ORDER BY last_seen_at DESC'].join(' ')
    )
    .all(collectionKey);

  return rows.map(function (row) {
    return row.video_url;
  });
};

JableDatabase.prototype.allCollectionUrlsKnown = function (collectionKey, urls) {
  this.ensureCollection(collectionKey);

  if (!Array.isArray(urls) || !urls.length) return false;

  var seen = {};
  var normalizedUrls = [];

  for (var i = 0; i < urls.length; i++) {
    var url = normalizeVideoUrl(urls[i]);
    if (!url) return false;

    if (!seen[url]) {
      seen[url] = true;
      normalizedUrls.push(url);
    }
  }

  if (!normalizedUrls.length) return false;

  var placeholders = [];
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
  var params = [collectionKey].concat(normalizedUrls);
  var row = stmt.get.apply(stmt, params);

  return !!row && row.total === normalizedUrls.length;
};

JableDatabase.prototype.saveSyncPage = function (payload) {
  var collectionKey = payload.collectionKey;
  this.ensureCollection(collectionKey);

  var page = normalizeNumber(payload.page) || null;
  var syncRunId = normalizeText(payload.syncRunId);
  var rows = Array.isArray(payload.rows) ? payload.rows : [];
  var normalizedRows = [];

  for (var i = 0; i < rows.length; i++) {
    var row = normalizeVideo(rows[i]);
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
};

JableDatabase.prototype.finishSync = function (payload) {
  var collectionKey = payload.collectionKey;
  this.ensureCollection(collectionKey);

  var result = payload.result || {};
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
    hidden = update.changes || 0;
  }

  var state = this.getSyncState(collectionKey);
  state.hidden = hidden;
  return state;
};

JableDatabase.prototype.clearSyncState = function (collectionKey) {
  this.ensureCollection(collectionKey);
  this.db.prepare('DELETE FROM sync_states WHERE collection_key = ?').run(collectionKey);

  return { collectionKey: collectionKey, cleared: true };
};

JableDatabase.prototype.importResource = function (collectionKey, resource) {
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
};

JableDatabase.prototype.exportResource = function (collectionKey) {
  this.ensureCollection(collectionKey);

  var collection = collectionByKey(collectionKey);
  var rows = this.listVideos(collectionKey, { sort: 'site_order', direction: 'asc' });
  var state = this.getSyncState(collectionKey);
  var pages = rowsByPage(rows);
  var exportedAt = nowIso();

  return {
    data: pages,
    meta: exportMeta(collection, state, exportedAt, rows.length, pages.length)
  };
};

JableDatabase.prototype.exportResourceToFile = async function (collectionKey, filePath) {
  this.ensureCollection(collectionKey);
  if (!filePath) throw new Error('Export file path is required');

  ensureDirectory(filePath);

  var collection = collectionByKey(collectionKey);
  var state = this.getSyncState(collectionKey);
  var exportedAt = nowIso();
  var total = this.countVideos(collectionKey);
  var pageCount = Math.ceil(total / PAGE_SIZE);
  var meta = exportMeta(collection, state, exportedAt, total, pageCount);
  var tempPath = exportTempPath(filePath);
  var handle = null;
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
};

module.exports = {
  COLLECTIONS: COLLECTIONS,
  JableDatabase: JableDatabase,
  flattenResource: flattenResource,
  normalizeVideoUrl: normalizeVideoUrl
};
