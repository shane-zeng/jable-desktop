'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const MAIN_SOURCE_PATH = path.join(__dirname, '..', '..', 'app', 'main.ts');
const APP_SOURCE_PATH = path.join(__dirname, '..', '..', 'app', 'renderer-src', 'App.vue');
const WEBVIEW_PRELOAD_SOURCE_PATH = path.join(__dirname, '..', '..', 'app', 'webview-preload.ts');

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('main process uses preload IPC for browser page requests', function () {
  const source = readSource(MAIN_SOURCE_PATH);
  const forbiddenMethod = 'execute' + 'JavaScript';
  const removedGlobal = 'jableDesktop' + 'Scraper';

  assert.equal(source.includes('.' + forbiddenMethod + '('), false);
  assert.equal(source.includes(removedGlobal), false);
  assert.match(source, /browser:sync-collection-request/);
  assert.match(source, /browser:diagnose-request/);
});

test('webview preload owns browser sync and diagnosis request handlers', function () {
  const source = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const removedGlobal = 'jableDesktop' + 'Scraper';

  assert.equal(source.includes(removedGlobal), false);
  assert.match(source, /browser:sync-collection-request/);
  assert.match(source, /browser:diagnose-request/);
  assert.match(source, /browser:preload-response/);
  assert.match(source, /function syncCollection/);
  assert.match(source, /function diagnosePage/);
});

test('webview deferred operation replay retries once and preserves outbox order after a failure', function () {
  const source = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);

  assert.match(source, /function applyDeferredSyncOperationWithSingleRetry/);
  assert.match(source, /await applyDeferredSyncOperationOnce\(operation, baseUrl\);[\s\S]*catch \(error\)/);
  assert.match(source, /Blocked by earlier failed operation/);
  assert.match(source, /for \(let blocked = i \+ 1; blocked < operations\.length; blocked\+\+\)/);
  assert.match(source, /break;\n\s*}\n\s*}/);
});

test('renderer reports queued operation failures outside the toast and counts final visible rows', function () {
  const source = readSource(APP_SOURCE_PATH);
  const mainSource = readSource(MAIN_SOURCE_PATH);

  assert.match(mainSource, /queuedOperationFailures = applied\.failures/);
  assert.match(source, /const finalVisibleRows = await api\.countVideos\(\{ collectionKey: collectionKey \}\)/);
  assert.match(source, /resultStatus\(collectionKey, mode, result, finishState, finalVisibleRows\)/);
  assert.match(source, /showQueuedFailureDialog\(collectionKey, result\)/);
  assert.match(source, /class="app-modal-url-list"/);
});

test('sync queue and finalization phases surface renderer status updates', function () {
  const source = readSource(APP_SOURCE_PATH);
  const mainSource = readSource(MAIN_SOURCE_PATH);

  assert.match(mainSource, /function notifySyncQueueProgress/);
  assert.match(mainSource, /'sync-queue-progress'/);
  assert.match(mainSource, /phase: 'start'/);
  assert.match(source, /message\.channel === 'sync-queue-progress'/);
  assert.match(source, /status\.syncQueueProcessing/);
  assert.match(source, /status\.syncFinalizingLocalData/);
  assert.match(source, /status\.syncReturningLibrary/);
  assert.match(source, /waitForSyncReturningNotice/);
});
