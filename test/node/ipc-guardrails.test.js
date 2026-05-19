'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..', '..');
const MAIN_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main.ts');
const BROWSER_TAB_MANAGER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'browser-tab-manager.ts');
const CONTEXT_MENU_MANAGER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'context-menu-manager.ts');
const DOWNLOAD_MANAGER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download-manager.ts');
const IPC_HANDLERS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'ipc-handlers.ts');
const TYPES_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'types', 'jable.ts');
const HLS_CAPTURE_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback-capture.ts');
const HLS_HELPERS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback-helpers.ts');
const HLS_RESEARCH_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback-research.ts');
const NATIVE_DOWNLOADS_SOURCE_PATH = path.join(ROOT_DIR, 'native', 'local-data-engine', 'src', 'downloads.rs');
const NATIVE_SCHEMA_SOURCE_PATH = path.join(ROOT_DIR, 'native', 'local-data-engine', 'src', 'schema.rs');
const SYNC_WORKER_MANAGER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'sync-worker-manager.ts');
const APP_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'renderer-src', 'App.vue');
const IPC_NORMALIZERS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'ipc-normalizers.ts');
const SYNC_WORKFLOW_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'renderer-src', 'composables', 'useSyncWorkflow.ts');
const DOWNLOAD_WORKFLOW_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'renderer-src',
  'composables',
  'useDownloadWorkflow.ts'
);
const DOWNLOAD_DISPLAY_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'renderer-src', 'download-display.ts');
const STYLES_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'renderer-src', 'styles.css');
const WEBVIEW_PRELOAD_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'webview-preload.ts');
const WEBVIEW_HELPERS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'browser', 'webview-preload-helpers.ts');
const WEBVIEW_BROWSER_SYNC_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'browser', 'webview-preload', 'browser-sync.ts');
const WEBVIEW_COLLECTION_ACTIONS_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'browser',
  'webview-preload',
  'collection-actions.ts'
);
const WEBVIEW_HLS_PLAYBACK_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'browser', 'webview-preload', 'hls-playback.ts');
const WEBVIEW_LOCAL_PLAYBACK_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'browser',
  'webview-preload',
  'local-playback.ts'
);
const WEBVIEW_THEATER_MODE_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'browser', 'webview-preload', 'theater-mode.ts');
const WEBVIEW_VIDEO_METADATA_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'browser',
  'webview-preload',
  'video-metadata.ts'
);
const LOCAL_PLAYBACK_PREVIEW_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'local-playback-preview.ts');

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('main process uses preload IPC for browser page requests', function () {
  const source = readSource(MAIN_SOURCE_PATH);
  const ipcHandlersSource = readSource(IPC_HANDLERS_SOURCE_PATH);
  const syncWorkerSource = readSource(SYNC_WORKER_MANAGER_SOURCE_PATH);
  const preloadSource = readSource(path.join(__dirname, '..', '..', 'app', 'preload.ts'));
  const typesSource = readSource(TYPES_SOURCE_PATH);
  const forbiddenMethod = 'execute' + 'JavaScript';
  const removedGlobal = 'jableDesktop' + 'Scraper';

  assert.equal(source.includes('.' + forbiddenMethod + '('), false);
  assert.equal(syncWorkerSource.includes('.' + forbiddenMethod + '('), false);
  assert.equal(source.includes(removedGlobal), false);
  assert.equal(syncWorkerSource.includes(removedGlobal), false);
  assert.match(syncWorkerSource, /browser:sync-collection-request/);
  assert.match(ipcHandlersSource, /browser:diagnose-request/);
  assert.match(ipcHandlersSource, /app:get-settings/);
  assert.match(ipcHandlersSource, /app:update-settings/);
  assert.match(ipcHandlersSource, /app:open-local-data-folder/);
  assert.match(ipcHandlersSource, /app:open-ffmpeg-guide/);
  assert.match(ipcHandlersSource, /app:check-for-updates/);
  assert.match(preloadSource, /getSettings/);
  assert.match(preloadSource, /updateSettings/);
  assert.match(preloadSource, /openFfmpegGuide/);
  assert.match(preloadSource, /openLocalDataFolder/);
  assert.match(preloadSource, /checkForUpdates/);
  assert.match(typesSource, /openFfmpegGuide\(\): Promise<OpenDocumentationResult>/);
  assert.match(source, /README\.zh-TW\.md#/);
  assert.match(source, /README\.en-US\.md#download-list-and-ffmpeg/);
  assert.match(source, /README\.ja-JP\.md#/);
  assert.match(source, /shell\.openExternal\(url\)/);
});

test('webview preload owns browser sync and diagnosis request handlers', function () {
  const source = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const browserSyncSource = readSource(WEBVIEW_BROWSER_SYNC_SOURCE_PATH);
  const removedGlobal = 'jableDesktop' + 'Scraper';

  assert.equal(source.includes(removedGlobal), false);
  assert.match(source, /createBrowserSyncController/);
  assert.match(source, /browser:sync-collection-request/);
  assert.match(source, /browser:diagnose-request/);
  assert.match(source, /browser:preload-response/);
  assert.match(browserSyncSource, /function syncCollection/);
  assert.match(source, /function diagnosePage/);
});

test('webview pager fallback uses Jable get_block requests and page-number from parameters', function () {
  const source = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const helperSource = readSource(WEBVIEW_HELPERS_SOURCE_PATH);

  assert.match(helperSource, /function ajaxUrlForPagerLink/);
  assert.match(helperSource, /url\.searchParams\.set\('mode', 'async'\)/);
  assert.match(helperSource, /url\.searchParams\.set\('function', 'get_block'\)/);
  assert.match(source, /function loadPagerLinkByFetch/);
  assert.match(source, /new DOMParser\(\)\.parseFromString\(html, 'text\/html'\)/);
  assert.match(helperSource, /function pagerPageParameter/);
  assert.match(source, /pageNumber = normalizePageNumber\(pageParameter\.value\)/);
  assert.equal(source.includes('Math.floor(parseInt(match[1], 10) / SITE_PAGE_SIZE) + 1'), false);
});

test('full sync can use bounded concurrent ajax prefetch with sequential fallback', function () {
  const source = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const browserSyncSource = readSource(WEBVIEW_BROWSER_SYNC_SOURCE_PATH);
  const helperSource = readSource(WEBVIEW_HELPERS_SOURCE_PATH);
  const mainSource = readSource(MAIN_SOURCE_PATH);

  assert.match(
    helperSource,
    /export const DEFAULT_FULL_SYNC_AJAX_WINDOW_SIZE = DEFAULT_APP_SETTINGS\.fullSyncAjaxWindowSize/
  );
  assert.match(helperSource, /export const MAX_FULL_SYNC_AJAX_WINDOW_SIZE = FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS\.max/);
  assert.match(helperSource, /function normalizeAjaxWindowSize/);
  assert.match(mainSource, /ajaxWindowSize: getAppSettings\(\)\.fullSyncAjaxWindowSize/);
  assert.match(helperSource, /const FULL_SYNC_AJAX_MIN_PAGE_DELAY_MS = 500/);
  assert.match(helperSource, /const FULL_SYNC_AJAX_MAX_PAGE_DELAY_MS = 1500/);
  assert.match(helperSource, /const FULL_SYNC_AJAX_MAX_RETRIES = 3/);
  assert.match(helperSource, /const FULL_SYNC_AJAX_BACKOFF_BASE_MS = 1000/);
  assert.match(helperSource, /function ajaxUrlForPage/);
  assert.match(helperSource, /async function fetchAjaxHtmlWithRetry/);
  assert.match(helperSource, /retryAfterMsFromHeaders\(response\.headers\)/);
  assert.match(helperSource, /isRetryableAjaxStatus\(response\.status\)/);
  assert.match(helperSource, /async function fetchAjaxSyncPage/);
  assert.match(helperSource, /async function fetchAjaxPagesWithWindow/);
  assert.match(helperSource, /function validateAjaxFirstPage/);
  assert.match(helperSource, /function validateAjaxPages/);
  assert.match(browserSyncSource, /async function syncRemainingPagesWithAjaxPrefetch/);
  assert.match(source, /async function fetchAjaxSyncPageForTemplate/);
  assert.match(browserSyncSource, /message: 'ajax-page-retry'/);
  assert.match(browserSyncSource, /message: 'ajax-prefetch-fallback'/);
  assert.match(helperSource, /rowUrlSignature\(firstPageCheck\.rows\) !== rowUrlSignature\(firstPageRows\)/);
  assert.match(browserSyncSource, /ajaxFallbackReason = ajaxFailureDetail\(error\)/);
  assert.match(browserSyncSource, /ajax prefetch failed; falling back to sequential paging/);
  assert.match(browserSyncSource, /await syncRemainingPagesWithAjaxPrefetch\(firstPageRows, firstPageSignature\)/);
});

test('main process replays queued collection operations after recoverable incomplete sync', function () {
  const source = readSource(SYNC_WORKER_MANAGER_SOURCE_PATH);
  const ipcHandlersSource = readSource(IPC_HANDLERS_SOURCE_PATH);
  const webviewPreload = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const collectionActionsSource = readSource(WEBVIEW_COLLECTION_ACTIONS_SOURCE_PATH);

  assert.match(source, /function shouldApplyDeferredSyncOperations/);
  assert.match(source, /result\.incompleteReason === 'login-required'/);
  assert.match(source, /result\.incompleteReason === 'batch-limit'/);
  assert.match(source, /getAutoReplayDeferredSyncOperations\(\)/);
  assert.match(ipcHandlersSource, /normalizedPayload\.deferLocal = true/);
  assert.match(source, /resultWithWorker\.queuedOperationsSkipped = skipped/);
  assert.equal(source.includes('!keepWorker && resultWithWorker.completed'), false);
  assert.match(webviewPreload, /createCollectionActionController/);
  assert.match(webviewPreload, /collectionActionController\.updateActiveSyncLocks/);
  assert.match(webviewPreload, /collectionActionController\.updatePendingCollectionOperations/);
  assert.match(collectionActionsSource, /function queueCollectionToggle/);
  assert.match(collectionActionsSource, /deferRemote: true/);
  assert.match(collectionActionsSource, /syncRunId: syncLock\.syncRunId/);
  assert.match(collectionActionsSource, /function installPendingCollectionOperationOverlay/);
  assert.match(collectionActionsSource, /schedulePendingOverlay: scheduleApplyPendingCollectionOperations/);
});

test('webview deferred operation replay retries once and preserves outbox order after a failure', function () {
  const source = readSource(WEBVIEW_BROWSER_SYNC_SOURCE_PATH);

  assert.match(source, /function applyDeferredSyncOperationWithSingleRetry/);
  assert.match(source, /await applyDeferredSyncOperationOnce\(operation, baseUrl\);[\s\S]*catch \(error\)/);
  assert.match(source, /Blocked by earlier failed operation/);
  assert.match(source, /for \(let blocked = i \+ 1; blocked < operations\.length; blocked\+\+\)/);
  assert.match(source, /break;\n\s*}\n\s*}/);
});

test('renderer reports queued operation failures through the pending remote tab and counts final visible rows', function () {
  const source = readSource(APP_SOURCE_PATH);
  const syncWorkflowSource = readSource(SYNC_WORKFLOW_SOURCE_PATH);
  const syncWorkerSource = readSource(SYNC_WORKER_MANAGER_SOURCE_PATH);

  assert.match(syncWorkerSource, /queuedOperationFailures = applied\.failures/);
  assert.match(
    syncWorkflowSource,
    /const finalVisibleRows = await options\.api\.countVideos\(\{ collectionKey: collectionKey \}\)/
  );
  assert.match(syncWorkflowSource, /resultStatus\(collectionKey, mode, result, finishState, finalVisibleRows\)/);
  assert.match(syncWorkflowSource, /status\.syncQueuedOperationsSkipped/);
  assert.match(source, /await library\.refreshPendingGroups\(\)/);
  assert.match(source, /addPendingRemoteOperationGroup/);
  assert.match(source, /removePendingRemoteOperationGroup/);
  assert.match(source, /resolvePendingRemoteOperationGroup/);
});

test('sync queue and finalization phases surface renderer status updates', function () {
  const source = readSource(APP_SOURCE_PATH);
  const stylesSource = readSource(STYLES_SOURCE_PATH);
  const syncWorkflowSource = readSource(SYNC_WORKFLOW_SOURCE_PATH);
  const syncWorkerSource = readSource(SYNC_WORKER_MANAGER_SOURCE_PATH);

  assert.match(syncWorkerSource, /function notifySyncQueueProgress/);
  assert.match(syncWorkerSource, /'sync-queue-progress'/);
  assert.match(syncWorkerSource, /phase: 'start'/);
  assert.match(syncWorkerSource, /phase: i \+ 1 === operations\.length \? 'complete' : 'progress'/);
  assert.match(source, /message\.channel === 'sync-queue-progress'/);
  assert.match(syncWorkflowSource, /status\.syncQueueProgress/);
  assert.match(source, /class="app-toast-progress"/);
  assert.match(stylesSource, /max-height: 40px/);
  assert.match(stylesSource, /text-overflow: ellipsis/);
  assert.match(syncWorkflowSource, /status\.syncFinalizingLocalData/);
  assert.match(syncWorkflowSource, /status\.syncReturningLibrary/);
  assert.match(syncWorkflowSource, /waitForSyncReturningNotice/);
});

test('renderer surfaces ajax retry and fallback reasons', function () {
  const ipcNormalizersSource = readSource(IPC_NORMALIZERS_SOURCE_PATH);
  const syncWorkflowSource = readSource(SYNC_WORKFLOW_SOURCE_PATH);

  assert.match(
    ipcNormalizersSource,
    /ajaxFallbackReason: optionalStringField\(record, 'ajaxFallbackReason', channel\) \|\| null/
  );
  assert.match(ipcNormalizersSource, /ajaxRetryCount: optionalNumberField\(record, 'ajaxRetryCount', channel\) \|\| 0/);
  assert.match(syncWorkflowSource, /progress\.message === 'ajax-page-retry'/);
  assert.match(syncWorkflowSource, /status\.syncAjaxRetry/);
  assert.match(syncWorkflowSource, /progress\.message === 'ajax-prefetch-fallback'/);
  assert.match(syncWorkflowSource, /status\.syncAjaxFallback/);
  assert.match(syncWorkflowSource, /status\.syncAjaxFallbackResult/);
  assert.match(syncWorkflowSource, /status\.syncIncompleteAfterAjaxFallback/);
});

test('main process persists managed-root-relative download paths', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);

  assert.match(source, /function downloadOutputRelativePath/);
  assert.match(source, /function usedDownloadRelativePaths/);
  assert.match(source, /const candidateName = index === 1 \? name : name \+ ' \(' \+ index \+ '\)'/);
  assert.match(source, /const relativePath = candidateName \+ '\.mp4'/);
  assert.equal(source.includes("path.join(payload.collectionKey, candidateName + '.mp4')"), false);
  assert.match(source, /fs\.existsSync\(filePath\) \|\| fs\.existsSync\(filePath \+ '\.part'\)/);
  assert.equal(source.includes("createHash('sha1')"), false);
  assert.match(source, /function resolveManagedDownloadPath/);
  assert.match(source, /path\.isAbsolute\(fileRelativePath\)/);
  assert.match(source, /path\.resolve\(downloadRootPath, fileRelativePath\)/);
  assert.match(source, /isPathInsideDirectory\(filePath, downloadRootPath\)/);
  assert.match(source, /localPath: downloadOutputRelativePath\(payload\)/);
  assert.match(source, /shell\.openPath\(filePath\)/);
  assert.match(source, /shell\.showItemInFolder\(filePath\)/);
  assert.equal(source.includes('function downloadOutputPath'), false);
  assert.equal(source.includes('localPath: outputPath'), false);
});

