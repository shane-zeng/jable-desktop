'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var JableDatabase = require('../app/database').JableDatabase;

function createTestDatabase(t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-db-'));
  var dbPath = path.join(dir, 'test.sqlite');
  var db = new JableDatabase(dbPath);

  t.after(function () {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return db;
}

test('saveSyncPage upserts videos and keeps one collection item per URL', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: [
      {
        title: 'First title',
        url: 'https://jable.tv/videos/first/',
        views: 100,
        likes: 10,
        img: 'https://example.test/first.jpg',
        preview: 'https://example.test/first.mp4'
      }
    ]
  });
  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: [
      {
        title: 'Updated title',
        url: 'https://jable.tv/videos/first/',
        views: 120,
        likes: 12,
        img: 'https://example.test/first-new.jpg',
        preview: 'https://example.test/first-new.mp4'
      }
    ]
  });
  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: [
      {
        title: 'Title without media',
        url: 'https://jable.tv/videos/first/'
      }
    ]
  });

  var rows = db.listVideos('favourites');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Title without media');
  assert.equal(rows[0].views, 120);
  assert.equal(rows[0].img, 'https://example.test/first-new.jpg');
  assert.deepEqual(db.getCollectionUrls('favourites'), ['https://jable.tv/videos/first/']);
});

test('migration removes legacy playback state table', function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-db-'));
  var dbPath = path.join(dir, 'test.sqlite');
  var db = new JableDatabase(dbPath);

  db.db.exec([
    'CREATE TABLE playback_states (',
    '  video_url TEXT PRIMARY KEY,',
    '  current_time REAL NOT NULL DEFAULT 0,',
    '  duration REAL,',
    '  updated_at TEXT NOT NULL',
    ');'
  ].join('\n'));
  assert.ok(db.db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'playback_states'));
  db.close();

  db = new JableDatabase(dbPath);
  t.after(function () {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(db.db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'playback_states'), undefined);
});

test('importResource accepts userscript paged JSON and exportResource keeps the resource shape', function (t) {
  var db = createTestDatabase(t);
  var resource = {
    data: [
      {
        data: [
          {
            title: 'Imported video',
            url: 'https://jable.tv/videos/imported/',
            views: 200,
            likes: 20,
            img: null,
            preview: null
          }
        ],
        meta: {
          current_page: 1,
          per_page: 24,
          count: 1
        }
      }
    ],
    meta: {
      format_version: 2,
      completed: true,
      last_scraped_page: 1
    }
  };

  var result = db.importResource('watch_later', resource);
  assert.equal(result.imported, 1);

  var exported = db.exportResource('watch_later');
  assert.equal(exported.meta.format_version, 2);
  assert.equal(exported.meta.completed, true);
  assert.equal(exported.meta.total, 1);
  assert.equal(exported.data[0].data[0].url, 'https://jable.tv/videos/imported/');
});
