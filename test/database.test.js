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

test('saveSyncPage stores and lists videos by site order', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    syncRunId: 'run-ordered',
    rows: [
      {
        title: 'Second on site',
        url: 'https://jable.tv/videos/second/',
        views: 2,
        likes: 2,
        siteOrder: 2
      },
      {
        title: 'First on site',
        url: 'https://jable.tv/videos/first/',
        views: 1,
        likes: 1,
        siteOrder: 1
      }
    ]
  });

  var rows = db.listVideos('favourites');
  assert.deepEqual(
    rows.map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/first/', 'https://jable.tv/videos/second/']
  );
  assert.deepEqual(
    rows.map(function (row) {
      return row.site_order;
    }),
    [1, 2]
  );
});

test('listVideos puts legacy rows without site order after ordered rows', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: [
      {
        title: 'Legacy row',
        url: 'https://jable.tv/videos/legacy/',
        views: 1,
        likes: 1
      }
    ]
  });
  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    syncRunId: 'run-ordered',
    rows: [
      {
        title: 'Ordered row',
        url: 'https://jable.tv/videos/ordered/',
        views: 2,
        likes: 2,
        siteOrder: 1
      }
    ]
  });

  var rows = db.listVideos('favourites');
  assert.deepEqual(
    rows.map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/ordered/', 'https://jable.tv/videos/legacy/']
  );
});

test('listVideos supports limit and offset', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: [
      {
        title: 'First',
        url: 'https://jable.tv/videos/first/',
        siteOrder: 1
      },
      {
        title: 'Second',
        url: 'https://jable.tv/videos/second/',
        siteOrder: 2
      },
      {
        title: 'Third',
        url: 'https://jable.tv/videos/third/',
        siteOrder: 3
      }
    ]
  });

  var rows = db.listVideos('favourites', {
    sort: 'site_order',
    direction: 'asc',
    limit: 2,
    offset: 1
  });

  assert.deepEqual(
    rows.map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/second/', 'https://jable.tv/videos/third/']
  );
});

test('countVideos uses the same search and visibility filters as listVideos', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'watch_later',
    page: 1,
    syncRunId: 'old-run',
    rows: [
      {
        title: 'Visible target',
        url: 'https://jable.tv/videos/visible-target/',
        siteOrder: 1
      },
      {
        title: 'Hidden target',
        url: 'https://jable.tv/videos/hidden-target/',
        siteOrder: 2
      }
    ]
  });
  db.saveSyncPage({
    collectionKey: 'watch_later',
    page: 1,
    syncRunId: 'full-run',
    rows: [
      {
        title: 'Visible target',
        url: 'https://jable.tv/videos/visible-target/',
        siteOrder: 1
      }
    ]
  });
  db.finishSync({
    collectionKey: 'watch_later',
    mode: 'full',
    syncRunId: 'full-run',
    result: { completed: true, lastScrapedPage: 1 }
  });

  assert.equal(db.countVideos('watch_later'), 1);
  assert.equal(db.countVideos('watch_later', { includeHidden: true }), 2);
  assert.equal(db.countVideos('watch_later', { search: 'target' }), 1);
  assert.equal(db.countVideos('watch_later', { search: 'hidden', includeHidden: true }), 1);
});

test('quick sync updates scanned rows without hiding unscanned rows', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    syncRunId: 'old-run',
    rows: [
      {
        title: 'Scanned row',
        url: 'https://jable.tv/videos/scanned/',
        views: 10,
        likes: 1,
        siteOrder: 1
      },
      {
        title: 'Unscanned row',
        url: 'https://jable.tv/videos/unscanned/',
        views: 20,
        likes: 2,
        siteOrder: 2
      }
    ]
  });
  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    syncRunId: 'quick-run',
    rows: [
      {
        title: 'Scanned row',
        url: 'https://jable.tv/videos/scanned/',
        views: 99,
        likes: 9,
        siteOrder: 1
      }
    ]
  });
  db.finishSync({
    collectionKey: 'favourites',
    mode: 'quick',
    syncRunId: 'quick-run',
    result: { completed: true, lastScrapedPage: 1 }
  });

  var rows = db.listVideos('favourites');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].views, 99);
  assert.equal(rows[1].url, 'https://jable.tv/videos/unscanned/');
  assert.equal(rows[1].is_visible, 1);
});

test('completed full sync hides rows missing from the sync run', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'watch_later',
    page: 1,
    syncRunId: 'old-run',
    rows: [
      {
        title: 'Still present',
        url: 'https://jable.tv/videos/present/',
        views: 10,
        likes: 1,
        siteOrder: 1
      },
      {
        title: 'Missing now',
        url: 'https://jable.tv/videos/missing/',
        views: 20,
        likes: 2,
        siteOrder: 2
      }
    ]
  });
  db.saveSyncPage({
    collectionKey: 'watch_later',
    page: 1,
    syncRunId: 'full-run',
    rows: [
      {
        title: 'Still present',
        url: 'https://jable.tv/videos/present/',
        views: 30,
        likes: 3,
        siteOrder: 1
      }
    ]
  });
  var state = db.finishSync({
    collectionKey: 'watch_later',
    mode: 'full',
    syncRunId: 'full-run',
    result: { completed: true, lastScrapedPage: 1 }
  });

  assert.equal(state.hidden, 1);
  assert.deepEqual(
    db.listVideos('watch_later').map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/present/']
  );

  var allRows = db.listVideos('watch_later', { includeHidden: true });
  assert.equal(allRows.length, 2);
  assert.equal(allRows[1].is_visible, 0);
  assert.ok(allRows[1].missing_at);
});

