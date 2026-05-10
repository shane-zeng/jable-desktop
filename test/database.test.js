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

test('savePlaybackState stores progress and listVideos exposes it', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: [
      {
        title: 'Playback video',
        url: 'https://jable.tv/videos/playback/',
        views: 300,
        likes: 30
      }
    ]
  });

  var result = db.savePlaybackState({
    url: 'https://jable.tv/videos/playback/?from=test',
    currentTime: 125.5,
    duration: 3600
  });

  assert.equal(result.saved, true);
  assert.equal(result.video_url, 'https://jable.tv/videos/playback/');

  var rows = db.listVideos('favourites');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].playback_current_time, 125.5);
  assert.equal(rows[0].playback_duration, 3600);
  assert.ok(rows[0].playback_updated_at);

  var state = db.getPlaybackState('https://jable.tv/videos/playback/?foo=bar');
  assert.equal(state.video_url, 'https://jable.tv/videos/playback/');
  assert.equal(state.current_time, 125.5);
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
