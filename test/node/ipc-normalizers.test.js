'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const normalizers = require('../../app/runtime-dist/main-process/ipc-normalizers.js');

test('IPC normalizers preserve valid list options and reject invalid enums', function () {
  assert.deepEqual(
    normalizers.normalizeListVideosOptions(
      {
        collectionKey: 'watch_later',
        search: 'alpha beta',
        searchMode: 'all',
        downloadFilter: 'downloadable',
        sort: 'likes',
        direction: 'desc',
        includeHidden: true,
        limit: 10,
        offset: 20
      },
      'db:list-videos'
    ),
    {
      collectionKey: 'watch_later',
      search: 'alpha beta',
      searchMode: 'all',
      downloadFilter: 'downloadable',
      sort: 'likes',
      direction: 'desc',
      includeHidden: true,
      limit: 10,
      offset: 20
    }
  );
  assert.equal(
    normalizers.normalizeListVideosOptions(
      {
        collectionKey: 'watch_later',
        downloadFilter: 'downloaded'
      },
      'db:list-videos'
    ).downloadFilter,
    'downloaded'
  );

  assert.throws(function () {
    normalizers.normalizeListVideosOptions({ collectionKey: 'favourites', sort: 'updated_at' }, 'db:list-videos');
  }, /Invalid IPC payload for db:list-videos: sort/);

  assert.throws(function () {
    normalizers.normalizeListVideosOptions({ collectionKey: 'favourites', downloadFilter: 'ready' }, 'db:list-videos');
  }, /Invalid IPC payload for db:list-videos: downloadFilter/);
});

test('IPC normalizers validate collection keys, sync modes, and browser payloads', function () {
  assert.equal(normalizers.normalizeCollectionKey('favourites', 'db:collection-urls'), 'favourites');
  assert.throws(function () {
    normalizers.normalizeCollectionKey('unknown', 'db:collection-urls');
  }, /Invalid IPC payload for db:collection-urls: collectionKey/);

  assert.deepEqual(
    normalizers.normalizeBrowserSyncCollectionPayload({
      tabId: 'tab-1',
      options: {
        collectionKey: 'favourites',
        mode: 'full',
        syncRunId: 'run-1',
        siteOrderOffset: 24,
        startPage: null,
        stopOnKnownPage: false,
        batchLimit: null
      }
    }),
    {
      tabId: 'tab-1',
      options: {
        collectionKey: 'favourites',
        mode: 'full',
        syncRunId: 'run-1',
        siteOrderOffset: 24,
        startPage: null,
        stopOnKnownPage: false,
        batchLimit: null
      }
    }
  );

  assert.throws(function () {
    normalizers.normalizeBrowserSyncCollectionPayload({
      collectionKey: 'favourites',
      mode: 'incremental',
      syncRunId: 'run-1'
    });
  }, /Invalid IPC payload for browser:sync-collection: mode/);
});

test('IPC normalizers keep browser defaults stable', function () {
  assert.deepEqual(normalizers.normalizeCreateBrowserTabPayload(null), {});
  assert.deepEqual(normalizers.normalizeBrowserTabPayload(undefined, 'browser:reload'), { tabId: null });
  assert.deepEqual(normalizers.normalizeBrowserTabLockedPayload({ tabId: 'tab-1' }), {
    tabId: 'tab-1',
    locked: false
  });
  assert.deepEqual(normalizers.normalizeBrowserBounds({ visible: false, x: 10 }), { visible: false });
  assert.deepEqual(normalizers.normalizeBrowserNavigatePayload({ tabId: null, url: 'https://jable.tv/' }), {
    tabId: null,
    url: 'https://jable.tv/',
    forceReload: false
  });
});
