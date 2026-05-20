'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const downloadManager = require('../../app/runtime-dist/main-process/download/manager.js');
const { createDownloadActiveRunner } = require('../../app/runtime-dist/main-process/download/active-runner.js');

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
      downloadSource: 'normal',
      localPath: null,
      state: 'ready',
      progress: null,
      playbackAutoResumeBlocked: false,
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
    session: {
      fromPartition: function () {
        return {
          cookies: {
            get: function () {
              return Promise.resolve([]);
            }
          }
        };
      }
    },
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

function createFakeRemuxFfmpeg(userDataDir) {
  const filePath = path.join(userDataDir, process.platform === 'win32' ? 'fake-remux-ffmpeg.cmd' : 'fake-remux-ffmpeg');
  const script =
    process.platform === 'win32'
      ? [
          '@echo off',
          'set "out="',
          ':read_args',
          'if "%~1"=="" goto write_output',
          'set "out=%~1"',
          'shift',
          'goto read_args',
          ':write_output',
          '> "%out%" echo fake-video',
          'echo total_size=10',
          ''
        ].join('\r\n')
      : [
          '#!/bin/sh',
          'out=""',
          'for arg in "$@"; do',
          '  out="$arg"',
          'done',
          'printf "fake-video" > "$out"',
          'printf "total_size=10\\n"',
          ''
        ].join('\n');
  fs.writeFileSync(filePath, script);
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

function waitForCondition(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('timed out waiting for condition'));
        return;
      }
      setTimeout(poll, 10);
    }
    poll();
  });
}

async function withMockFetch(handler, run) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  try {
    await run();
  } finally {
    global.fetch = originalFetch;
  }
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

