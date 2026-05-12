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

  return {
    url: normalizeVideoUrl(row.url),
    title: normalizeText(row.title),
    views: normalizeNumber(row.views),
    likes: normalizeNumber(row.likes),
    img: normalizeText(row.img),
    preview: normalizeText(row.preview)
  };
}

function exportVideo(row) {
  return {
    title: row.title,
    url: row.url,
    views: row.views,
    likes: row.likes,
    img: row.img,
    preview: row.preview
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
    var chunk = rows.slice(i, i + PAGE_SIZE).map(exportVideo);

    pages.push({
      data: chunk,
      meta: {
        current_page: Math.floor(i / PAGE_SIZE) + 1,
        per_page: PAGE_SIZE,
        count: chunk.length,
        first_url: chunk.length ? chunk[0].url : null,
        last_url: chunk.length ? chunk[chunk.length - 1].url : null,
        exported_at: exportedAt
      }
    });
  }

  return pages;
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
  this.db.exec([
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
  ].join('\n'));
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

  var row = this.db.prepare([
    'SELECT collection_key, completed, last_scraped_page, last_known_url, updated_at',
    'FROM sync_states',
    'WHERE collection_key = ?'
  ].join(' ')).get(collectionKey);

  if (!row) return null;
  row.completed = !!row.completed;
  return row;
};

JableDatabase.prototype.listVideos = function (collectionKey, options) {
  this.ensureCollection(collectionKey);
  options = options || {};

  var sortMap = {
    title: 'v.title',
    views: 'v.views',
    likes: 'v.likes',
    updated_at: 'v.updated_at',
    last_seen_at: 'ci.last_seen_at'
  };
  var sort = sortMap[options.sort] || 'ci.last_seen_at';
  var direction = options.direction === 'asc' ? 'ASC' : 'DESC';
  var params = [collectionKey];
  var where = 'WHERE ci.collection_key = ?';

  if (options.search && String(options.search).trim()) {
    where += ' AND (LOWER(v.title) LIKE LOWER(?) OR v.url LIKE ?)';
    var like = '%' + String(options.search).trim() + '%';
    params.push(like, like);
  }

  var sql = [
    'SELECT v.url, v.title, v.views, v.likes, v.img, v.preview,',
    '       v.created_at, v.updated_at, ci.first_seen_at, ci.last_seen_at',
    'FROM collection_items ci',
    'JOIN videos v ON v.url = ci.video_url',
    where,
    'ORDER BY ' + sort + ' ' + direction + ', v.url ASC'
  ].join(' ');
  var stmt = this.db.prepare(sql);

  return stmt.all.apply(stmt, params);
};

JableDatabase.prototype.getCollectionUrls = function (collectionKey) {
  this.ensureCollection(collectionKey);

  var rows = this.db.prepare([
    'SELECT video_url',
    'FROM collection_items',
    'WHERE collection_key = ?',
    'ORDER BY last_seen_at DESC'
  ].join(' ')).all(collectionKey);

  return rows.map(function (row) { return row.video_url; });
};

JableDatabase.prototype.saveSyncPage = function (payload) {
  var collectionKey = payload.collectionKey;
  this.ensureCollection(collectionKey);

  var page = normalizeNumber(payload.page) || null;
  var rows = Array.isArray(payload.rows) ? payload.rows : [];
  var normalizedRows = [];

  for (var i = 0; i < rows.length; i++) {
    var row = normalizeVideo(rows[i]);
    if (row) normalizedRows.push(row);
  }

  var timestamp = nowIso();
  var upsertVideo = this.db.prepare([
    'INSERT INTO videos (url, title, views, likes, img, preview, created_at, updated_at)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    'ON CONFLICT(url) DO UPDATE SET',
    '  title = COALESCE(excluded.title, videos.title),',
    '  views = COALESCE(excluded.views, videos.views),',
    '  likes = COALESCE(excluded.likes, videos.likes),',
    '  img = COALESCE(excluded.img, videos.img),',
    '  preview = COALESCE(excluded.preview, videos.preview),',
    '  updated_at = excluded.updated_at'
  ].join(' '));
  var upsertItem = this.db.prepare([
    'INSERT INTO collection_items (collection_key, video_url, first_seen_at, last_seen_at)',
    'VALUES (?, ?, ?, ?)',
    'ON CONFLICT(collection_key, video_url) DO UPDATE SET',
    '  last_seen_at = excluded.last_seen_at'
  ].join(' '));
  var upsertState = this.db.prepare([
    'INSERT INTO sync_states (collection_key, completed, last_scraped_page, last_known_url, updated_at)',
    'VALUES (?, 0, ?, ?, ?)',
    'ON CONFLICT(collection_key) DO UPDATE SET',
    '  completed = 0,',
    '  last_scraped_page = excluded.last_scraped_page,',
    '  last_known_url = excluded.last_known_url,',
    '  updated_at = excluded.updated_at'
  ].join(' '));

  this.db.exec('BEGIN IMMEDIATE');

  try {
    for (var n = 0; n < normalizedRows.length; n++) {
      var video = normalizedRows[n];
      upsertVideo.run(video.url, video.title, video.views, video.likes, video.img, video.preview, timestamp, timestamp);
      upsertItem.run(collectionKey, video.url, timestamp, timestamp);
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

  this.db.prepare([
    'INSERT INTO sync_states (collection_key, completed, last_scraped_page, last_known_url, updated_at)',
    'VALUES (?, 1, ?, ?, ?)',
    'ON CONFLICT(collection_key) DO UPDATE SET',
    '  completed = 1,',
    '  last_scraped_page = COALESCE(excluded.last_scraped_page, sync_states.last_scraped_page),',
    '  last_known_url = COALESCE(excluded.last_known_url, sync_states.last_known_url),',
    '  updated_at = excluded.updated_at'
  ].join(' ')).run(collectionKey, lastScrapedPage, lastKnownUrl, timestamp);

  return this.getSyncState(collectionKey);
};

JableDatabase.prototype.clearSyncState = function (collectionKey) {
  this.ensureCollection(collectionKey);
  this.db.prepare('DELETE FROM sync_states WHERE collection_key = ?').run(collectionKey);

  return { collectionKey: collectionKey, cleared: true };
};

JableDatabase.prototype.importResource = function (collectionKey, resource) {
  this.ensureCollection(collectionKey);

  var rows = flattenResource(resource);
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
  var rows = this.listVideos(collectionKey, { sort: 'last_seen_at', direction: 'desc' });
  var state = this.getSyncState(collectionKey);
  var pages = rowsByPage(rows);

  return {
    data: pages,
    meta: {
      format_version: 2,
      source_path: collection.sourcePath,
      source_url: 'https://jable.tv' + collection.sourcePath,
      exported_at: nowIso(),
      completed: !!(state && state.completed),
      per_page: PAGE_SIZE,
      page_count: pages.length,
      total: rows.length,
      last_page: pages.length ? pages[pages.length - 1].meta.current_page : null,
      last_scraped_page: state ? state.last_scraped_page : null
    }
  };
};

module.exports = {
  COLLECTIONS: COLLECTIONS,
  JableDatabase: JableDatabase,
  flattenResource: flattenResource,
  normalizeVideoUrl: normalizeVideoUrl
};
