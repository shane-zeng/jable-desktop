'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const downloadManager = require('../../app/runtime-dist/main-process/download-manager.js');

function downloadRecord(patch) {
  return Object.assign(
    {
      videoUrl: 'https://jable.tv/videos/local-playback/',
      collectionKeys: [],
      title: null,
      img: null,
      preview: null,
      localPath: null,
      state: 'ready',
      progress: null,
      fileSizeBytes: null,
      error: null,
      failurePhase: null,
      failureCode: null,
      attemptCount: 0,
      lastStartedAt: null,
      lastErrorAt: null,
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
      completedAt: null
    },
    patch
  );
}

function createHarness(initialRecords, userDataDir) {
  const records = new Map();
  for (const record of initialRecords) {
    records.set(record.videoUrl, downloadRecord(record));
  }

  const database = {
    listDownloadAssets: function () {
      return Array.from(records.values());
    },
    getDownloadAsset: function (videoUrl) {
      return records.get(videoUrl) || null;
    },
    upsertDownloadAsset: function (patch) {
      const current = records.get(patch.videoUrl) || downloadRecord({ videoUrl: patch.videoUrl });
      const next = Object.assign({}, current, patch, { updatedAt: '2026-05-17T00:00:01.000Z' });
      records.set(next.videoUrl, next);
      return next;
    },
    removeDownloadAsset: function (videoUrl) {
      return records.delete(videoUrl);
    }
  };

  const manager = downloadManager.createDownloadManager({
    app: {
      getPath: function (name) {
        return name === 'downloads' ? path.join(userDataDir, 'system-downloads') : userDataDir;
      }
    },
    dialog: {},
    getAppSettings: function () {
      return {
        downloadRoot: null,
        downloadSpeedMode: 'balanced',
        maxConcurrentDownloads: 1
      };
    },
    getDatabase: function () {
      return database;
    },
    getMainWindow: function () {
      return null;
    },
    forwardBrowserMessage: function () {},
    sendToAllBrowserTabs: function () {},
    session: {},
    shell: {},
    showAppDialog: function () {
      return Promise.resolve({ response: 0 });
    },
    t: function (key) {
      return key;
    },
    updateAppSettings: function () {
      return {};
    }
  });

  return {
    database: database,
    manager: manager,
    records: records
  };
}

test('download manager maps speed modes to segment concurrency limits', function () {
  assert.deepEqual(downloadManager.downloadSegmentConcurrencyForSpeedMode('stable'), { min: 4, max: 8 });
  assert.deepEqual(downloadManager.downloadSegmentConcurrencyForSpeedMode('balanced'), { min: 8, max: 32 });
  assert.deepEqual(downloadManager.downloadSegmentConcurrencyForSpeedMode('fast'), { min: 16, max: 32 });
  assert.deepEqual(downloadManager.downloadSegmentConcurrencyForSpeedMode('custom'), { min: 8, max: 32 });
});

test('download manager classifies and sanitizes failure metadata details', function () {
  const rootPath = '/Volumes/workspace/Downloads';
  const detail = downloadManager.sanitizeDownloadErrorDetail(
    'HTTP 403 from https://cdn.example.test/segment.ts?token=secret while writing ' + rootPath + '/movie.mp4',
    rootPath
  );

  assert.equal(downloadManager.downloadHttpStatusFromMessage(new Error('segment HTTP 403')), 403);
  assert.equal(downloadManager.downloadHttpStatusFromMessage('http_504'), 504);
  assert.equal(downloadManager.downloadFailureCode(new TypeError('fetch failed ECONNRESET')), 'network');
  assert.equal(downloadManager.downloadFailureCode(new Error('plain failure')), 'unknown');
  assert.match(detail, /\[remote URL\]/);
  assert.match(detail, /\[download root\]/);
  assert.equal(detail.includes('token=secret'), false);
  assert.equal(detail.includes(rootPath), false);
});

