'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const settings = require('../../app/runtime-dist/main-process/settings.js');

function tempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jable-settings-')), 'settings.json');
}

test('app settings store returns defaults and persists updates', function () {
  const filePath = tempSettingsPath();
  const store = new settings.AppSettingsStore(filePath);

  assert.deepEqual(store.get(), {
    maxBrowserTabs: 14,
    compactBrowserTabs: false,
    webViewEnhancementMode: false,
    fullSyncAjaxWindowSize: 3,
    autoReplayDeferredSyncOperations: false,
    ffmpegPath: null,
    downloadRoot: null,
    downloadStateFilters: ['all'],
    downloadSpeedMode: 'balanced',
    maxConcurrentDownloads: 1
  });

  assert.deepEqual(
    store.update({
      maxBrowserTabs: 22,
      compactBrowserTabs: true,
      webViewEnhancementMode: true,
      fullSyncAjaxWindowSize: 5,
      autoReplayDeferredSyncOperations: true,
      ffmpegPath: '/usr/local/bin/ffmpeg',
      downloadRoot: '/Users/example/Jable Downloads',
      downloadStateFilters: ['downloading', 'failed'],
      downloadSpeedMode: 'fast',
      maxConcurrentDownloads: 3
    }),
    {
      maxBrowserTabs: 22,
      compactBrowserTabs: true,
      webViewEnhancementMode: true,
      fullSyncAjaxWindowSize: 5,
      autoReplayDeferredSyncOperations: true,
      ffmpegPath: '/usr/local/bin/ffmpeg',
      downloadRoot: '/Users/example/Jable Downloads',
      downloadStateFilters: ['downloading', 'failed'],
      downloadSpeedMode: 'fast',
      maxConcurrentDownloads: 3
    }
  );

  const secondStore = new settings.AppSettingsStore(filePath);
  assert.equal(secondStore.get().maxBrowserTabs, 22);
  assert.equal(secondStore.get().compactBrowserTabs, true);
  assert.equal(secondStore.get().webViewEnhancementMode, true);
  assert.equal(secondStore.get().fullSyncAjaxWindowSize, 5);
  assert.equal(secondStore.get().autoReplayDeferredSyncOperations, true);
  assert.equal(secondStore.get().ffmpegPath, '/usr/local/bin/ffmpeg');
  assert.equal(secondStore.get().downloadRoot, '/Users/example/Jable Downloads');
  assert.deepEqual(secondStore.get().downloadStateFilters, ['downloading', 'failed']);
  assert.equal(secondStore.get().downloadSpeedMode, 'fast');
  assert.equal(secondStore.get().maxConcurrentDownloads, 3);
});

test('app settings patch clamps user-facing limits', function () {
  assert.deepEqual(
    settings.normalizeAppSettingsPatch({
      maxBrowserTabs: 999,
      fullSyncAjaxWindowSize: 999,
      maxConcurrentDownloads: 999
    }),
    {
      maxBrowserTabs: 30,
      fullSyncAjaxWindowSize: 5,
      maxConcurrentDownloads: 3
    }
  );

  assert.deepEqual(
    settings.normalizeAppSettingsPatch({
      maxBrowserTabs: -10,
      fullSyncAjaxWindowSize: -10,
      maxConcurrentDownloads: -10
    }),
    {
      maxBrowserTabs: 4,
      fullSyncAjaxWindowSize: 1,
      maxConcurrentDownloads: 1
    }
  );
});

test('app settings patch normalizes WebView enhancement mode', function () {
  assert.deepEqual(settings.normalizeAppSettingsPatch({ webViewEnhancementMode: 1 }), {
    webViewEnhancementMode: true
  });

  assert.deepEqual(settings.normalizeAppSettingsPatch({ webViewEnhancementMode: 0 }), {
    webViewEnhancementMode: false
  });
});

test('app settings normalize optional ffmpeg path', function () {
  assert.deepEqual(settings.normalizeAppSettingsPatch({ ffmpegPath: '  /opt/homebrew/bin/ffmpeg  ' }), {
    ffmpegPath: '/opt/homebrew/bin/ffmpeg'
  });

  assert.deepEqual(settings.normalizeAppSettingsPatch({ ffmpegPath: '' }), {
    ffmpegPath: null
  });
});

test('app settings normalize optional download root', function () {
  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadRoot: '  /Users/example/Jable Downloads  ' }), {
    downloadRoot: '/Users/example/Jable Downloads'
  });

  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadRoot: '' }), {
    downloadRoot: null
  });
});

test('app settings normalize download state filters', function () {
  for (const filter of ['queued', 'downloading', 'paused', 'failed', 'ready', 'missing']) {
    assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadStateFilter: filter }), {
      downloadStateFilters: [filter]
    });
  }

  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadStateFilter: 'active' }), {
    downloadStateFilters: ['downloading', 'queued']
  });

  assert.deepEqual(settings.normalizeAppSettings({ downloadStateFilter: 'failed' }).downloadStateFilters, ['failed']);

  assert.deepEqual(settings.normalizeAppSettings({ downloadStateFilters: ['active', 'failed'] }).downloadStateFilters, [
    'downloading',
    'queued',
    'failed'
  ]);

  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadStateFilters: ['failed', 'missing', 'failed'] }), {
    downloadStateFilters: ['failed', 'missing']
  });

  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadStateFilters: ['all', 'failed'] }), {
    downloadStateFilters: ['all']
  });

  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadStateFilter: 'ready_downloading' }), {
    downloadStateFilters: ['all']
  });

  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadStateFilter: 'needs_attention' }), {
    downloadStateFilters: ['all']
  });
});

test('app settings normalize download speed mode', function () {
  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadSpeedMode: 'stable' }), {
    downloadSpeedMode: 'stable'
  });

  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadSpeedMode: 'fast' }), {
    downloadSpeedMode: 'fast'
  });

  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadSpeedMode: 'custom' }), {
    downloadSpeedMode: 'balanced'
  });
});
