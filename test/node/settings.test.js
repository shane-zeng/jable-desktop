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
    autoReplayDeferredSyncOperations: false
  });

  assert.deepEqual(
    store.update({
      maxBrowserTabs: 22,
      compactBrowserTabs: true,
      fullSyncAjaxWindowSize: 5,
      autoReplayDeferredSyncOperations: true
    }),
    {
      maxBrowserTabs: 22,
      compactBrowserTabs: true,
      fullSyncAjaxWindowSize: 5,
      autoReplayDeferredSyncOperations: true
    }
  );

  const secondStore = new settings.AppSettingsStore(filePath);
  assert.equal(secondStore.get().maxBrowserTabs, 22);
  assert.equal(secondStore.get().compactBrowserTabs, true);
  assert.equal(secondStore.get().fullSyncAjaxWindowSize, 5);
  assert.equal(secondStore.get().autoReplayDeferredSyncOperations, true);
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
