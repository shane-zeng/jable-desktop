'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const settings = require('../../app/runtime-dist/settings.js');

function tempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jable-settings-')), 'settings.json');
}

test('app settings store returns defaults and persists updates', function () {
  const filePath = tempSettingsPath();
  const store = new settings.AppSettingsStore(filePath);

  assert.deepEqual(store.get(), {
    maxBrowserTabs: 14,
    compactBrowserTabs: false,
    fullSyncAjaxWindowSize: 3,
    autoReplayDeferredSyncOperations: false,
    ffmpegPath: null,
    downloadRoot: null,
    downloadStateFilter: 'all'
  });

  assert.deepEqual(
    store.update({
      maxBrowserTabs: 22,
      compactBrowserTabs: true,
      fullSyncAjaxWindowSize: 5,
      autoReplayDeferredSyncOperations: true,
      ffmpegPath: '/usr/local/bin/ffmpeg',
      downloadRoot: '/Users/example/Jable Downloads',
      downloadStateFilter: 'ready_downloading'
    }),
    {
      maxBrowserTabs: 22,
      compactBrowserTabs: true,
      fullSyncAjaxWindowSize: 5,
      autoReplayDeferredSyncOperations: true,
      ffmpegPath: '/usr/local/bin/ffmpeg',
      downloadRoot: '/Users/example/Jable Downloads',
      downloadStateFilter: 'ready_downloading'
    }
  );

  const secondStore = new settings.AppSettingsStore(filePath);
  assert.equal(secondStore.get().maxBrowserTabs, 22);
  assert.equal(secondStore.get().compactBrowserTabs, true);
  assert.equal(secondStore.get().fullSyncAjaxWindowSize, 5);
  assert.equal(secondStore.get().autoReplayDeferredSyncOperations, true);
  assert.equal(secondStore.get().ffmpegPath, '/usr/local/bin/ffmpeg');
  assert.equal(secondStore.get().downloadRoot, '/Users/example/Jable Downloads');
  assert.equal(secondStore.get().downloadStateFilter, 'ready_downloading');
});

test('app settings patch clamps user-facing limits', function () {
  assert.deepEqual(
    settings.normalizeAppSettingsPatch({
      maxBrowserTabs: 999,
      fullSyncAjaxWindowSize: 999
    }),
    {
      maxBrowserTabs: 30,
      fullSyncAjaxWindowSize: 5
    }
  );

  assert.deepEqual(
    settings.normalizeAppSettingsPatch({
      maxBrowserTabs: -10,
      fullSyncAjaxWindowSize: -10
    }),
    {
      maxBrowserTabs: 4,
      fullSyncAjaxWindowSize: 1
    }
  );
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

test('app settings normalize download state filter', function () {
  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadStateFilter: 'ready_downloading' }), {
    downloadStateFilter: 'ready_downloading'
  });

  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadStateFilter: 'needs_attention' }), {
    downloadStateFilter: 'needs_attention'
  });

  assert.deepEqual(settings.normalizeAppSettingsPatch({ downloadStateFilter: 'failed' }), {
    downloadStateFilter: 'all'
  });
});
