'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const downloads = require('../../app/runtime-dist/downloads.js');

function tempDownloadsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jable-downloads-')), 'downloads.json');
}

test('download store persists records by video URL', function () {
  const filePath = tempDownloadsPath();
  const store = new downloads.DownloadStore(filePath);

  assert.deepEqual(store.list(), []);

  const record = store.upsert({
    videoUrl: 'https://jable.tv/videos/example/',
    collectionKey: 'favourites',
    title: 'Example Video',
    img: 'https://example.test/cover.jpg',
    localPath: '/tmp/example.mp4',
    state: 'ready',
    progress: 1,
    fileSizeBytes: 1234,
    completedAt: '2026-05-16T00:00:00.000Z'
  });

  assert.equal(record.videoUrl, 'https://jable.tv/videos/example/');
  assert.equal(record.collectionKey, 'favourites');
  assert.equal(record.state, 'ready');
  assert.equal(record.fileSizeBytes, 1234);
  assert.equal(store.list().length, 1);

  store.upsert({
    videoUrl: 'https://jable.tv/videos/example/',
    state: 'failed',
    error: 'HTTP 403'
  });

  const secondStore = new downloads.DownloadStore(filePath);
  const records = secondStore.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].state, 'failed');
  assert.equal(records[0].error, 'HTTP 403');
  assert.equal(records[0].title, 'Example Video');
});

test('download record normalization accepts snake case and clamps progress', function () {
  const record = downloads.normalizeDownloadRecord({
    video_url: 'https://jable.tv/videos/snake/',
    collection_key: 'watch_later',
    local_path: '/tmp/snake.mp4',
    file_size_bytes: 0,
    state: 'downloading',
    progress: 1.5,
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:01.000Z'
  });

  assert.equal(record.videoUrl, 'https://jable.tv/videos/snake/');
  assert.equal(record.collectionKey, 'watch_later');
  assert.equal(record.localPath, '/tmp/snake.mp4');
  assert.equal(record.fileSizeBytes, 0);
  assert.equal(record.progress, 1);
});

test('download store removes records explicitly', function () {
  const filePath = tempDownloadsPath();
  const store = new downloads.DownloadStore(filePath);

  store.upsert({
    videoUrl: 'https://jable.tv/videos/remove/',
    state: 'queued'
  });

  assert.equal(store.remove('https://jable.tv/videos/remove/'), true);
  assert.equal(store.remove('https://jable.tv/videos/remove/'), false);
  assert.deepEqual(store.list(), []);
});