test('main process validates the download root before queueing work', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);

  assert.match(source, /function ensureDownloadRootReady/);
  assert.match(source, /fs\.mkdirSync\(root\.path, \{ recursive: true \}\)/);
  assert.match(source, /fs\.statSync\(root\.path\)\.isDirectory\(\)/);
  assert.match(source, /fs\.accessSync\(root\.path, fs\.constants\.W_OK\)/);
  assert.match(
    source,
    /await ffmpegCommandForDownload\(\);\n\s+ensureDownloadRootReady\(\);\n\n\s+const record = upsertPersistedDownload/
  );
});

test('main process persists missing state discovered by open or reveal', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);

  assert.match(source, /function reconcileDownloadRecordFileState/);
  assert.match(source, /const next = downloadRecordWithFileState\(record\)/);
  assert.match(source, /notifyDownloadsChanged\(\);\n\s+return persisted/);
  assert.match(source, /const readyRecord = record \? reconcileDownloadRecordFileState\(record\) : null/);
});

test('main process accepts only canonical trusted Jable video URLs for downloads', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);

  assert.match(source, /function normalizeDownloadVideoUrl/);
  assert.match(source, /urlPolicy\.canonicalJableVideoUrl/);
  assert.match(source, /errors\.untrustedDownloadUrl/);
  assert.match(source, /url: normalizeDownloadVideoUrl\(video\.url, 'video\.url', channel\)/);
  assert.match(source, /normalizeDownloadVideoUrl\(value, 'videoUrl', 'download:retry'\)/);
  assert.match(source, /normalizeDownloadVideoUrl\(value, 'videoUrl', 'download:open-file'\)/);
});