test('incomplete full sync does not hide rows missing from the sync run', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'watch_later',
    page: 1,
    syncRunId: 'old-run',
    rows: [
      {
        title: 'Still present',
        url: 'https://jable.tv/videos/present/',
        views: 10,
        likes: 1,
        siteOrder: 1
      },
      {
        title: 'Maybe later page',
        url: 'https://jable.tv/videos/later-page/',
        views: 20,
        likes: 2,
        siteOrder: 2
      }
    ]
  });
  db.saveSyncPage({
    collectionKey: 'watch_later',
    page: 1,
    syncRunId: 'full-run',
    rows: [
      {
        title: 'Still present',
        url: 'https://jable.tv/videos/present/',
        views: 30,
        likes: 3,
        siteOrder: 1
      }
    ]
  });
  var state = db.finishSync({
    collectionKey: 'watch_later',
    mode: 'full',
    syncRunId: 'full-run',
    result: { completed: false, incompleteReason: 'batch-limit', lastScrapedPage: 1 }
  });

  assert.equal(state.hidden, 0);
  assert.equal(state.completed, false);
  assert.equal(db.listVideos('watch_later').length, 2);
});

test('migration removes legacy playback state table', function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-db-'));
  var dbPath = path.join(dir, 'test.sqlite');
  var db = new JableDatabase(dbPath);

  db.db.exec(
    [
      'CREATE TABLE playback_states (',
      '  video_url TEXT PRIMARY KEY,',
      '  current_time REAL NOT NULL DEFAULT 0,',
      '  duration REAL,',
      '  updated_at TEXT NOT NULL',
      ');'
    ].join('\n')
  );
  assert.ok(
    db.db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'playback_states')
  );
  db.close();

  db = new JableDatabase(dbPath);
  t.after(function () {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(
    db.db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'playback_states'),
    undefined
  );
});

test('importResource accepts userscript paged JSON and exportResource includes site order', function (t) {
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
          },
          {
            title: 'Imported video 2',
            url: 'https://jable.tv/videos/imported-2/',
            views: 300,
            likes: 30,
            img: null,
            preview: null
          }
        ],
        meta: {
          current_page: 1,
          per_page: 24,
          count: 2
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
  assert.equal(result.imported, 2);

  var exported = db.exportResource('watch_later');
  assert.equal(exported.meta.format_version, 2);
  assert.equal(exported.meta.completed, true);
  assert.equal(exported.meta.total, 2);
  assert.equal(exported.data[0].data[0].url, 'https://jable.tv/videos/imported/');
  assert.equal(exported.data[0].data[1].url, 'https://jable.tv/videos/imported-2/');
  assert.deepEqual(
    exported.data[0].data.map(function (row) {
      return row.site_order;
    }),
    [1, 2]
  );
});

test('importResource preserves explicit site_order from desktop JSON', function (t) {
  var db = createTestDatabase(t);
  var resource = {
    data: [
      {
        data: [
          {
            title: 'Second',
            url: 'https://jable.tv/videos/second/',
            views: 20,
            likes: 2,
            site_order: 2
          },
          {
            title: 'First',
            url: 'https://jable.tv/videos/first/',
            views: 10,
            likes: 1,
            site_order: 1
          }
        ]
      }
    ],
    meta: {
      format_version: 2,
      completed: true,
      last_scraped_page: 1
    }
  };

  db.importResource('favourites', resource);

  var exported = db.exportResource('favourites');
  assert.deepEqual(
    exported.data[0].data.map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/first/', 'https://jable.tv/videos/second/']
  );
  assert.deepEqual(
    exported.data[0].data.map(function (row) {
      return row.site_order;
    }),
    [1, 2]
  );
});

test('importResource accepts sort_order as an import alias and exports site_order', function (t) {
  var db = createTestDatabase(t);
  var resource = {
    data: [
      {
        title: 'Alias second',
        url: 'https://jable.tv/videos/alias-second/',
        views: 20,
        likes: 2,
        sort_order: 2
      },
      {
        title: 'Alias first',
        url: 'https://jable.tv/videos/alias-first/',
        views: 10,
        likes: 1,
        sort_order: 1
      }
    ],
    meta: {
      format_version: 2
    }
  };

  db.importResource('watch_later', resource);

  var exported = db.exportResource('watch_later');
  assert.deepEqual(
    exported.data[0].data.map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/alias-first/', 'https://jable.tv/videos/alias-second/']
  );
  assert.equal(Object.prototype.hasOwnProperty.call(exported.data[0].data[0], 'sort_order'), false);
  assert.deepEqual(
    exported.data[0].data.map(function (row) {
      return row.site_order;
    }),
    [1, 2]
  );
});