test('download manager exposes ready local playback sources and streams ranges', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-local-playback-'));
  try {
    const downloadRoot = path.join(userDataDir, 'downloads');
    const filePath = path.join(downloadRoot, 'local-playback.mp4');
    fs.mkdirSync(downloadRoot, { recursive: true });
    fs.writeFileSync(filePath, 'hello-local-video');

    const videoUrl = 'https://jable.tv/videos/local-playback/';
    const harness = createHarness(
      [
        {
          videoUrl: videoUrl,
          title: 'Local Playback',
          localPath: 'local-playback.mp4',
          state: 'ready',
          fileSizeBytes: 1,
          completedAt: '2026-05-17T00:00:00.000Z'
        }
      ],
      userDataDir
    );

    const source = harness.manager.localPlaybackSource('https://fs1.app/videos/local-playback/?from=test');
    assert.equal(source.available, true);
    assert.equal(source.videoUrl, videoUrl);
    assert.equal(source.title, 'Local Playback');
    assert.equal(source.fileSizeBytes, fs.statSync(filePath).size);
    assert.match(source.sourceUrl, /^jable-local-video:\/\/play\/[A-Za-z0-9_-]+\.mp4$/);

    const partial = await harness.manager.handleLocalPlaybackRequest(
      new Request(source.sourceUrl, { headers: { range: 'bytes=0-4' } })
    );
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 0-4/17');
    assert.equal(partial.headers.get('accept-ranges'), 'bytes');
    assert.equal(await partial.text(), 'hello');

    const full = await harness.manager.handleLocalPlaybackRequest(new Request(source.sourceUrl));
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-length'), '17');
    assert.equal(await full.text(), 'hello-local-video');
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager rejects unavailable local playback sources', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-local-playback-unavailable-'));
  try {
    const downloadRoot = path.join(userDataDir, 'downloads');
    fs.mkdirSync(downloadRoot, { recursive: true });
    fs.writeFileSync(path.join(downloadRoot, 'ready.mp4'), 'ready');

    const records = [
      { videoUrl: 'https://jable.tv/videos/queued/', localPath: 'ready.mp4', state: 'queued' },
      { videoUrl: 'https://jable.tv/videos/downloading/', localPath: 'ready.mp4', state: 'downloading' },
      { videoUrl: 'https://jable.tv/videos/paused/', localPath: 'ready.mp4', state: 'paused' },
      { videoUrl: 'https://jable.tv/videos/failed/', localPath: 'ready.mp4', state: 'failed' },
      { videoUrl: 'https://jable.tv/videos/missing/', localPath: 'missing.mp4', state: 'missing' },
      { videoUrl: 'https://jable.tv/videos/unsafe/', localPath: '../unsafe.mp4', state: 'ready' },
      { videoUrl: 'https://jable.tv/videos/absolute/', localPath: path.join(downloadRoot, 'ready.mp4'), state: 'ready' }
    ];
    const harness = createHarness(records, userDataDir);

    assert.deepEqual(harness.manager.localPlaybackSource('https://example.test/videos/nope/'), {
      available: false,
      videoUrl: null,
      reason: 'not_video'
    });
    assert.deepEqual(harness.manager.localPlaybackSource('https://jable.tv/videos/unknown/'), {
      available: false,
      videoUrl: 'https://jable.tv/videos/unknown/',
      reason: 'not_ready'
    });

    for (const state of ['queued', 'downloading', 'paused', 'failed']) {
      assert.deepEqual(harness.manager.localPlaybackSource('https://jable.tv/videos/' + state + '/'), {
        available: false,
        videoUrl: 'https://jable.tv/videos/' + state + '/',
        reason: 'not_ready'
      });
    }

    for (const slug of ['missing', 'unsafe', 'absolute']) {
      assert.deepEqual(harness.manager.localPlaybackSource('https://jable.tv/videos/' + slug + '/'), {
        available: false,
        videoUrl: 'https://jable.tv/videos/' + slug + '/',
        reason: 'missing'
      });
      assert.equal(harness.records.get('https://jable.tv/videos/' + slug + '/').state, 'missing');
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager parses local playback byte ranges', function () {
  assert.deepEqual(downloadManager.parseLocalPlaybackRangeHeader(null, 10), {
    satisfiable: true,
    start: 0,
    end: 9,
    status: 200
  });
  assert.deepEqual(downloadManager.parseLocalPlaybackRangeHeader('bytes=0-4', 10), {
    satisfiable: true,
    start: 0,
    end: 4,
    status: 206
  });
  assert.deepEqual(downloadManager.parseLocalPlaybackRangeHeader('bytes=5-', 10), {
    satisfiable: true,
    start: 5,
    end: 9,
    status: 206
  });
  assert.deepEqual(downloadManager.parseLocalPlaybackRangeHeader('bytes=-3', 10), {
    satisfiable: true,
    start: 7,
    end: 9,
    status: 206
  });
  assert.deepEqual(downloadManager.parseLocalPlaybackRangeHeader('bytes=12-15', 10), {
    satisfiable: false,
    status: 416
  });
  assert.deepEqual(downloadManager.parseLocalPlaybackRangeHeader('bytes=0-1,4-5', 10), {
    satisfiable: false,
    status: 416
  });
  assert.deepEqual(downloadManager.parseLocalPlaybackRangeHeader('items=0-1', 10), {
    satisfiable: false,
    status: 416
  });
});
