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
      sourcePageChineseSubtitleNotice: false,
      sourcePageSubtitleNoticeText: null,
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

function createHarness(initialRecords, userDataDir, settingsOverrides = {}) {
  const videos = new Map();
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
    upsertVideoMetadata: function (payload) {
      videos.set(payload.url, Object.assign({}, payload));
      return { updated: true, url: payload.url };
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
      return Object.assign(
        {
          autoDownloadOnPlayback: false,
          downloadRoot: null,
          downloadSpeedMode: 'balanced',
          maxConcurrentDownloads: 1
        },
        settingsOverrides
      );
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
    records: records,
    videos: videos
  };
}

function createFakeFfmpeg(userDataDir) {
  const filePath = path.join(userDataDir, process.platform === 'win32' ? 'fake-ffmpeg.cmd' : 'fake-ffmpeg');
  const script =
    process.platform === 'win32'
      ? '@echo off\r\necho ffmpeg version test\r\n'
      : '#!/bin/sh\necho "ffmpeg version test"\n';
  fs.writeFileSync(filePath, script);
  fs.chmodSync(filePath, 0o755);
  return filePath;
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

test('download manager captures proxied HLS playback segments for later resume', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-'));
  try {
    const videoUrl = 'https://jable.tv/videos/capture-test/';
    const playlistUrl = 'https://cdn.example.test/hls/capture/index.m3u8';
    const harness = createHarness([], userDataDir);

    const plan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: videoUrl,
      title: 'Capture Test - Jable.TV 免費高清AV在線看 J片 AV看到',
      views: 1234,
      likes: 56,
      img: 'https://cdn.example.test/capture.jpg',
      preview: 'https://cdn.example.test/capture-preview.mp4',
      playlistUrl: playlistUrl,
      playlistText: [
        '#EXTM3U',
        '#EXT-X-TARGETDURATION:10',
        '#EXTINF:10,',
        'segment-001.ts',
        '#EXTINF:8.5,',
        'https://cdn.example.test/hls/capture/segment-002.ts?token=abc',
        '#EXT-X-ENDLIST',
        ''
      ].join('\n')
    });

    assert.equal(plan.videoUrl, videoUrl);
    assert.equal(plan.playlistUrl, playlistUrl);
    assert.equal(plan.segmentCount, 2);
    assert.equal(plan.segments.length, 2);
    assert.equal(plan.segments[0].url, 'https://cdn.example.test/hls/capture/segment-001.ts');
    assert.equal(plan.segments[1].url, 'https://cdn.example.test/hls/capture/segment-002.ts?token=abc');

    const record = harness.records.get(videoUrl);
    assert.equal(harness.videos.get(videoUrl).title, 'Capture Test');
    assert.equal(harness.videos.get(videoUrl).views, 1234);
    assert.equal(harness.videos.get(videoUrl).likes, 56);
    assert.equal(harness.videos.get(videoUrl).img, 'https://cdn.example.test/capture.jpg');
    assert.equal(harness.videos.get(videoUrl).preview, 'https://cdn.example.test/capture-preview.mp4');
    assert.equal(record.state, 'paused');
    assert.equal(record.title, 'Capture Test');
    assert.equal(record.img, 'https://cdn.example.test/capture.jpg');
    assert.equal(record.preview, 'https://cdn.example.test/capture-preview.mp4');
    assert.equal(record.progress, 0);
    assert.match(record.localPath, /^Capture Test.*\.mp4$/);

    const outputPath = path.join(userDataDir, 'downloads', record.localPath);
    const segmentDir = outputPath + '.segments';
    assert.equal(path.dirname(plan.segments[0].filePath), segmentDir);
    assert.equal(path.basename(plan.segments[0].filePath), 'segment-000001.ts');
    assert.equal(path.basename(plan.segments[1].filePath), 'segment-000002.ts');
    assert.equal(fs.existsSync(path.join(segmentDir, 'resume.json')), true);

    fs.writeFileSync(plan.segments[0].filePath, 'segment-one');
    harness.manager.recordHlsPlaybackCaptureSegment({
      videoUrl: videoUrl,
      filePath: plan.segments[0].filePath
    });
    assert.equal(harness.records.get(videoUrl).progress, 0.5);
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager auto-queues completed playback capture when the setting is enabled', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-auto-'));
  try {
    const videoUrl = 'https://jable.tv/videos/capture-auto/';
    const playlistUrl = 'https://cdn.example.test/hls/capture-auto/index.m3u8';
    const harness = createHarness([], userDataDir, {
      autoDownloadOnPlayback: true,
      maxConcurrentDownloads: 0
    });

    const plan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: videoUrl,
      title: 'Capture Auto',
      playlistUrl: playlistUrl,
      playlistText: [
        '#EXTM3U',
        '#EXT-X-TARGETDURATION:10',
        '#EXTINF:10,',
        'segment-001.ts',
        '#EXTINF:8.5,',
        'segment-002.ts',
        '#EXT-X-ENDLIST',
        ''
      ].join('\n')
    });

    assert.equal(harness.videos.get(videoUrl).title, 'Capture Auto');

    fs.writeFileSync(plan.segments[0].filePath, 'segment-one');
    harness.manager.recordHlsPlaybackCaptureSegment({
      videoUrl: videoUrl,
      filePath: plan.segments[0].filePath
    });
    assert.equal(harness.records.get(videoUrl).state, 'downloading');
    assert.equal(harness.records.get(videoUrl).progress, 0);
    assert.equal(
      harness.manager.listDownloads().find(function (record) {
        return record.videoUrl === videoUrl;
      }).progress,
      0.5
    );

    fs.writeFileSync(plan.segments[1].filePath, 'segment-two');
    harness.manager.recordHlsPlaybackCaptureSegment({
      videoUrl: videoUrl,
      filePath: plan.segments[1].filePath
    });
    assert.equal(harness.records.get(videoUrl).state, 'queued');
    assert.equal(harness.records.get(videoUrl).progress, null);
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager can pause, cancel, and delete active playback captures', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-controls-'));
  try {
    const playlistUrl = 'https://cdn.example.test/hls/capture-controls/index.m3u8';
    const playlistText = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'segment-001.ts',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n');
    const harness = createHarness([], userDataDir, {
      autoDownloadOnPlayback: true,
      maxConcurrentDownloads: 0
    });

    const pausedUrl = 'https://jable.tv/videos/capture-pause/';
    const pausedPlan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: pausedUrl,
      pageLoadId: 'pause-load-1',
      title: 'Capture Pause',
      playlistUrl: playlistUrl,
      playlistText: playlistText
    });
    assert.equal(harness.records.get(pausedUrl).state, 'downloading');
    assert.equal(
      harness.manager.shouldContinueHlsPlaybackCapture({ videoUrl: pausedUrl, pageLoadId: 'pause-load-1' }),
      true
    );
    const paused = harness.manager.pauseDownload(pausedUrl);
    assert.equal(paused.record.state, 'paused');
    assert.equal(
      harness.manager.shouldContinueHlsPlaybackCapture({ videoUrl: pausedUrl, pageLoadId: 'pause-load-1' }),
      false
    );
    assert.equal(
      harness.manager.shouldProxyHlsPlaybackCapture({ videoUrl: pausedUrl, pageLoadId: 'pause-load-1' }),
      false
    );
    assert.equal(
      harness.manager.shouldProxyHlsPlaybackCapture({ videoUrl: pausedUrl, pageLoadId: 'pause-load-2' }),
      true
    );
    fs.writeFileSync(pausedPlan.segments[0].filePath, 'segment-one');
    harness.manager.recordHlsPlaybackCaptureSegment({
      videoUrl: pausedUrl,
      pageLoadId: 'pause-load-1',
      filePath: pausedPlan.segments[0].filePath
    });
    assert.equal(harness.records.get(pausedUrl).progress, null);

    const canceledUrl = 'https://jable.tv/videos/capture-cancel/';
    const canceledPlan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: canceledUrl,
      pageLoadId: 'cancel-load-1',
      title: 'Capture Cancel',
      playlistUrl: playlistUrl,
      playlistText: playlistText
    });
    const canceledSegmentDir = path.dirname(canceledPlan.segments[0].filePath);
    assert.equal(fs.existsSync(canceledSegmentDir), true);
    const canceled = harness.manager.cancelDownload(canceledUrl);
    assert.equal(canceled.record.state, 'failed');
    assert.equal(
      harness.manager.shouldContinueHlsPlaybackCapture({ videoUrl: canceledUrl, pageLoadId: 'cancel-load-1' }),
      false
    );
    assert.equal(
      harness.manager.shouldProxyHlsPlaybackCapture({ videoUrl: canceledUrl, pageLoadId: 'cancel-load-1' }),
      false
    );
    assert.equal(
      harness.manager.shouldProxyHlsPlaybackCapture({ videoUrl: canceledUrl, pageLoadId: 'cancel-load-2' }),
      true
    );
    assert.equal(fs.existsSync(canceledSegmentDir), false);

    const deletedUrl = 'https://jable.tv/videos/capture-delete/';
    const deletedPlan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: deletedUrl,
      pageLoadId: 'delete-load-1',
      title: 'Capture Delete',
      playlistUrl: playlistUrl,
      playlistText: playlistText
    });
    const deletedSegmentDir = path.dirname(deletedPlan.segments[0].filePath);
    const deleted = await harness.manager.deleteDownload(deletedUrl);
    assert.equal(deleted.removed, true);
    assert.equal(harness.records.has(deletedUrl), false);
    assert.equal(
      harness.manager.shouldContinueHlsPlaybackCapture({ videoUrl: deletedUrl, pageLoadId: 'delete-load-1' }),
      false
    );
    assert.equal(
      harness.manager.shouldProxyHlsPlaybackCapture({ videoUrl: deletedUrl, pageLoadId: 'delete-load-1' }),
      false
    );
    assert.equal(fs.existsSync(deletedSegmentDir), false);
    assert.equal(
      harness.manager.prepareHlsPlaybackCapture({
        videoUrl: deletedUrl,
        pageLoadId: 'delete-load-1',
        title: 'Capture Delete',
        playlistUrl: playlistUrl,
        playlistText: playlistText
      }),
      null
    );
    assert.equal(
      harness.manager.shouldProxyHlsPlaybackCapture({ videoUrl: deletedUrl, pageLoadId: 'delete-load-2' }),
      true
    );
    assert.notEqual(
      harness.manager.prepareHlsPlaybackCapture({
        videoUrl: deletedUrl,
        pageLoadId: 'delete-load-2',
        title: 'Capture Delete',
        playlistUrl: playlistUrl,
        playlistText: playlistText
      }),
      null
    );
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager applies bulk retry, resume, pause, and cancel actions', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-bulk-downloads-'));
  try {
    fs.mkdirSync(path.join(userDataDir, 'downloads'), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'downloads', 'ready.mp4'), 'ready');

    const fakeFfmpeg = createFakeFfmpeg(userDataDir);
    const harness = createHarness(
      [
        { videoUrl: 'https://jable.tv/videos/paused/', localPath: 'paused.mp4', state: 'paused' },
        { videoUrl: 'https://jable.tv/videos/failed/', localPath: 'failed.mp4', state: 'failed' },
        { videoUrl: 'https://jable.tv/videos/missing/', localPath: 'missing.mp4', state: 'missing' },
        { videoUrl: 'https://jable.tv/videos/ready/', localPath: 'ready.mp4', state: 'ready' }
      ],
      userDataDir,
      {
        ffmpegPath: fakeFfmpeg,
        maxConcurrentDownloads: 0
      }
    );

    assert.deepEqual(await harness.manager.retryFailedDownloads(), {
      requested: 2,
      affected: 2,
      skipped: 0,
      failed: 0
    });
    assert.equal(harness.records.get('https://jable.tv/videos/failed/').state, 'queued');
    assert.equal(harness.records.get('https://jable.tv/videos/missing/').state, 'queued');

    assert.deepEqual(await harness.manager.resumePausedDownloads(), {
      requested: 1,
      affected: 1,
      skipped: 0,
      failed: 0
    });
    assert.equal(harness.records.get('https://jable.tv/videos/paused/').state, 'queued');

    assert.deepEqual(harness.manager.pauseAllDownloads(), {
      requested: 3,
      affected: 3,
      skipped: 0,
      failed: 0
    });
    for (const slug of ['paused', 'failed', 'missing']) {
      assert.equal(harness.records.get('https://jable.tv/videos/' + slug + '/').state, 'paused');
    }
    assert.equal(harness.records.get('https://jable.tv/videos/ready/').state, 'ready');
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager bulk cancel only affects queued records', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-bulk-cancel-'));
  try {
    fs.mkdirSync(path.join(userDataDir, 'downloads'), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'downloads', 'ready.mp4'), 'ready');

    const fakeFfmpeg = createFakeFfmpeg(userDataDir);
    const harness = createHarness(
      [
        { videoUrl: 'https://jable.tv/videos/queued/', localPath: 'queued.mp4', state: 'failed' },
        { videoUrl: 'https://jable.tv/videos/paused/', localPath: 'paused.mp4', state: 'paused' },
        { videoUrl: 'https://jable.tv/videos/ready/', localPath: 'ready.mp4', state: 'ready' }
      ],
      userDataDir,
      {
        ffmpegPath: fakeFfmpeg,
        maxConcurrentDownloads: 0
      }
    );

    await harness.manager.retryDownload('https://jable.tv/videos/queued/');
    assert.deepEqual(harness.manager.cancelQueuedDownloads(), {
      requested: 1,
      affected: 1,
      skipped: 0,
      failed: 0
    });
    assert.equal(harness.records.get('https://jable.tv/videos/queued/').state, 'failed');
    assert.equal(harness.records.get('https://jable.tv/videos/queued/').failureCode, 'download_canceled');
    assert.equal(harness.records.get('https://jable.tv/videos/paused/').state, 'paused');
    assert.equal(harness.records.get('https://jable.tv/videos/ready/').state, 'ready');
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager bulk cancel ignores non-queued records', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-bulk-cancel-empty-'));
  try {
    const harness = createHarness(
      [
        { videoUrl: 'https://jable.tv/videos/paused/', localPath: 'paused.mp4', state: 'paused' },
        { videoUrl: 'https://jable.tv/videos/failed/', localPath: 'failed.mp4', state: 'failed' }
      ],
      userDataDir
    );

    assert.deepEqual(harness.manager.cancelQueuedDownloads(), {
      requested: 0,
      affected: 0,
      skipped: 0,
      failed: 0
    });
    assert.equal(harness.records.get('https://jable.tv/videos/paused/').state, 'paused');
    assert.equal(harness.records.get('https://jable.tv/videos/failed/').state, 'failed');
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager bulk cancel reports empty queue after runtime recovery', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-bulk-cancel-recovered-'));
  try {
    const harness = createHarness(
      [{ videoUrl: 'https://jable.tv/videos/queued/', localPath: 'queued.mp4', state: 'queued' }],
      userDataDir,
      { maxConcurrentDownloads: 0 }
    );

    assert.deepEqual(harness.manager.cancelQueuedDownloads(), {
      requested: 0,
      affected: 0,
      skipped: 0,
      failed: 0
    });
    assert.equal(harness.records.get('https://jable.tv/videos/queued/').state, 'paused');
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager reads the source page Chinese subtitle notice', function () {
  assert.equal(
    downloadManager.sourcePageChineseSubtitleNoticeTextFromHtml(
      '<div><h5 class="desc h6-md">此作品曾在本站上傳，現已更新至中文字幕版。</h5></div>'
    ),
    '此作品曾在本站上傳，現已更新至中文字幕版。'
  );
  assert.equal(
    downloadManager.sourcePageChineseSubtitleNoticeTextFromHtml(
      '<h5 class="desc h6-md">此作品曾在本站上傳，現已更新至<strong>中文字幕版</strong>。</h5>'
    ),
    '此作品曾在本站上傳，現已更新至 中文字幕版 。'
  );
  assert.equal(downloadManager.sourcePageChineseSubtitleNoticeTextFromHtml('<h5 class="desc">中文字幕版</h5>'), null);
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
          sourcePageChineseSubtitleNotice: true,
          sourcePageSubtitleNoticeText: '此作品曾在本站上傳，現已更新至中文字幕版。',
          completedAt: '2026-05-17T00:00:00.000Z'
        }
      ],
      userDataDir
    );

    const source = harness.manager.localPlaybackSource({
      videoUrl: 'https://fs1.app/videos/local-playback/?from=test',
      sourcePageChineseSubtitleNotice: true
    });
    assert.equal(source.available, true);
    assert.equal(source.videoUrl, videoUrl);
    assert.equal(source.title, 'Local Playback');
    assert.equal(source.fileSizeBytes, fs.statSync(filePath).size);
    assert.match(source.sourceUrl, /^jable-local-video:\/\/play\/[A-Za-z0-9_-]+\.mp4$/);
    assert.equal(source.thumbnailVttUrl, null);

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

    assert.deepEqual(
      harness.manager.localPlaybackSource({
        videoUrl: 'https://fs1.app/videos/local-playback/?from=test',
        sourcePageChineseSubtitleNotice: false
      }),
      {
        available: false,
        videoUrl: videoUrl,
        reason: 'source_page_changed'
      }
    );
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager exposes local playback thumbnail VTT and images when preview cache exists', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-local-playback-preview-'));
  try {
    const downloadRoot = path.join(userDataDir, 'downloads');
    const filePath = path.join(downloadRoot, 'local-playback.mp4');
    const previewDir = filePath + '.preview';
    const videoUrl = 'https://jable.tv/videos/local-playback/';
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(filePath, 'hello-local-video');
    fs.writeFileSync(path.join(previewDir, 'thumb-000001.jpg'), 'jpeg-one');
    fs.writeFileSync(path.join(previewDir, 'thumb-000002.jpg'), 'jpeg-two');

    const stats = fs.statSync(filePath);
    fs.writeFileSync(
      path.join(previewDir, 'metadata.json'),
      JSON.stringify({
        version: 1,
        intervalSeconds: 60,
        width: 213,
        height: 120,
        fileSizeBytes: stats.size,
        mtimeMs: Math.trunc(stats.mtimeMs),
        cues: [
          { start: 0, end: 60, fileName: 'thumb-000001.jpg' },
          { start: 60, end: 120, fileName: 'thumb-000002.jpg' }
        ]
      })
    );

    const harness = createHarness(
      [
        {
          videoUrl: videoUrl,
          title: 'Local Playback',
          localPath: 'local-playback.mp4',
          state: 'ready',
          fileSizeBytes: stats.size,
          completedAt: '2026-05-17T00:00:00.000Z'
        }
      ],
      userDataDir
    );

    const source = harness.manager.localPlaybackSource(videoUrl);
    assert.equal(source.available, true);
    assert.match(source.thumbnailVttUrl, /^jable-local-video:\/\/thumb\/[A-Za-z0-9_-]+\/thumb\.vtt$/);

    const vtt = await harness.manager.handleLocalPlaybackRequest(new Request(source.thumbnailVttUrl));
    assert.equal(vtt.status, 200);
    assert.equal(vtt.headers.get('content-type'), 'text/vtt; charset=utf-8');
    assert.match(await vtt.text(), /00:00:00\.000 --> 00:01:00\.000\nthumb-000001\.jpg/);

    const imageUrl = source.thumbnailVttUrl.replace('/thumb.vtt', '/thumb-000002.jpg');
    const image = await harness.manager.handleLocalPlaybackRequest(new Request(imageUrl));
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    assert.equal(await image.text(), 'jpeg-two');
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