test('download active runner formalizes completed playback background downloads', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-background-ready-formal-'));
  try {
    const videoUrl = 'https://jable.tv/videos/background-ready-formal/';
    const outputPath = path.join(userDataDir, 'downloads', 'background-ready-formal.mp4');
    const fakeFfmpeg = createFakeRemuxFfmpeg(userDataDir);
    const patches = [];
    let beforeDownloadSegmentsCalled = false;
    let record = downloadRecord({
      videoUrl: videoUrl,
      downloadSource: 'playback_auto',
      localPath: 'background-ready-formal.mp4',
      state: 'queued'
    });

    const runner = createDownloadActiveRunner({
      clearActiveDownload: function () {},
      clearDownloadFlags: function () {},
      clearPlaybackCaptureAfterActiveDownload: function () {},
      clearRuntimeProgress: function () {},
      downloadCanceledError: function () {
        return new Error('canceled');
      },
      downloadErrorMessage: function (error) {
        return error && error.message ? error.message : String(error);
      },
      downloadFileSystemError: function (error) {
        return error instanceof Error ? error : new Error(String(error));
      },
      downloadHlsSegmentsWithPlaylistRefresh: async function () {
        const playlistPath = path.join(userDataDir, 'playlist.m3u8');
        fs.writeFileSync(playlistPath, '#EXTM3U\n');
        return playlistPath;
      },
      downloadPausedError: function () {
        return new Error('paused');
      },
      downloadTimestamp: function () {
        return '2026-05-20T00:00:00.000Z';
      },
      ffmpegCommandForDownload: async function () {
        return fakeFfmpeg;
      },
      isCanceled: function () {
        return false;
      },
      isDeleted: function () {
        return false;
      },
      isPaused: function () {
        return false;
      },
      localPlaybackReadyFile: function () {
        return null;
      },
      notifyDownloadsChanged: function () {},
      path: path,
      removePartialDownloadFile: function (targetPath) {
        fs.rmSync(targetPath + '.part', { force: true });
      },
      resolveDownloadHlsSource: async function () {
        return {
          cookieHeader: '',
          playlist: {
            url: 'https://cdn.example.test/background-ready-formal/index.m3u8',
            segments: []
          },
          sourcePageChineseSubtitleNotice: false,
          sourcePageSubtitleNoticeText: null
        };
      },
      resolveManagedDownloadPath: function (fileRelativePath) {
        return fileRelativePath ? path.join(userDataDir, 'downloads', fileRelativePath) : null;
      },
      schedulePreviewGeneration: function () {},
      statFile: function (filePath) {
        return fs.statSync(filePath);
      },
      t: function (key) {
        return key;
      },
      updateDownloadRuntimeProgress: function () {},
      upsertPersistedDownload: function (patch) {
        patches.push(Object.assign({}, patch));
        record = Object.assign({}, record, patch);
        return record;
      },
      writeDirectory: function (directoryPath) {
        fs.mkdirSync(directoryPath, { recursive: true });
      }
    });

    await runner.runActiveDownload(
      record,
      {
        abortController: new AbortController(),
        nativeId: null,
        process: null,
        source: 'playback_background'
      },
      true,
      async function () {
        beforeDownloadSegmentsCalled = true;
      }
    );

    assert.equal(beforeDownloadSegmentsCalled, true);
    assert.equal(record.state, 'ready');
    assert.equal(record.downloadSource, 'normal');
    assert.equal(record.progress, 1);
    assert.equal(record.completedAt, '2026-05-20T00:00:00.000Z');
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'fake-video');
    assert.equal(
      patches.some(function (patch) {
        return patch.state === 'ready' && patch.downloadSource === 'normal';
      }),
      true
    );
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager captures proxied HLS playback segments for later resume', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-'));
  try {
    const videoUrl = 'https://jable.tv/videos/capture-test/';
    const playlistUrl = 'https://cdn.example.test/hls/capture/index.m3u8';
    const harness = createHarness([], userDataDir);

    const plan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: videoUrl,
      userInitiatedPlayback: true,
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
    assert.equal(record.downloadSource, 'playback_auto');
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

test('download manager requires user-initiated playback before preparing auto capture', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-user-gesture-'));
  try {
    const videoUrl = 'https://jable.tv/videos/capture-user-gesture/';
    const playlistUrl = 'https://cdn.example.test/hls/capture-user-gesture/index.m3u8';
    const playlistText = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'segment-001.ts',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n');
    const harness = createHarness([], userDataDir, {
      autoDownloadOnPlayback: true
    });

    const ignored = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: videoUrl,
      title: 'Capture User Gesture',
      playlistUrl: playlistUrl,
      playlistText: playlistText
    });

    assert.equal(ignored, null);
    assert.equal(harness.records.has(videoUrl), false);
    assert.notEqual(
      harness.manager.prepareHlsPlaybackCapture({
        videoUrl: videoUrl,
        userInitiatedPlayback: true,
        title: 'Capture User Gesture',
        playlistUrl: playlistUrl,
        playlistText: playlistText
      }),
      null
    );
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager does not let playback capture retry formal canceled downloads', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-formal-cancel-'));
  try {
    const videoUrl = 'https://jable.tv/videos/formal-canceled/';
    const playlistUrl = 'https://cdn.example.test/hls/formal-canceled/index.m3u8';
    const playlistText = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'segment-001.ts',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n');
    const harness = createHarness(
      [
        {
          videoUrl: videoUrl,
          downloadSource: 'normal',
          localPath: 'formal-canceled.mp4',
          state: 'failed',
          error: 'status.downloadCanceled',
          failureCode: 'download_canceled'
        }
      ],
      userDataDir,
      {
        autoDownloadOnPlayback: true
      }
    );

    assert.equal(
      harness.manager.prepareHlsPlaybackCapture({
        videoUrl: videoUrl,
        pageLoadId: 'formal-cancel-load-1',
        userInitiatedPlayback: true,
        title: 'Formal Canceled',
        playlistUrl: playlistUrl,
        playlistText: playlistText
      }),
      null
    );
    assert.equal(harness.records.get(videoUrl).downloadSource, 'normal');
    assert.equal(harness.records.get(videoUrl).state, 'failed');
    assert.equal(harness.records.get(videoUrl).failureCode, 'download_canceled');
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager queues playback background completion without persisting foreground progress', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-auto-'));
  try {
    const videoUrl = 'https://jable.tv/videos/capture-auto/';
    const playlistUrl = 'https://cdn.example.test/hls/capture-auto/index.m3u8';
    const harness = createHarness([], userDataDir, {
      autoDownloadOnPlayback: true,
      maxConcurrentDownloads: 0
    });

    let workerStarted = false;
    const plan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: videoUrl,
      userInitiatedPlayback: true,
      title: 'Capture Auto',
      sourcePageChineseSubtitleNotice: true,
      sourcePageSubtitleNoticeText: '此作品曾在本站上傳，現已更新至中文字幕版。',
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
    assert.equal(harness.records.get(videoUrl).state, 'queued');
    assert.equal(harness.records.get(videoUrl).downloadSource, 'playback_auto');
    assert.equal(harness.records.get(videoUrl).progress, null);
    assert.equal(harness.records.get(videoUrl).sourcePageChineseSubtitleNotice, true);
    assert.equal(
      harness.records.get(videoUrl).sourcePageSubtitleNoticeText,
      '此作品曾在本站上傳，現已更新至中文字幕版。'
    );
    harness.manager.queueHlsPlaybackBackgroundCompletion({
      videoUrl: videoUrl,
      run: async function () {
        workerStarted = true;
      }
    });
    assert.equal(workerStarted, false);

    fs.writeFileSync(plan.segments[0].filePath, 'segment-one');
    harness.manager.recordHlsPlaybackCaptureSegment({
      videoUrl: videoUrl,
      filePath: plan.segments[0].filePath
    });
    assert.equal(harness.records.get(videoUrl).state, 'queued');
    assert.equal(harness.records.get(videoUrl).progress, null);
    assert.equal(
      harness.manager.listDownloads().find(function (record) {
        return record.videoUrl === videoUrl;
      }).progress,
      null
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

test('download manager formalizes existing ready playback auto records when listing downloads', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-ready-playback-auto-formal-'));
  try {
    const videoUrl = 'https://jable.tv/videos/ready-playback-auto-formal/';
    const downloadRoot = path.join(userDataDir, 'downloads');
    fs.mkdirSync(downloadRoot, { recursive: true });
    fs.writeFileSync(path.join(downloadRoot, 'ready-playback-auto-formal.mp4'), 'ready');

    const harness = createHarness(
      [
        {
          videoUrl: videoUrl,
          downloadSource: 'playback_auto',
          localPath: 'ready-playback-auto-formal.mp4',
          state: 'ready',
          fileSizeBytes: 1,
          completedAt: '2026-05-20T00:00:00.000Z'
        }
      ],
      userDataDir
    );

    const records = harness.manager.listDownloads();
    assert.equal(records.length, 1);
    assert.equal(records[0].state, 'ready');
    assert.equal(records[0].downloadSource, 'normal');
    assert.equal(records[0].fileSizeBytes, 5);
    assert.equal(harness.records.get(videoUrl).downloadSource, 'normal');
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager pauses playback auto jobs when auto-download setting is disabled', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-setting-disable-'));
  try {
    const videoUrl = 'https://jable.tv/videos/capture-setting-disable/';
    const normalUrl = 'https://jable.tv/videos/normal-setting-disable/';
    const playlistUrl = 'https://cdn.example.test/hls/capture-setting-disable/index.m3u8';
    const playlistText = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'segment-001.ts',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n');
    const settings = {
      autoDownloadOnPlayback: true,
      ffmpegPath: createFakeFfmpeg(userDataDir),
      maxConcurrentDownloads: 0
    };
    const harness = createHarness(
      [
        {
          videoUrl: normalUrl,
          downloadSource: 'normal',
          localPath: 'normal-setting-disable.mp4',
          state: 'failed'
        }
      ],
      userDataDir,
      settings
    );
    await harness.manager.retryDownload(normalUrl);
    assert.equal(harness.records.get(normalUrl).state, 'queued');

    assert.notEqual(
      harness.manager.prepareHlsPlaybackCapture({
        videoUrl: videoUrl,
        pageLoadId: 'setting-disable-load-1',
        userInitiatedPlayback: true,
        title: 'Capture Setting Disable',
        playlistUrl: playlistUrl,
        playlistText: playlistText
      }),
      null
    );
    harness.manager.queueHlsPlaybackBackgroundCompletion({
      videoUrl: videoUrl,
      pageLoadId: 'setting-disable-load-1',
      run: async function () {}
    });

    settings.autoDownloadOnPlayback = false;
    assert.deepEqual(harness.manager.pausePlaybackAutoDownloadsForSettingDisable(), {
      requested: 1,
      affected: 1,
      skipped: 0,
      failed: 0
    });
    assert.equal(harness.records.get(videoUrl).state, 'paused');
    assert.equal(harness.records.get(videoUrl).downloadSource, 'playback_auto');
    assert.equal(harness.records.get(videoUrl).playbackAutoResumeBlocked, false);
    assert.equal(harness.records.get(normalUrl).state, 'queued');
    assert.equal(
      harness.manager.shouldContinueHlsPlaybackCapture({
        videoUrl: videoUrl,
        pageLoadId: 'setting-disable-load-1'
      }),
      false
    );
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager does not start stale playback background queue while auto-download is disabled', function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-disabled-queue-'));
  try {
    const videoUrl = 'https://jable.tv/videos/capture-disabled-queue/';
    const playlistUrl = 'https://cdn.example.test/hls/capture-disabled-queue/index.m3u8';
    const playlistText = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'segment-001.ts',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n');
    const settings = {
      autoDownloadOnPlayback: true,
      maxConcurrentDownloads: 0
    };
    const harness = createHarness([], userDataDir, settings);
    let workerStarted = false;

    assert.notEqual(
      harness.manager.prepareHlsPlaybackCapture({
        videoUrl: videoUrl,
        pageLoadId: 'disabled-queue-load-1',
        userInitiatedPlayback: true,
        title: 'Capture Disabled Queue',
        playlistUrl: playlistUrl,
        playlistText: playlistText
      }),
      null
    );
    harness.manager.queueHlsPlaybackBackgroundCompletion({
      videoUrl: videoUrl,
      pageLoadId: 'disabled-queue-load-1',
      run: async function () {
        workerStarted = true;
      }
    });

    settings.autoDownloadOnPlayback = false;
    settings.maxConcurrentDownloads = 1;
    harness.manager.processQueue();

    assert.equal(workerStarted, false);
    assert.equal(harness.records.get(videoUrl).state, 'paused');
    assert.equal(harness.records.get(videoUrl).playbackAutoResumeBlocked, false);
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager starts playback background completion only after a queue slot opens', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-gated-'));
  try {
    const fakeFfmpeg = createFakeFfmpeg(userDataDir);
    const videoUrl = 'https://jable.tv/videos/capture-gated/';
    const playlistUrl = 'https://cdn.example.test/hls/capture-gated/index.m3u8';
    const playlistText = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10,',
      'segment-001.ts',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n');
    const events = [];
    const settings = {
      autoDownloadOnPlayback: true,
      ffmpegPath: fakeFfmpeg,
      maxConcurrentDownloads: 0
    };
    const harness = createHarness([], userDataDir, settings);

    const plan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: videoUrl,
      userInitiatedPlayback: true,
      title: 'Capture Gated',
      playlistUrl: playlistUrl,
      playlistText: playlistText
    });
    assert.notEqual(plan, null);

    let workerStarted = 0;
    harness.manager.queueHlsPlaybackBackgroundCompletion({
      videoUrl: videoUrl,
      run: async function () {
        events.push('worker');
        workerStarted += 1;
        assert.equal(harness.records.get(videoUrl).sourcePageChineseSubtitleNotice, true);
        assert.equal(
          harness.records.get(videoUrl).sourcePageSubtitleNoticeText,
          '此作品曾在本站上傳，現已更新至中文字幕版。'
        );
        harness.manager.pauseDownload(videoUrl);
      }
    });

    assert.equal(harness.records.get(videoUrl).state, 'queued');
    assert.equal(harness.records.get(videoUrl).downloadSource, 'playback_auto');
    assert.equal(workerStarted, 0);

    await withMockFetch(
      async function (url) {
        if (String(url) === videoUrl) {
          events.push('page');
          return new Response(
            '<h5 class="desc h6-md">此作品曾在本站上傳，現已更新至中文字幕版。</h5>' +
              '<script>const playlist = "' +
              playlistUrl +
              '";</script>',
            { status: 200 }
          );
        }
        if (String(url) === playlistUrl) {
          events.push('playlist');
          return new Response(playlistText, { status: 200 });
        }
        throw new Error('unexpected fetch: ' + String(url));
      },
      async function () {
        settings.maxConcurrentDownloads = 1;
        harness.manager.processQueue();
        await waitForCondition(function () {
          return workerStarted === 1;
        });
        await waitForCondition(function () {
          return harness.records.get(videoUrl).state === 'paused';
        });
      }
    );
    assert.equal(harness.records.get(videoUrl).playbackAutoResumeBlocked, false);
    assert.deepEqual(events, ['page', 'playlist', 'worker']);
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('download manager keeps playback background pauses auto-resumable', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-background-pause-'));
  try {
    const videoUrl = 'https://jable.tv/videos/capture-background-pause/';
    const playlistUrl = 'https://cdn.example.test/hls/capture-background-pause/index.m3u8';
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

    const plan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: videoUrl,
      pageLoadId: 'background-pause-load-1',
      userInitiatedPlayback: true,
      title: 'Capture Background Pause',
      playlistUrl: playlistUrl,
      playlistText: playlistText
    });
    assert.notEqual(plan, null);

    harness.manager.queueHlsPlaybackBackgroundCompletion({
      videoUrl: videoUrl,
      pageLoadId: 'background-pause-load-1',
      run: async function () {}
    });
    const paused = harness.manager.pauseDownload(videoUrl);
    assert.equal(paused.record.state, 'paused');
    assert.equal(paused.record.playbackAutoResumeBlocked, false);
    assert.equal(
      harness.manager.shouldProxyHlsPlaybackCapture({
        videoUrl: videoUrl,
        pageLoadId: 'background-pause-load-2'
      }),
      true
    );
    assert.notEqual(
      harness.manager.prepareHlsPlaybackCapture({
        videoUrl: videoUrl,
        pageLoadId: 'background-pause-load-2',
        userInitiatedPlayback: true,
        title: 'Capture Background Pause',
        playlistUrl: playlistUrl,
        playlistText: playlistText
      }),
      null
    );

    harness.manager.queueHlsPlaybackBackgroundCompletion({
      videoUrl: videoUrl,
      pageLoadId: 'background-pause-load-2',
      run: async function () {}
    });
    await harness.manager.pauseDownloadsForShutdown();
    assert.equal(harness.records.get(videoUrl).state, 'paused');
    assert.equal(harness.records.get(videoUrl).playbackAutoResumeBlocked, false);
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
      userInitiatedPlayback: true,
      title: 'Capture Pause',
      playlistUrl: playlistUrl,
      playlistText: playlistText
    });
    assert.equal(harness.records.get(pausedUrl).state, 'queued');
    assert.equal(
      harness.manager.shouldContinueHlsPlaybackCapture({ videoUrl: pausedUrl, pageLoadId: 'pause-load-1' }),
      true
    );
    const paused = harness.manager.pauseDownload(pausedUrl);
    assert.equal(paused.record.state, 'paused');
    assert.equal(paused.record.playbackAutoResumeBlocked, false);
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
      userInitiatedPlayback: true,
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
    assert.notEqual(
      harness.manager.prepareHlsPlaybackCapture({
        videoUrl: canceledUrl,
        pageLoadId: 'cancel-load-2',
        userInitiatedPlayback: true,
        title: 'Capture Cancel',
        playlistUrl: playlistUrl,
        playlistText: playlistText
      }),
      null
    );

    const deletedUrl = 'https://jable.tv/videos/capture-delete/';
    const deletedPlan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: deletedUrl,
      pageLoadId: 'delete-load-1',
      userInitiatedPlayback: true,
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
        userInitiatedPlayback: true,
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
        userInitiatedPlayback: true,
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