test('local playback uses managed download records and browser-tab preload updates', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);
  const mainSource = readSource(MAIN_SOURCE_PATH);
  const preload = readSource(path.join(ROOT_DIR, 'app', 'preload.ts'));
  const types = readSource(TYPES_SOURCE_PATH);
  const ipcHandlersSource = readSource(IPC_HANDLERS_SOURCE_PATH);
  const webviewPreload = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const localPlaybackSource = readSource(WEBVIEW_LOCAL_PLAYBACK_SOURCE_PATH);
  const localPlaybackPreviewSource = readSource(LOCAL_PLAYBACK_PREVIEW_SOURCE_PATH);

  assert.match(mainSource, /registerSchemesAsPrivileged/);
  assert.match(mainSource, /installLocalPlaybackProtocol/);
  assert.match(mainSource, /localPlaybackProtocol\.handle\(LOCAL_PLAYBACK_SCHEME/);
  assert.match(source, /export const LOCAL_PLAYBACK_SCHEME = 'jable-local-video'/);
  assert.match(source, /function localPlaybackSource/);
  assert.match(source, /function handleLocalPlaybackRequest/);
  assert.match(source, /function localPlaybackReadyFile/);
  assert.match(source, /createLocalPlaybackPreviewController/);
  assert.match(source, /localPlaybackPreviewController\.readMetadata/);
  assert.match(localPlaybackPreviewSource, /function scheduleGeneration/);
  assert.match(localPlaybackPreviewSource, /function vttText/);
  assert.match(localPlaybackPreviewSource, /function imageFilePath/);
  assert.match(source, /parseLocalPlaybackRangeHeader/);
  assert.match(source, /resolveManagedDownloadPath\(readyRecord\.localPath\)/);
  assert.match(source, /sendToAllBrowserTabs\('downloads-changed', records\)/);
  assert.match(ipcHandlersSource, /ipcMain\.handle\('download:local-playback-source'/);
  assert.match(preload, /ipcRenderer\.invoke\('download:local-playback-source', videoUrl\)/);
  assert.match(types, /localPlaybackSource\(videoUrl: string\): Promise<LocalPlaybackSourceResult>/);
  assert.match(webviewPreload, /createLocalPlaybackController/);
  assert.match(webviewPreload, /localPlaybackController\.install\(\)/);
  assert.match(localPlaybackSource, /function installLocalPlaybackReplacement/);
  assert.match(localPlaybackSource, /ipcRenderer\.on\('downloads-changed'/);
  assert.match(localPlaybackSource, /data-jable-local-playback="true"/);
  assert.match(localPlaybackSource, /video\.setAttribute\('src', sourceUrl\)/);
  assert.match(localPlaybackSource, /function restoreLocalPlaybackTimeline/);
  assert.match(localPlaybackSource, /video\.currentTime = duration/);
  assert.match(localPlaybackSource, /function reloadAfterActiveLocalPlaybackRemoved/);
  assert.match(localPlaybackSource, /window\.location\.reload\(\)/);
});

test('browser theater mode uses preload IPC and tab-scoped state', function () {
  const mainSource = readSource(MAIN_SOURCE_PATH);
  const browserTabManagerSource = readSource(BROWSER_TAB_MANAGER_SOURCE_PATH);
  const contextMenuSource = readSource(CONTEXT_MENU_MANAGER_SOURCE_PATH);
  const ipcHandlersSource = readSource(IPC_HANDLERS_SOURCE_PATH);
  const webviewPreload = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const theaterModeSource = readSource(WEBVIEW_THEATER_MODE_SOURCE_PATH);
  const sessionSnapshotSource = browserTabManagerSource.slice(
    browserTabManagerSource.indexOf('function browserSessionSnapshot'),
    browserTabManagerSource.indexOf('export function createBrowserTabManager')
  );
  const forbiddenMethod = 'execute' + 'JavaScript';

  assert.equal(mainSource.includes('.' + forbiddenMethod + '('), false);
  assert.match(browserTabManagerSource, /theaterMode: boolean/);
  assert.match(browserTabManagerSource, /scheduleBrowserTheaterModeApply/);
  assert.match(browserTabManagerSource, /browser:apply-theater-mode/);
  assert.equal(sessionSnapshotSource.includes('theaterMode'), false);
  assert.match(contextMenuSource, /context\.theaterMode/);
  assert.match(
    contextMenuSource,
    /canonicalJableVideoUrl\(tab\.url\) \|\| canonicalJableVideoUrl\(contextParams\.pageURL/
  );
  assert.match(mainSource, /function setBrowserTabTheaterMode/);
  assert.match(mainSource, /browser:set-theater-mode-request/);
  assert.match(ipcHandlersSource, /browser:theater-mode-changed/);
  assert.match(webviewPreload, /createTheaterModeController/);
  assert.match(webviewPreload, /browser:set-theater-mode-request/);
  assert.match(webviewPreload, /browser:get-theater-mode-request/);
  assert.match(webviewPreload, /browser:apply-theater-mode/);
  assert.match(webviewPreload, /browser:leave-theater-mode/);
  assert.match(webviewPreload, /theaterModeController\.install\(\)/);
  assert.match(theaterModeSource, /function installTheaterModeController/);
  assert.match(theaterModeSource, /function theaterModeTargetForVideo/);
  assert.match(theaterModeSource, /THEATER_MODE_CONTROL_SELECTOR/);
  assert.match(theaterModeSource, /vjs-control-bar/);
  assert.match(theaterModeSource, /event\.key !== 'Escape'/);
  assert.match(theaterModeSource, /function toggleTheaterModeFromShortcut/);
  assert.match(theaterModeSource, /event\.key\.toLowerCase\(\) === 't'/);
  assert.match(theaterModeSource, /THEATER_MODE_EDITABLE_SHORTCUT_SELECTOR/);
  assert.match(theaterModeSource, /!event\.metaKey/);
  assert.match(webviewPreload, /sendTheaterModeChanged\(result\)/);
});

test('download records persist playback auto-resume block guard', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);
  const types = readSource(TYPES_SOURCE_PATH);
  const nativeDownloads = readSource(NATIVE_DOWNLOADS_SOURCE_PATH);
  const nativeSchema = readSource(NATIVE_SCHEMA_SOURCE_PATH);

  assert.match(types, /playbackAutoResumeBlocked: boolean/);
  assert.match(types, /export type DownloadSource = 'normal' \| 'playback_auto'/);
  assert.match(types, /downloadSource: DownloadSource/);
  assert.match(nativeSchema, /playback_auto_resume_blocked INTEGER NOT NULL DEFAULT 0/);
  assert.match(nativeSchema, /download_source TEXT NOT NULL DEFAULT 'normal'/);
  assert.match(nativeDownloads, /"playbackAutoResumeBlocked"/);
  assert.match(nativeDownloads, /"playback_auto_resume_blocked"/);
  assert.match(nativeDownloads, /"downloadSource"/);
  assert.match(nativeDownloads, /"download_source"/);
  assert.match(source, /function isPlaybackAutoResumeBlockedRecord/);
  assert.match(source, /function playbackAutoResumeBlockedAfterPause/);
  assert.match(source, /if \(isPlaybackAutoResumeBlockedRecord\(existingRecord\)\) return null/);
  assert.match(source, /if \(isPlaybackAutoResumeBlockedRecord\(record\)\) return false/);
  assert.match(source, /if \(isNormalDownloaderActive \|\| isNormalDownloaderQueued\) return true/);
  assert.match(source, /if \(isPlaybackCaptureOwned\) return false/);
  assert.match(source, /queuedItem\.source === 'normal'/);
  assert.match(source, /queuedItem\.source === 'playback_background'/);
  assert.match(source, /downloadSource: 'playback_auto'/);
  assert.match(source, /downloadSource: 'normal'/);
  assert.match(source, /playbackAutoResumeBlocked: false/);
  assert.match(source, /playbackAutoResumeBlocked: item\.source === 'normal' \? true/);
  assert.match(source, /playbackAutoResumeBlocked: runtime\.source === 'normal' \? true/);
});

