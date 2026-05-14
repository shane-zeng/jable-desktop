'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var DatabaseSync = require('node:sqlite').DatabaseSync;
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function withoutExportedAt(resource) {
  var copy = JSON.parse(JSON.stringify(resource));

  if (copy.meta) delete copy.meta.exported_at;

  if (Array.isArray(copy.data)) {
    for (var i = 0; i < copy.data.length; i++) {
      if (copy.data[i] && copy.data[i].meta) delete copy.data[i].meta.exported_at;
    }
  }

  return copy;
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

test('listVideos searches title and URL with the local full text index', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: [
      {
        title: 'ABP-123 日本語測試 keyword',
        url: 'https://jable.tv/videos/abp-123/',
        siteOrder: 1
      },
      {
        title: '精確 肉便 老師 sample',
        url: 'https://jable.tv/videos/teacher-phrase/',
        siteOrder: 2
      },
      {
        title: '肉便 かわいい 老師',
        url: 'https://jable.tv/videos/teacher-target/',
        siteOrder: 3
      },
      {
        title: '肉便 only',
        url: 'https://jable.tv/videos/meat-only/',
        siteOrder: 4
      },
      {
        title: '老師 only',
        url: 'https://jable.tv/videos/teacher-only/',
        siteOrder: 5
      },
      {
        title: 'Different row',
        url: 'https://jable.tv/videos/url-target/',
        siteOrder: 6
      }
    ]
  });

  assert.deepEqual(
    db.listVideos('favourites', { search: 'bp-123' }).map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/abp-123/']
  );
  assert.deepEqual(
    db.listVideos('favourites', { search: '本語測' }).map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/abp-123/']
  );
  assert.deepEqual(
    db.listVideos('favourites', { search: '測試' }).map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/abp-123/']
  );
  assert.deepEqual(
    db.listVideos('favourites', { search: 'url-target' }).map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/url-target/']
  );
  assert.deepEqual(
    db.listVideos('favourites', { search: '肉便 老師' }).map(function (row) {
      return row.url;
    }),
    [
      'https://jable.tv/videos/teacher-phrase/',
      'https://jable.tv/videos/teacher-target/',
      'https://jable.tv/videos/meat-only/',
      'https://jable.tv/videos/teacher-only/'
    ]
  );
  assert.deepEqual(
    db.listVideos('favourites', { search: '老師 肉便' }).map(function (row) {
      return row.url;
    }),
    [
      'https://jable.tv/videos/teacher-phrase/',
      'https://jable.tv/videos/teacher-target/',
      'https://jable.tv/videos/meat-only/',
      'https://jable.tv/videos/teacher-only/'
    ]
  );
  assert.deepEqual(
    db.listVideos('favourites', { search: '肉便 老師', searchMode: 'all' }).map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/teacher-phrase/', 'https://jable.tv/videos/teacher-target/']
  );
  assert.deepEqual(
    db.listVideos('favourites', { search: '肉便 老師', searchMode: 'phrase' }).map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/teacher-phrase/']
  );
  assert.deepEqual(
    db.listVideos('favourites', { search: '肉便 missing' }).map(function (row) {
      return row.url;
    }),
    [
      'https://jable.tv/videos/teacher-phrase/',
      'https://jable.tv/videos/teacher-target/',
      'https://jable.tv/videos/meat-only/'
    ]
  );
  assert.equal(db.countVideos('favourites', { search: 'missing' }), 0);
});

test('video search index follows title updates', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: [
      {
        title: 'Original searchable title',
        url: 'https://jable.tv/videos/title-update/',
        siteOrder: 1
      }
    ]
  });
  assert.equal(db.countVideos('favourites', { search: 'Original' }), 1);

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: [
      {
        title: 'Replacement searchable title',
        url: 'https://jable.tv/videos/title-update/',
        siteOrder: 1
      }
    ]
  });

  assert.equal(db.countVideos('favourites', { search: 'Original' }), 0);
  assert.equal(db.countVideos('favourites', { search: 'Replacement' }), 1);
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
  assert.deepEqual(db.listVideos('watch_later', { search: 'hidden' }), []);
  assert.deepEqual(
    db.listVideos('watch_later', { search: 'hidden', includeHidden: true }).map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/hidden-target/']
  );
});