test('download manager blocks playback auto-resume after paused capture is resumed into the normal queue', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-hls-capture-manual-pause-'));
  try {
    const fakeFfmpeg = createFakeFfmpeg(userDataDir);
    const playlistUrl = 'https://cdn.example.test/hls/manual-pause/index.m3u8';
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
      ffmpegPath: fakeFfmpeg,
      maxConcurrentDownloads: 0
    });
    const videoUrl = 'https://jable.tv/videos/capture-manual-pause/';

    const plan = harness.manager.prepareHlsPlaybackCapture({
      videoUrl: videoUrl,
      pageLoadId: 'load-1',
      userInitiatedPlayback: true,
      title: 'Capture Manual Pause',
      playlistUrl: playlistUrl,
      playlistText: playlistText
    });
    assert.notEqual(plan, null);
    const playbackPause = harness.manager.pauseDownload(videoUrl);
    assert.equal(playbackPause.record.state, 'paused');
    assert.equal(playbackPause.record.downloadSource, 'playback_auto');
    assert.equal(playbackPause.record.playbackAutoResumeBlocked, false);
    assert.equal(harness.manager.shouldProxyHlsPlaybackCapture({ videoUrl: videoUrl, pageLoadId: 'load-2' }), true);

    const resumed = await harness.manager.resumeDownload(videoUrl);
    assert.equal(resumed.queued, true);
    assert.equal(resumed.record.state, 'queued');
    assert.equal(resumed.record.downloadSource, 'normal');
    assert.equal(resumed.record.playbackAutoResumeBlocked, false);
    harness.manager.queueHlsPlaybackBackgroundCompletion({
      videoUrl: videoUrl,
      pageLoadId: 'load-1',
      run: async function () {}
    });

    const normalPause = harness.manager.pauseDownload(videoUrl);
    assert.equal(normalPause.record.state, 'paused');
    assert.equal(normalPause.record.downloadSource, 'normal');
    assert.equal(normalPause.record.playbackAutoResumeBlocked, true);
    assert.equal(harness.manager.shouldProxyHlsPlaybackCapture({ videoUrl: videoUrl, pageLoadId: 'load-2' }), false);
    fs.writeFileSync(plan.segments[0].filePath, 'segment-one');
    harness.manager.recordHlsPlaybackCaptureSegment({
      videoUrl: videoUrl,
      pageLoadId: 'load-2',
      filePath: plan.segments[0].filePath
    });
    assert.equal(harness.records.get(videoUrl).playbackAutoResumeBlocked, true);
    assert.equal(
      harness.manager.prepareHlsPlaybackCapture({
        videoUrl: videoUrl,
        pageLoadId: 'load-2',
        userInitiatedPlayback: true,
        title: 'Capture Manual Pause',
        playlistUrl: playlistUrl,
        playlistText: playlistText
      }),
      null
    );

    const resumedAgain = await harness.manager.resumeDownload(videoUrl);
    assert.equal(resumedAgain.record.playbackAutoResumeBlocked, false);

    const retryUrl = 'https://jable.tv/videos/capture-manual-pause-retry/';
    harness.records.set(
      retryUrl,
      downloadRecord({
        videoUrl: retryUrl,
        localPath: 'capture-manual-pause-retry.mp4',
        state: 'failed',
        playbackAutoResumeBlocked: true
      })
    );
    const retried = await harness.manager.retryDownload(retryUrl);
    assert.equal(retried.record.downloadSource, 'normal');
    assert.equal(retried.record.playbackAutoResumeBlocked, false);

    const enqueueUrl = 'https://jable.tv/videos/capture-manual-pause-enqueue/';
    harness.records.set(
      enqueueUrl,
      downloadRecord({
        videoUrl: enqueueUrl,
        localPath: 'capture-manual-pause-enqueue.mp4',
        state: 'paused',
        playbackAutoResumeBlocked: true
      })
    );
    const enqueued = await harness.manager.enqueueDownload({
      collectionKey: 'favourites',
      video: {
        title: 'Capture Manual Pause Enqueue',
        url: enqueueUrl,
        views: null,
        likes: null,
        img: null,
        preview: null
      }
    });
    assert.equal(enqueued.record.downloadSource, 'normal');
    assert.equal(enqueued.record.playbackAutoResumeBlocked, false);
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
      const record = harness.records.get('https://jable.tv/videos/' + slug + '/');
      assert.equal(record.state, 'paused');
      assert.equal(record.playbackAutoResumeBlocked, true);
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