test('HLS playback probe is debug-only and keeps HLS URLs out of logs', function () {
  const mainSource = readSource(MAIN_SOURCE_PATH);
  const downloadManagerSource = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);
  const hlsCaptureSource = readSource(HLS_CAPTURE_SOURCE_PATH);
  const hlsHelperSource = readSource(HLS_HELPERS_SOURCE_PATH);
  const hlsPlaybackSource = readSource(WEBVIEW_HLS_PLAYBACK_SOURCE_PATH);
  const hlsResearchSource = readSource(HLS_RESEARCH_SOURCE_PATH);
  const webviewPreload = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);

  assert.match(mainSource, /hlsPlaybackCapture\.installHlsPlaybackCapture/);
  assert.match(mainSource, /main-process\/hls-playback-capture/);
  assert.doesNotMatch(mainSource, /main-process\/hls-playback-research/);
  assert.match(mainSource, /jableSession: session\.fromPartition\(JABLE_SESSION_PARTITION\)/);
  assert.match(hlsResearchSource, /JABLE_HLS_PROBE/);
  assert.match(hlsResearchSource, /installHlsPlaybackResearch/);
  assert.match(hlsCaptureSource, /JABLE_HLS_PROXY/);
  assert.match(hlsCaptureSource, /JABLE_HLS_CAPTURE/);
  assert.match(hlsCaptureSource, /installHlsPlaybackCapture/);
  assert.match(hlsCaptureSource, /const HLS_PLAYLIST_PROXY_HOST = '127\.0\.0\.1'/);
  assert.match(hlsCaptureSource, /http\.createServer/);
  assert.match(hlsCaptureSource, /startHlsPlaylistProxyServer/);
  assert.match(hlsCaptureSource, /ipcMain\.handle\('hls:playlist-proxy-url'/);
  assert.match(hlsCaptureSource, /\[hls-proxy\] token/);
  assert.match(hlsCaptureSource, /\/playlist\/' \+ token \+ '\.m3u8'/);
  assert.match(hlsHelperSource, /function hlsPlaylistProxyRequestTargetFromUrl/);
  assert.equal(hlsHelperSource.includes('parsed.pathname.match(/^\\/playlist\\/([A-Za-z0-9_-]+)\\.m3u8$/)'), true);
  assert.match(hlsCaptureSource, /webRequest\.onBeforeSendHeaders/);
  assert.match(hlsCaptureSource, /webRequest\.onCompleted/);
  assert.equal(hlsCaptureSource.includes('webRequest.onBeforeRequest'), false);
  assert.match(hlsCaptureSource, /hlsProbePathHash/);
  assert.match(hlsCaptureSource, /hlsPlaylistProxyRewritePlaylist/);
  assert.match(hlsHelperSource, /function hlsPlaylistProxyRewritePlaylistContent/);
  assert.match(hlsCaptureSource, /hlsPlaylistProxyAssetUrl/);
  assert.match(hlsCaptureSource, /prepareHlsPlaybackCapture/);
  assert.match(hlsCaptureSource, /recordHlsPlaybackCaptureSegment/);
  assert.match(hlsCaptureSource, /hls:playback-started/);
  assert.match(hlsCaptureSource, /hlsPlaylistProxyPayloadMetadata/);
  assert.match(hlsCaptureSource, /hlsPlaylistProxyPayloadPageLoadId/);
  assert.match(hlsCaptureSource, /userInitiatedPlayback/);
  assert.match(hlsCaptureSource, /shouldProxyHlsPlaybackCapture/);
  assert.match(
    hlsCaptureSource,
    /function hlsPlaybackCaptureActivePageKey\(webContentsId: number, videoUrl: string, pageLoadId: string \| null\)/
  );
  assert.match(
    hlsCaptureSource,
    /hlsPlaybackCaptureActivePageKey\(entry\.webContentsId, entry\.videoUrl, entry\.pageLoadId\)/
  );
  assert.match(hlsCaptureSource, /hlsPlaybackCaptureActivePageKey\(event\.sender\.id, senderVideoUrl, pageLoadId\)/);
  assert.match(hlsCaptureSource, /class HlsPlaybackCaptureStoppedError/);
  assert.equal(hlsCaptureSource.includes("stopped ? '[hls-capture] segment stopped'"), true);
  assert.match(hlsCaptureSource, /hlsPlaybackCaptureActivePage/);
  assert.match(hlsCaptureSource, /shouldContinueHlsPlaybackCapture/);
  assert.match(hlsCaptureSource, /isAutoDownloadOnPlaybackEnabled/);
  assert.match(hlsCaptureSource, /startHlsPlaybackCapturePrefetch/);
  assert.match(hlsCaptureSource, /queueHlsPlaybackBackgroundCompletion/);
  assert.match(hlsCaptureSource, /runHlsPlaybackCapturePrefetchWithCompletion/);
  assert.match(hlsCaptureSource, /hlsPlaylistProxyCapturedAssetResponse/);
  assert.match(mainSource, /getAppSettings\(\)\.autoDownloadOnPlayback/);
  assert.match(mainSource, /queueHlsPlaybackBackgroundCompletion: function/);
  assert.match(hlsCaptureSource, /\[hls-capture\] prepared/);
  assert.match(hlsCaptureSource, /\[hls-capture\] segment saved/);
  assert.match(downloadManagerSource, /type DownloadQueueSource = 'normal' \| 'playback_background'/);
  assert.match(downloadManagerSource, /type HlsPlaybackBackgroundCompletionWorker/);
  assert.match(downloadManagerSource, /const downloadQueue: DownloadQueueItem\[\] = \[\]/);
  assert.match(downloadManagerSource, /prepareHlsPlaybackCapture/);
  assert.match(downloadManagerSource, /playbackCaptureUserInitiated/);
  assert.match(downloadManagerSource, /queueHlsPlaybackBackgroundCompletion/);
  assert.match(downloadManagerSource, /runQueuedPlaybackBackgroundDownload/);
  assert.match(downloadManagerSource, /recordHlsPlaybackCaptureSegment/);
  assert.match(downloadManagerSource, /completeHlsPlaybackCapture/);
  assert.match(downloadManagerSource, /hlsPlaybackCaptureRuntimeProgress/);
  assert.match(downloadManagerSource, /hlsPlaybackCaptureSuppressedPageLoadIds/);
  assert.match(downloadManagerSource, /upsertVideoMetadata/);
  assert.match(hlsCaptureSource, /\/asset\//);
  assert.match(hlsCaptureSource, /\[hls-proxy\] asset/);
  assert.match(hlsCaptureSource, /\[hls-proxy\] asset served/);
  assert.match(hlsCaptureSource, /hlsPlaylistProxyFallbackRedirect/);
  assert.match(hlsCaptureSource, /referer: entry\.origin \+ '\/'/);
  assert.match(hlsCaptureSource, /access-control-allow-credentials/);
  assert.match(hlsCaptureSource, /access-control-allow-private-network/);
  assert.match(hlsCaptureSource, /HLS_PLAYLIST_PROXY_FETCH_TIMEOUT_MS/);
  assert.match(hlsCaptureSource, /\[hls-proxy\] request error/);
  assert.match(hlsCaptureSource, /loopback HLS proxy/);
  assert.match(hlsCaptureSource, /playlist requests require Settings auto-download or debug env/);
  assert.match(hlsCaptureSource, /full HLS URLs are not logged/);
  assert.match(hlsCaptureSource, /getBrowserTabByWebContents\(webContents\)/);
  assert.match(webviewPreload, /createHlsPlaybackController/);
  assert.match(webviewPreload, /installPlaylistProxyInterception\(\)/);
  assert.match(webviewPreload, /installPlaybackStartedObserver\(\)/);
  assert.match(hlsPlaybackSource, /function installHlsPlaylistProxyInterception/);
  assert.match(hlsPlaybackSource, /invoke\('hls:playlist-proxy-url'/);
  assert.match(hlsPlaybackSource, /send\('hls:playback-started'/);
  assert.match(hlsPlaybackSource, /pageLoadId: pageLoadId/);
  assert.match(hlsPlaybackSource, /HLS_PLAYBACK_USER_GESTURE_TTL_MS/);
  assert.match(hlsPlaybackSource, /userInitiatedPlayback: userInitiatedPlayback/);
  assert.match(hlsPlaybackSource, /views: currentVideo \? currentVideo\.views : null/);
  assert.match(hlsPlaybackSource, /preview: currentVideo \? currentVideo\.preview : null/);
  assert.match(hlsPlaybackSource, /sourcePageChineseSubtitleNotice: sourcePageNotice\.sourcePageChineseSubtitleNotice/);
  assert.match(hlsPlaybackSource, /sourcePageSubtitleNoticeText: sourcePageNotice\.sourcePageSubtitleNoticeText/);
  assert.match(hlsPlaybackSource, /installHlsPlaybackStartedObserver/);
  assert.match(hlsPlaybackSource, /XMLHttpRequest\.prototype\.open/);
  assert.match(hlsPlaybackSource, /XMLHttpRequest\.prototype\.send/);
  assert.match(hlsPlaybackSource, /window\.fetch = function/);
  assert.match(hlsPlaybackSource, /window\.postMessage/);
  assert.match(hlsPlaybackSource, /title: document\.title/);
  assert.equal(hlsResearchSource.includes('[hls-probe] request'), true);
  for (const line of hlsCaptureSource.split('\n')) {
    if (line.indexOf('logger(context).info') === -1) continue;
    assert.equal(/,\s*details\.url/.test(line), false);
  }
});

test('browser video pages refresh known local metadata through dedicated IPC', function () {
  const dataEngineSource = readSource(path.join(ROOT_DIR, 'app', 'data', 'data-engine.ts'));
  const ipcHandlersSource = readSource(IPC_HANDLERS_SOURCE_PATH);
  const ipcNormalizersSource = readSource(IPC_NORMALIZERS_SOURCE_PATH);
  const webviewPreload = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const videoMetadataSource = readSource(WEBVIEW_VIDEO_METADATA_SOURCE_PATH);

  assert.match(dataEngineSource, /refreshVideoMetadata/);
  assert.match(ipcHandlersSource, /ipcMain\.handle\('db:refresh-video-metadata'/);
  assert.match(ipcNormalizersSource, /canonicalJableVideoUrl\(record\.url\)/);
  assert.match(webviewPreload, /createVideoMetadataController/);
  assert.match(webviewPreload, /videoMetadataController\.readCurrentVideoDetails/);
  assert.match(videoMetadataSource, /function installVideoMetadataRefresh/);
  assert.match(videoMetadataSource, /options\.ipcRenderer\.invoke\('db:refresh-video-metadata', video\)/);
});

test('main process forces MP4 muxing for partial download files', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);

  assert.match(source, /const tempPath = outputPath \+ '\.part'/);
  assert.match(source, /'-movflags',\n\s*'\+faststart',\n\s*'-f',\n\s*'mp4',\n\s*tempPath/);
});

test('main process streams FFmpeg download progress without persisting runtime fields', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);
  const types = readSource(path.join(ROOT_DIR, 'app', 'types', 'jable.ts'));

  assert.match(source, /const downloadRuntimeProgress = new Map<string, DownloadRuntimeProgress>\(\)/);
  assert.match(source, /'-progress',\n\s*'pipe:1'/);
  assert.match(source, /child\.stdout\?\.on\('data'/);
  assert.match(source, /downloadedBytes: runtimeProgress\.downloadedBytes/);
  assert.match(source, /downloadSpeedBytesPerSecond: runtimeProgress\.downloadSpeedBytesPerSecond/);
  assert.equal(source.includes('/^segment-\\d{6}\\.(aac|m4s|mp4|ts)$/'), true);
  assert.match(types, /downloadedBytes\?: number \| null/);
  assert.match(types, /downloadSpeedBytesPerSecond\?: number \| null/);
});

test('main process downloads HLS segments in bounded parallel batches', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);
  const mainSource = readSource(MAIN_SOURCE_PATH);
  const preload = readSource(path.join(ROOT_DIR, 'app', 'preload.ts'));
  const types = readSource(path.join(ROOT_DIR, 'app', 'types', 'jable.ts'));
  const ipcHandlersSource = readSource(IPC_HANDLERS_SOURCE_PATH);
  const nativeLoader = readSource(path.join(ROOT_DIR, 'app', 'download', 'native-download-engine.ts'));
  const buildScript = readSource(path.join(ROOT_DIR, 'scripts', 'build-rust-engine.js'));

  assert.match(source, /const DOWNLOAD_SPEED_MODE_SEGMENT_CONCURRENCY/);
  assert.match(source, /stable: \{ min: 4, max: 8 \}/);
  assert.match(source, /balanced: \{ min: 8, max: 32 \}/);
  assert.match(source, /fast: \{ min: 16, max: 32 \}/);
  assert.match(source, /const DOWNLOAD_SEGMENT_SAMPLE_COUNT = 3/);
  assert.match(source, /getDownloadEngine\(\)\.downloadHlsSegments/);
  assert.match(source, /const concurrency = currentDownloadSegmentConcurrency\(\)/);
  assert.match(source, /minConcurrency: concurrency\.min/);
  assert.match(source, /maxConcurrency: concurrency\.max/);
  assert.match(source, /sampleSegmentCount: DOWNLOAD_SEGMENT_SAMPLE_COUNT/);
  assert.match(source, /retryLimit: DOWNLOAD_SEGMENT_RETRY_LIMIT/);
  assert.match(source, /const activeDownloads = new Map<string, ActiveDownloadRuntime>\(\)/);
  assert.match(source, /const activeDownloadTasks = new Map<string, Promise<void>>\(\)/);
  assert.match(source, /while \(activeDownloads\.size < maxConcurrentDownloads\(\)\)/);
  assert.match(source, /function waitForActiveDownloadTasks\(\): Promise<void>/);
  assert.match(source, /pauseDownloadsForShutdown\(\): Promise<void>/);
  assert.match(source, /if \(runtime\.nativeId\) getDownloadEngine\(\)\.cancelDownload\(runtime\.nativeId\)/);
  assert.match(source, /const pausedDownloadUrls = new Set<string>\(\)/);
  assert.match(source, /const resumedDownloadUrls = new Set<string>\(\)/);
  assert.match(source, /state: 'paused'/);
  assert.match(source, /resumeManifestMatches\(outputPath, playlist\)/);
  assert.match(source, /downloadHlsSegmentsWithPlaylistRefresh/);
  assert.match(source, /resolveDownloadHlsSource\(\n\s*record\.videoUrl,\n\s*runtime\.abortController\.signal/);
  assert.match(source, /isSegmentRefreshCandidate\(error\)/);
  assert.match(source, /function shouldReuseDownloadSegmentTempDirectory/);
  assert.match(source, /function reusableSegmentFileCount/);
  assert.match(source, /function segmentResumeExtension/);
  assert.match(source, /version: 2/);
  assert.match(source, /extension: segmentResumeExtension\(segment\.url\)/);
  assert.match(source, /updateDownloadRuntimeProgress\(videoUrl, downloadSegmentDirectorySize\(tempDir\)\)/);
  assert.doesNotMatch(source, /stableMediaUrlIdentity/);
  assert.match(mainSource, /let downloadShutdownInProgress: Promise<void> \| null = null/);
  assert.match(mainSource, /function quitAfterDownloadsPaused\(\)/);
  assert.match(mainSource, /allowDownloadWindowClose = true/);
  assert.match(mainSource, /app\.on\('will-quit'/);
  assert.match(ipcHandlersSource, /ipcMain\.handle\('download:pause'/);
  assert.match(ipcHandlersSource, /ipcMain\.handle\('download:resume'/);
  assert.match(preload, /ipcRenderer\.invoke\('download:pause', videoUrl\)/);
  assert.match(preload, /ipcRenderer\.invoke\('download:resume', videoUrl\)/);
  assert.match(types, /pauseDownload\(videoUrl: string\): Promise<PauseDownloadResult>/);
  assert.match(types, /resumeDownload\(videoUrl: string\): Promise<EnqueueDownloadResult>/);
  assert.match(nativeLoader, /jable_download_engine\.' \+ process\.platform \+ '-' \+ process\.arch \+ '\.node'/);
  assert.match(buildScript, /libraryName: 'jable_download_engine'/);
});

test('preload and IPC expose bulk download list actions', function () {
  const preload = readSource(path.join(ROOT_DIR, 'app', 'preload.ts'));
  const types = readSource(path.join(ROOT_DIR, 'app', 'types', 'jable.ts'));
  const ipcHandlersSource = readSource(IPC_HANDLERS_SOURCE_PATH);

  assert.match(ipcHandlersSource, /ipcMain\.handle\('download:retry-failed'/);
  assert.match(ipcHandlersSource, /ipcMain\.handle\('download:pause-all'/);
  assert.match(ipcHandlersSource, /ipcMain\.handle\('download:resume-paused'/);
  assert.match(ipcHandlersSource, /ipcMain\.handle\('download:cancel-queued'/);
  assert.match(ipcHandlersSource, /ipcMain\.handle\('download:delete-many'/);
  assert.match(preload, /retryFailedDownloads/);
  assert.match(preload, /pauseAllDownloads/);
  assert.match(preload, /resumePausedDownloads/);
  assert.match(preload, /cancelQueuedDownloads/);
  assert.match(preload, /deleteDownloads/);
  assert.match(types, /retryFailedDownloads\(\): Promise<BulkDownloadActionResult>/);
  assert.match(types, /pauseAllDownloads\(\): Promise<BulkDownloadActionResult>/);
  assert.match(types, /resumePausedDownloads\(\): Promise<BulkDownloadActionResult>/);
  assert.match(types, /cancelQueuedDownloads\(\): Promise<BulkDownloadActionResult>/);
  assert.match(types, /deleteDownloads\(videoUrls: string\[\]\): Promise<DeleteDownloadsResult>/);
});

test('main process remuxes downloaded local HLS segments with FFmpeg', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);

  assert.match(source, /const localPlaylistPath = await downloadHlsSegmentsWithPlaylistRefresh/);
  assert.match(source, /await runFfmpegRemux\(command, localPlaylistPath, record\.videoUrl, outputPath, runtime\)/);
  assert.match(source, /'-allowed_extensions',\n\s*'ALL',\n\s*'-protocol_whitelist',\n\s*'file,crypto'/);
});

test('renderer sends cloneable plain download payloads', function () {
  const source = readSource(DOWNLOAD_WORKFLOW_SOURCE_PATH);
  const displaySource = readSource(DOWNLOAD_DISPLAY_SOURCE_PATH);

  assert.match(displaySource, /export function downloadRequestVideo\(video: VideoRow\)/);
  assert.match(source, /downloadRequestVideo as buildDownloadRequestVideo/);
  assert.match(source, /function downloadRequestVideo\(video: VideoRow\)/);
  assert.match(source, /video: downloadRequestVideo\(video\)/);
  assert.equal(source.includes('video: video'), false);
});