test('applyCollectionToggle adds, hides, and restores a local collection item', function (t) {
  var db = createTestDatabase(t);

  var missingRemove = db.applyCollectionToggle({
    collectionKey: 'favourites',
    action: 'remove',
    video: {
      url: 'https://jable.tv/videos/not-local/'
    }
  });

  assert.equal(missingRemove.changed, false);
  assert.equal(missingRemove.visible, false);
  assert.equal(db.countVideos('favourites', { includeHidden: true }), 0);

  var add = db.applyCollectionToggle({
    collectionKey: 'favourites',
    action: 'add',
    video: {
      title: 'Clicked title',
      url: 'https://jable.tv/videos/clicked',
      img: 'https://example.test/clicked.jpg'
    }
  });

  assert.equal(add.changed, true);
  assert.equal(add.visible, true);
  assert.equal(add.url, 'https://jable.tv/videos/clicked/');
  assert.equal(db.getSyncState('favourites'), null);

  var rows = db.listVideos('favourites');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Clicked title');
  assert.equal(rows[0].img, 'https://example.test/clicked.jpg');
  assert.ok(rows[0].site_order < 0);

  var remove = db.applyCollectionToggle({
    collectionKey: 'favourites',
    action: 'remove',
    video: {
      url: 'https://jable.tv/videos/clicked/'
    }
  });

  assert.equal(remove.changed, true);
  assert.equal(remove.visible, false);
  assert.equal(db.countVideos('favourites'), 0);

  var hiddenRows = db.listVideos('favourites', { includeHidden: true });
  assert.equal(hiddenRows.length, 1);
  assert.equal(hiddenRows[0].is_visible, 0);
  assert.ok(hiddenRows[0].missing_at);

  db.applyCollectionToggle({
    collectionKey: 'favourites',
    action: 'add',
    video: {
      title: 'Restored title',
      url: 'https://jable.tv/videos/clicked/'
    }
  });

  rows = db.listVideos('favourites');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Restored title');
  assert.equal(rows[0].is_visible, 1);
  assert.equal(rows[0].missing_at, null);
});

test('migration rebuilds the local full text index for existing videos', function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-db-'));
  var dbPath = path.join(dir, 'test.sqlite');
  var rawDb = new DatabaseSync(dbPath);
  var timestamp = '2026-05-14T00:00:00.000Z';

  rawDb.exec(
    [
      'CREATE TABLE videos (',
      '  url TEXT PRIMARY KEY,',
      '  title TEXT,',
      '  views INTEGER,',
      '  likes INTEGER,',
      '  img TEXT,',
      '  preview TEXT,',
      '  created_at TEXT NOT NULL,',
      '  updated_at TEXT NOT NULL',
      ');',
      'CREATE TABLE collections (',
      '  key TEXT PRIMARY KEY,',
      '  name TEXT NOT NULL',
      ');',
      'CREATE TABLE collection_items (',
      '  collection_key TEXT NOT NULL,',
      '  video_url TEXT NOT NULL,',
      '  first_seen_at TEXT NOT NULL,',
      '  last_seen_at TEXT NOT NULL,',
      '  PRIMARY KEY (collection_key, video_url)',
      ');',
      'CREATE TABLE sync_states (',
      '  collection_key TEXT PRIMARY KEY,',
      '  completed INTEGER NOT NULL DEFAULT 0,',
      '  last_scraped_page INTEGER,',
      '  last_known_url TEXT,',
      '  updated_at TEXT NOT NULL',
      ');'
    ].join('\n')
  );
  rawDb.prepare('INSERT INTO collections (key, name) VALUES (?, ?)').run('favourites', '影片收藏');
  rawDb
    .prepare(
      'INSERT INTO videos (url, title, views, likes, img, preview, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run('https://jable.tv/videos/migrated/', 'Migrated 日本語 index row', 1, 1, null, null, timestamp, timestamp);
  rawDb
    .prepare(
      'INSERT INTO collection_items (collection_key, video_url, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)'
    )
    .run('favourites', 'https://jable.tv/videos/migrated/', timestamp, timestamp);
  rawDb.close();

  var db = new JableDatabase(dbPath);

  t.after(function () {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.deepEqual(
    db.listVideos('favourites', { search: '日本語' }).map(function (row) {
      return row.url;
    }),
    ['https://jable.tv/videos/migrated/']
  );
});

test('allCollectionUrlsKnown checks normalized urls and includes hidden rows', function (t) {
  var db = createTestDatabase(t);

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    syncRunId: 'old-run',
    rows: [
      {
        title: 'Known row',
        url: 'https://jable.tv/videos/known/',
        siteOrder: 1
      },
      {
        title: 'Hidden row',
        url: 'https://jable.tv/videos/hidden/',
        siteOrder: 2
      }
    ]
  });
  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    syncRunId: 'full-run',
    rows: [
      {
        title: 'Known row',
        url: 'https://jable.tv/videos/known/',
        siteOrder: 1
      }
    ]
  });
  db.finishSync({
    collectionKey: 'favourites',
    mode: 'full',
    syncRunId: 'full-run',
    result: { completed: true, lastScrapedPage: 1 }
  });

  assert.equal(
    db.allCollectionUrlsKnown('favourites', [
      'https://jable.tv/videos/known?from=quick#fragment',
      'https://jable.tv/videos/hidden'
    ]),
    true
  );
  assert.equal(
    db.allCollectionUrlsKnown('favourites', ['https://jable.tv/videos/known/', 'https://jable.tv/videos/missing/']),
    false
  );
  assert.equal(db.allCollectionUrlsKnown('favourites', []), false);
  assert.equal(db.allCollectionUrlsKnown('favourites', ['https://jable.tv/videos/known/', null]), false);
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

