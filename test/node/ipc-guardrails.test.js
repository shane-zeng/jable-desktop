'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..', '..');
const MAIN_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main.ts');
const DOWNLOAD_MANAGER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download-manager.ts');
const IPC_HANDLERS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'ipc-handlers.ts');
const SYNC_WORKER_MANAGER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'sync-worker-manager.ts');
const APP_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'renderer-src', 'App.vue');
const IPC_NORMALIZERS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'ipc-normalizers.ts');
const SYNC_WORKFLOW_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'renderer-src', 'composables', 'useSyncWorkflow.ts');
const WEBVIEW_PRELOAD_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'webview-preload.ts');
const WEBVIEW_HELPERS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'browser', 'webview-preload-helpers.ts');

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('main process uses preload IPC for browser page requests', function () {
  const source = readSource(MAIN_SOURCE_PATH);
  const ipcHandlersSource = readSource(IPC_HANDLERS_SOURCE_PATH);
  const syncWorkerSource = readSource(SYNC_WORKER_MANAGER_SOURCE_PATH);
  const preloadSource = readSource(path.join(__dirname, '..', '..', 'app', 'preload.ts'));
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
  assert.match(ipcHandlersSource, /app:check-for-updates/);
  assert.match(preloadSource, /getSettings/);
  assert.match(preloadSource, /updateSettings/);
  assert.match(preloadSource, /openLocalDataFolder/);
  assert.match(preloadSource, /checkForUpdates/);
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
  const helperSource = readSource(WEBVIEW_HELPERS_SOURCE_PATH);

  assert.match(helperSource, /function ajaxUrlForPagerLink/);
  assert.match(helperSource, /url\.searchParams\.set\('mode', 'async'\)/);
  assert.match(helperSource, /url\.searchParams\.set\('function', 'get_block'\)/);
  assert.match(source, /function loadPagerLinkByFetch/);
  assert.match(source, /new DOMParser\(\)\.parseFromString\(html, 'text\/html'\)/);
  assert.match(source, /function pagerPageParameter/);
  assert.match(source, /pageNumber = normalizePageNumber\(pageParameter\.value\)/);
  assert.equal(source.includes('Math.floor(parseInt(match[1], 10) / SITE_PAGE_SIZE) + 1'), false);
});

test('full sync can use a bounded ajax sliding window with sequential fallback', function () {
  const source = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
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
  const source = readSource(SYNC_WORKER_MANAGER_SOURCE_PATH);
  const ipcHandlersSource = readSource(IPC_HANDLERS_SOURCE_PATH);

  assert.match(source, /function shouldApplyDeferredSyncOperations/);
  assert.match(source, /result\.incompleteReason === 'login-required'/);
  assert.match(source, /result\.incompleteReason === 'batch-limit'/);
  assert.match(source, /getAutoReplayDeferredSyncOperations\(\)/);
  assert.match(ipcHandlersSource, /normalizedPayload\.deferLocal = true/);
  assert.match(source, /resultWithWorker\.queuedOperationsSkipped = skipped/);
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
  const syncWorkflowSource = readSource(SYNC_WORKFLOW_SOURCE_PATH);
  const syncWorkerSource = readSource(SYNC_WORKER_MANAGER_SOURCE_PATH);

  assert.match(syncWorkerSource, /function notifySyncQueueProgress/);
  assert.match(syncWorkerSource, /'sync-queue-progress'/);
  assert.match(syncWorkerSource, /phase: 'start'/);
  assert.match(syncWorkerSource, /phase: i \+ 1 === operations\.length \? 'complete' : 'progress'/);
  assert.match(source, /message\.channel === 'sync-queue-progress'/);
  assert.match(syncWorkflowSource, /status\.syncQueueProgress/);
  assert.match(source, /class="app-toast-progress"/);
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
  assert.match(syncWorkflowSource, /progress\.message === 'ajax-window-fallback'/);
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
  assert.match(source, /resolveDownloadHlsSource\(videoUrl, signal\)/);
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
  const source = readSource(APP_SOURCE_PATH);

  assert.match(source, /function downloadRequestVideo\(video: VideoRow\)/);
  assert.match(source, /video: downloadRequestVideo\(video\)/);
  assert.equal(source.includes('video: video'), false);
});
