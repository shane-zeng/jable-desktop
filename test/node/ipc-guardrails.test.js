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

test('webview pager fallback uses Jable get_block requests and page-number from parameters', function () {
  const source = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);

  assert.match(source, /function ajaxUrlForPagerLink/);
  assert.match(source, /url\.searchParams\.set\('mode', 'async'\)/);
  assert.match(source, /url\.searchParams\.set\('function', 'get_block'\)/);
  assert.match(source, /function loadPagerLinkByFetch/);
  assert.match(source, /new DOMParser\(\)\.parseFromString\(html, 'text\/html'\)/);
  assert.match(source, /function pagerPageParameter/);
  assert.match(source, /pageNumber = normalizePageNumber\(pageParameter\.value\)/);
  assert.equal(source.includes('Math.floor(parseInt(match[1], 10) / SITE_PAGE_SIZE) + 1'), false);
});

test('full sync can use a bounded ajax sliding window with sequential fallback', function () {
  const source = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);

  assert.match(source, /const FULL_SYNC_AJAX_WINDOW_SIZE = 3/);
  assert.match(source, /const FULL_SYNC_AJAX_MIN_PAGE_DELAY_MS = 500/);
  assert.match(source, /const FULL_SYNC_AJAX_MAX_PAGE_DELAY_MS = 1500/);
  assert.match(source, /const FULL_SYNC_AJAX_MAX_RETRIES = 3/);
  assert.match(source, /const FULL_SYNC_AJAX_BACKOFF_BASE_MS = 1000/);
  assert.match(source, /function ajaxUrlForPage/);
  assert.match(source, /async function fetchAjaxHtmlWithRetry/);
  assert.match(source, /retryAfterMsFromHeaders\(response\.headers\)/);
  assert.match(source, /isRetryableAjaxStatus\(response\.status\)/);
  assert.match(source, /async function fetchAjaxPagesWithWindow/);
  assert.match(source, /async function syncRemainingPagesWithAjaxWindow/);
  assert.match(source, /message: 'ajax-page-retry'/);
  assert.match(source, /message: 'ajax-window-fallback'/);
  assert.match(source, /rowUrlSignature\(firstPageCheck\.rows\) !== rowUrlSignature\(firstPageRows\)/);
  assert.match(source, /ajaxFallbackReason = ajaxFailureDetail\(error\)/);
  assert.match(source, /ajax sliding window sync failed; falling back to sequential paging/);
  assert.match(source, /await syncRemainingPagesWithAjaxWindow\(firstPageRows, firstPageSignature\)/);
});

test('main process replays queued collection operations after recoverable incomplete sync', function () {
  const source = readSource(MAIN_SOURCE_PATH);

  assert.match(source, /function shouldApplyDeferredSyncOperations/);
  assert.match(source, /result\.incompleteReason === 'login-required'/);
  assert.match(source, /result\.incompleteReason === 'batch-limit'/);
  assert.match(source, /if \(!keepWorker && shouldApplyDeferredSyncOperations\(resultWithWorker\)\)/);
  assert.equal(source.includes('!keepWorker && resultWithWorker.completed'), false);
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

test('renderer surfaces ajax retry and fallback reasons', function () {
  const source = readSource(APP_SOURCE_PATH);
  const mainSource = readSource(MAIN_SOURCE_PATH);

  assert.match(
    mainSource,
    /ajaxFallbackReason: optionalStringField\(record, 'ajaxFallbackReason', channel\) \|\| null/
  );
  assert.match(mainSource, /ajaxRetryCount: optionalNumberField\(record, 'ajaxRetryCount', channel\) \|\| 0/);
  assert.match(source, /progress\.message === 'ajax-page-retry'/);
  assert.match(source, /status\.syncAjaxRetry/);
  assert.match(source, /progress\.message === 'ajax-window-fallback'/);
  assert.match(source, /status\.syncAjaxFallback/);
  assert.match(source, /status\.syncAjaxFallbackResult/);
  assert.match(source, /status\.syncIncompleteAfterAjaxFallback/);
});