test('exportResourceToFile writes JSON equivalent to exportResource', async function (t) {
  var db = createTestDatabase(t);
  var filePath = path.join(path.dirname(db.filePath), 'favourites-export.json');

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: [
      {
        title: 'Second',
        url: 'https://jable.tv/videos/second/',
        views: 20,
        likes: 2,
        siteOrder: 2
      },
      {
        title: 'First',
        url: 'https://jable.tv/videos/first/',
        views: 10,
        likes: 1,
        siteOrder: 1
      }
    ]
  });

  var result = await db.exportResourceToFile('favourites', filePath);
  var written = readJson(filePath);
  var expected = db.exportResource('favourites');

  assert.equal(result.filePath, filePath);
  assert.equal(result.total, 2);
  assert.deepEqual(withoutExportedAt(written), withoutExportedAt(expected));
});

test('exportResourceToFile writes an empty collection resource', async function (t) {
  var db = createTestDatabase(t);
  var filePath = path.join(path.dirname(db.filePath), 'empty-export.json');

  var result = await db.exportResourceToFile('watch_later', filePath);
  var written = readJson(filePath);

  assert.equal(result.total, 0);
  assert.deepEqual(written.data, []);
  assert.equal(written.meta.format_version, 2);
  assert.equal(written.meta.total, 0);
  assert.equal(written.meta.page_count, 0);
  assert.equal(written.meta.last_page, null);
});

test('exportResourceToFile chunks rows into paged JSON metadata', async function (t) {
  var db = createTestDatabase(t);
  var filePath = path.join(path.dirname(db.filePath), 'paged-export.json');
  var rows = [];

  for (var i = 1; i <= 25; i++) {
    rows.push({
      title: 'Video ' + i,
      url: 'https://jable.tv/videos/video-' + i + '/',
      views: i,
      likes: i,
      siteOrder: i
    });
  }

  db.saveSyncPage({
    collectionKey: 'favourites',
    page: 1,
    rows: rows
  });

  await db.exportResourceToFile('favourites', filePath);
  var written = readJson(filePath);

  assert.equal(written.meta.total, 25);
  assert.equal(written.meta.page_count, 2);
  assert.equal(written.meta.last_page, 2);
  assert.equal(written.data.length, 2);
  assert.equal(written.data[0].meta.current_page, 1);
  assert.equal(written.data[0].meta.count, 24);
  assert.equal(written.data[0].meta.first_url, 'https://jable.tv/videos/video-1/');
  assert.equal(written.data[0].meta.last_url, 'https://jable.tv/videos/video-24/');
  assert.equal(written.data[1].meta.current_page, 2);
  assert.equal(written.data[1].meta.count, 1);
  assert.equal(written.data[1].meta.first_url, 'https://jable.tv/videos/video-25/');
  assert.equal(written.data[1].meta.last_url, 'https://jable.tv/videos/video-25/');
  assert.equal(written.data[1].data[0].site_order, 25);
});
