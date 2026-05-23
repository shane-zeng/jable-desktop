'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..', '..');
const MAIN_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main.ts');
const APP_ACTIONS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'app-actions.ts');
const BROWSER_ORIGIN_CONTROLLER_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'main-process',
  'browser',
  'origin-controller.ts'
);
const BROWSER_RUNTIME_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'browser', 'runtime.ts');
const BROWSER_SHORTCUT_MANAGER_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'main-process',
  'browser',
  'shortcut-manager.ts'
);
const BROWSER_PRELOAD_REQUESTS_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'main-process',
  'browser',
  'preload-requests.ts'
);
const BROWSER_SESSION_CONTROLLER_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'main-process',
  'browser',
  'session-controller.ts'
);
const BROWSER_TAB_MANAGER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'browser', 'tab-manager.ts');
const CONTEXT_MENU_MANAGER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'context-menu-manager.ts');
const DOWNLOAD_APP_SHUTDOWN_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download-app-shutdown.ts');
const DOWNLOAD_MANAGER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download', 'manager.ts');
const IPC_HANDLERS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'ipc-handlers.ts');
const TYPES_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'types', 'jable.ts');
const HLS_CAPTURE_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback', 'capture.ts');
const HLS_CAPTURE_WRITES_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback', 'capture-writes.ts');
const HLS_HELPERS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback', 'helpers.ts');
const HLS_IPC_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback', 'ipc.ts');
const HLS_PROBE_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback', 'probe.ts');
const HLS_PROXY_HEADERS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback', 'proxy-headers.ts');
const HLS_PROXY_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback', 'proxy-server.ts');
const HLS_RESEARCH_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback', 'research.ts');
const HLS_SHARED_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'hls-playback', 'shared.ts');
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
const DOWNLOAD_ENVIRONMENT_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download', 'environment.ts');
const DOWNLOAD_SEGMENT_WORKSPACE_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'main-process',
  'download',
  'segment-workspace.ts'
);
const DOWNLOAD_REQUEST_BOUNDARY_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'main-process',
  'download',
  'request-boundary.ts'
);
const DOWNLOAD_PLAYBACK_CAPTURE_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'main-process',
  'download',
  'playback-capture.ts'
);
const DOWNLOAD_FFMPEG_REMUX_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download', 'ffmpeg-remux.ts');
const DOWNLOAD_HLS_SEGMENTS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download', 'hls-segments.ts');
const DOWNLOAD_FILE_ACTIONS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download', 'file-actions.ts');
const DOWNLOAD_QUEUE_ACTIONS_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download', 'queue-actions.ts');
const DOWNLOAD_RECORD_STATE_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download', 'record-state.ts');
const DOWNLOAD_ACTIVE_RUNNER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download', 'active-runner.ts');
const DOWNLOAD_RUNTIME_PROGRESS_SOURCE_PATH = path.join(
  ROOT_DIR,
  'app',
  'main-process',
  'download',
  'runtime-progress.ts'
);
const DOWNLOAD_SHUTDOWN_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'download', 'shutdown.ts');
const LOCAL_PLAYBACK_RANGE_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'local-playback', 'range.ts');
const LOCAL_PLAYBACK_SERVER_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'local-playback', 'server.ts');
const LOCAL_PLAYBACK_PREVIEW_SOURCE_PATH = path.join(ROOT_DIR, 'app', 'main-process', 'local-playback', 'preview.ts');
const REMOVED_MAIN_PROCESS_ADAPTER_PATHS = [
  'download-manager.ts',
  'hls-playback-capture.ts',
  'hls-playback-helpers.ts',
  'hls-playback-research.ts',
  'local-playback.ts',
  'local-playback-server.ts',
  'local-playback-preview.ts'
].map(function (fileName) {
  return path.join(ROOT_DIR, 'app', 'main-process', fileName);
});

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('main process uses preload IPC for browser page requests', function () {
  const source = readSource(MAIN_SOURCE_PATH);
  const appActionsSource = readSource(APP_ACTIONS_SOURCE_PATH);
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
  assert.match(ipcHandlersSource, /app:open-log-folder/);
  assert.match(ipcHandlersSource, /app:clear-browser-cache/);
  assert.match(ipcHandlersSource, /app:clear-diagnostics/);
  assert.match(ipcHandlersSource, /diagnostics:renderer-event/);
  assert.match(ipcHandlersSource, /diagnostics:webview-event/);
  assert.match(ipcHandlersSource, /app:open-ffmpeg-guide/);
  assert.match(ipcHandlersSource, /app:check-for-updates/);
  assert.match(ipcHandlersSource, /app:export-backup/);
  assert.match(ipcHandlersSource, /app:import-backup/);
  assert.match(preloadSource, /getSettings/);
  assert.match(preloadSource, /updateSettings/);
  assert.match(preloadSource, /openFfmpegGuide/);
  assert.match(preloadSource, /openLocalDataFolder/);
  assert.match(preloadSource, /openLogFolder/);
  assert.match(preloadSource, /clearBrowserCache/);
  assert.match(preloadSource, /clearDiagnostics/);
  assert.match(preloadSource, /reportRendererError/);
  assert.match(preloadSource, /checkForUpdates/);
  assert.match(preloadSource, /exportAppBackup/);
  assert.match(preloadSource, /importAppBackup/);
  assert.match(typesSource, /openFfmpegGuide\(\): Promise<OpenDocumentationResult>/);
  assert.match(typesSource, /openLogFolder\(\): Promise<OpenLocalDataFolderResult>/);
  assert.match(typesSource, /clearBrowserCache\(\): Promise<ClearBrowserCacheResult>/);
  assert.match(typesSource, /clearDiagnostics\(\): Promise<ClearDiagnosticsResult>/);
  assert.match(typesSource, /exportAppBackup\(payload: ExportAppBackupPayload\)/);
  assert.match(typesSource, /importAppBackup\(\): Promise<ImportAppBackupResult>/);
  assert.match(source, /README\.zh-TW\.md#/);
  assert.match(source, /README\.en-US\.md#download-list-and-ffmpeg/);
  assert.match(source, /README\.ja-JP\.md#/);
  assert.match(appActionsSource, /shell\.openExternal\(url\)/);
  assert.match(source, /main-process\/download\/manager/);
  assert.match(ipcHandlersSource, /from '\.\/download\/manager'/);
  assert.equal(ipcHandlersSource.includes("from './download-manager'"), false);
});

test('main process avoids legacy root playback and download adapters', function () {
  for (const filePath of REMOVED_MAIN_PROCESS_ADAPTER_PATHS) {
    assert.equal(fs.existsSync(filePath), false, path.relative(ROOT_DIR, filePath) + ' should not exist');
  }
});

test('main process delegates browser runtime and app side-effect boundaries', function () {
  const mainSource = readSource(MAIN_SOURCE_PATH);
  const appActionsSource = readSource(APP_ACTIONS_SOURCE_PATH);
  const browserOriginSource = readSource(BROWSER_ORIGIN_CONTROLLER_SOURCE_PATH);
  const browserRuntimeSource = readSource(BROWSER_RUNTIME_SOURCE_PATH);
  const browserPreloadRequestsSource = readSource(BROWSER_PRELOAD_REQUESTS_SOURCE_PATH);
  const browserSessionControllerSource = readSource(BROWSER_SESSION_CONTROLLER_SOURCE_PATH);
  const downloadAppShutdownSource = readSource(DOWNLOAD_APP_SHUTDOWN_SOURCE_PATH);

  assert.match(mainSource, /createBrowserRuntimeController/);
  assert.match(mainSource, /createAppActions/);
  assert.match(mainSource, /createDownloadAppShutdownController/);
  assert.match(mainSource, /createBrowserOriginController/);
  assert.doesNotMatch(mainSource, /browserPreloadRequests/);
  assert.doesNotMatch(mainSource, /browserSessionSaveTimer/);
  assert.doesNotMatch(mainSource, /downloadShutdownInProgress/);
  assert.match(browserRuntimeSource, /createBrowserTabManager/);
  assert.match(browserRuntimeSource, /createBrowserShortcutManager/);
  assert.match(browserRuntimeSource, /createBrowserSessionController/);
  assert.match(browserRuntimeSource, /createBrowserPreloadRequestManager/);
  assert.match(browserPreloadRequestsSource, /browser:preload-response/);
  assert.match(browserPreloadRequestsSource, /Timed out waiting for webview preload response/);
  assert.match(browserSessionControllerSource, /readForRestore/);
  assert.match(browserSessionControllerSource, /restoreBrowserTabsOnStartup/);
  assert.match(browserOriginSource, /jable-origin-fallback/);
  assert.match(browserOriginSource, /rewriteJableUrlOrigin/);
  assert.match(appActionsSource, /exportResourceToFile/);
  assert.match(appActionsSource, /openLocalDataFolder/);
  assert.match(downloadAppShutdownSource, /downloadShutdownInProgress/);
  assert.match(downloadAppShutdownSource, /pauseDownloadsForShutdown/);
  assert.match(mainSource, /requestSingleInstanceLock/);
  assert.match(mainSource, /second-instance/);
  assert.match(mainSource, /setAppUserModelId\(APP_USER_MODEL_ID\)/);
});

test('browser tab webContents receive the same app shortcut wiring', function () {
  const mainSource = readSource(MAIN_SOURCE_PATH);
  const browserRuntimeSource = readSource(BROWSER_RUNTIME_SOURCE_PATH);
  const browserShortcutManagerSource = readSource(BROWSER_SHORTCUT_MANAGER_SOURCE_PATH);
  const browserTabManagerSource = readSource(BROWSER_TAB_MANAGER_SOURCE_PATH);
  const appSource = readSource(APP_SOURCE_PATH);

  assert.match(mainSource, /registerAppShortcuts\(mainWindow\.webContents\)/);
  assert.match(browserRuntimeSource, /registerShortcuts: registerAppShortcuts/);
  assert.match(browserShortcutManagerSource, /webContents\.on\('before-input-event'/);
  assert.match(browserShortcutManagerSource, /browser-tabs-shared-toggle-shortcut/);
  assert.match(browserTabManagerSource, /registerShortcuts\(tab\.view\.webContents\)/);
  assert.match(appSource, /message\.channel === 'browser-tabs-shared-toggle-shortcut'/);
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
  assert.match(browserSyncSource, /reportSyncFailure\('sync-ajax-prefetch-fallback'/);
  assert.doesNotMatch(browserSyncSource, /ajax prefetch failed; falling back to sequential paging/);
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
  const queueActionsSource = readSource(DOWNLOAD_QUEUE_ACTIONS_SOURCE_PATH);
  const environmentSource = readSource(DOWNLOAD_ENVIRONMENT_SOURCE_PATH);
  const requestBoundarySource = readSource(DOWNLOAD_REQUEST_BOUNDARY_SOURCE_PATH);
  const fileActionsSource = readSource(DOWNLOAD_FILE_ACTIONS_SOURCE_PATH);

  assert.match(requestBoundarySource, /function downloadOutputRelativePath/);
  assert.match(requestBoundarySource, /function usedDownloadRelativePaths/);
  assert.match(requestBoundarySource, /function downloadCandidateBaseName/);
  assert.match(requestBoundarySource, /function fileRelativePathIsWindowsSafe/);
  assert.match(requestBoundarySource, /function sanitizeWindowsSafeFileName/);
  assert.match(requestBoundarySource, /const relativePath = candidateName \+ DOWNLOAD_FILE_EXTENSION/);
  assert.equal(requestBoundarySource.includes("path.join(payload.collectionKey, candidateName + '.mp4')"), false);
  assert.match(requestBoundarySource, /fs\.existsSync\(filePath\) \|\| fs\.existsSync\(filePath \+ '\.part'\)/);
  assert.equal(requestBoundarySource.includes("createHash('sha1')"), false);
  assert.match(requestBoundarySource, /function resolveManagedDownloadPath/);
  assert.match(requestBoundarySource, /path\.isAbsolute\(fileRelativePath\)/);
  assert.match(requestBoundarySource, /fileRelativePathIsWindowsSafe\(fileRelativePath\)/);
  assert.match(requestBoundarySource, /path\.resolve\(downloadRootPath, fileRelativePath\)/);
  assert.match(requestBoundarySource, /isPathInsideDirectory\(filePath, downloadRootPath\)/);
  assert.match(queueActionsSource, /localPath: options\.downloadOutputRelativePath\(payload\)/);
  assert.match(fileActionsSource, /options\.openShellPath\(filePath\)/);
  assert.match(fileActionsSource, /options\.revealShellPath\(filePath\)/);
  assert.match(environmentSource, /options\.shell\.openPath\(filePath\)/);
  assert.match(environmentSource, /options\.shell\.showItemInFolder\(filePath\)/);
  assert.equal(requestBoundarySource.includes('function downloadOutputPath'), false);
  assert.equal(source.includes('localPath: outputPath'), false);
});

test('main process validates the download root before queueing work', function () {
  const queueActionsSource = readSource(DOWNLOAD_QUEUE_ACTIONS_SOURCE_PATH);
  const environmentSource = readSource(DOWNLOAD_ENVIRONMENT_SOURCE_PATH);

  assert.match(environmentSource, /function ensureDownloadRootReady/);
  assert.match(environmentSource, /fs\.mkdirSync\(root\.path, \{ recursive: true \}\)/);
  assert.match(environmentSource, /fs\.statSync\(root\.path\)\.isDirectory\(\)/);
  assert.match(environmentSource, /fs\.accessSync\(root\.path, fs\.constants\.W_OK\)/);
  assert.match(
    queueActionsSource,
    /await options\.ffmpegCommandForDownload\(\);\n\s+options\.ensureDownloadRootReady\(\);\n\n\s+options\.upsertDownloadVideoMetadata/
  );
});

test('main process persists missing state discovered by open or reveal', function () {
  const recordStateSource = readSource(DOWNLOAD_RECORD_STATE_SOURCE_PATH);
  const fileActionsSource = readSource(DOWNLOAD_FILE_ACTIONS_SOURCE_PATH);

  assert.match(recordStateSource, /function reconcileDownloadRecordFileState/);
  assert.match(recordStateSource, /const next = recordWithFileState\(record\)/);
  assert.match(recordStateSource, /options\.notifyDownloadsChanged\(\);\n\s+return persisted/);
  assert.match(
    fileActionsSource,
    /const readyRecord = record \? options\.reconcileDownloadRecordFileState\(record\) : null/
  );
});

test('main process accepts only canonical trusted Jable video URLs for downloads', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);
  const requestBoundarySource = readSource(DOWNLOAD_REQUEST_BOUNDARY_SOURCE_PATH);
  const fileActionsSource = readSource(DOWNLOAD_FILE_ACTIONS_SOURCE_PATH);
  const queueActionsSource = readSource(DOWNLOAD_QUEUE_ACTIONS_SOURCE_PATH);

  assert.match(requestBoundarySource, /function normalizeDownloadVideoUrl/);
  assert.match(source, /canonicalVideoUrl: urlPolicy\.canonicalJableVideoUrl/);
  assert.match(requestBoundarySource, /errors\.untrustedDownloadUrl/);
  assert.match(requestBoundarySource, /url: normalizeDownloadVideoUrl\(video\.url, 'video\.url', channel\)/);
  assert.match(queueActionsSource, /normalizeDownloadVideoUrl\(value, 'videoUrl', 'download:retry'\)/);
  assert.match(fileActionsSource, /normalizeDownloadVideoUrl\(value, 'videoUrl', 'download:open-file'\)/);
});

test('local playback uses managed download records and browser-tab preload updates', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);
  const mainSource = readSource(MAIN_SOURCE_PATH);
  const preload = readSource(path.join(ROOT_DIR, 'app', 'preload.ts'));
  const types = readSource(TYPES_SOURCE_PATH);
  const ipcHandlersSource = readSource(IPC_HANDLERS_SOURCE_PATH);
  const webviewPreload = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const localPlaybackSource = readSource(WEBVIEW_LOCAL_PLAYBACK_SOURCE_PATH);
  const localPlaybackRangeSource = readSource(LOCAL_PLAYBACK_RANGE_SOURCE_PATH);
  const localPlaybackServerSource = readSource(LOCAL_PLAYBACK_SERVER_SOURCE_PATH);
  const localPlaybackPreviewSource = readSource(LOCAL_PLAYBACK_PREVIEW_SOURCE_PATH);

  assert.match(mainSource, /registerSchemesAsPrivileged/);
  assert.match(mainSource, /installLocalPlaybackProtocol/);
  assert.match(mainSource, /localPlaybackProtocol\.handle\(LOCAL_PLAYBACK_SCHEME/);
  assert.match(source, /export const LOCAL_PLAYBACK_SCHEME = 'jable-local-video'/);
  assert.match(source, /function localPlaybackSource/);
  assert.match(source, /function handleLocalPlaybackRequest/);
  assert.match(source, /function localPlaybackReadyFile/);
  assert.match(source, /createLocalPlaybackServer/);
  assert.match(source, /localPlaybackServer\.source\(value\)/);
  assert.match(source, /from '\.\.\/local-playback\/preview'/);
  assert.match(source, /from '\.\.\/local-playback\/server'/);
  assert.match(source, /from '\.\.\/local-playback\/range'/);
  assert.match(localPlaybackRangeSource, /export function parseLocalPlaybackRangeHeader/);
  assert.match(localPlaybackServerSource, /function source/);
  assert.match(localPlaybackServerSource, /function handleRequest/);
  assert.match(localPlaybackServerSource, /options\.previewController\.readMetadata/);
  assert.match(localPlaybackServerSource, /parseLocalPlaybackRangeHeader/);
  assert.match(source, /createLocalPlaybackPreviewController/);
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
  const browserRuntimeSource = readSource(BROWSER_RUNTIME_SOURCE_PATH);
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
  assert.match(browserRuntimeSource, /function setTabTheaterMode/);
  assert.match(browserRuntimeSource, /browser:set-theater-mode-request/);
  assert.match(ipcHandlersSource, /browser:theater-mode-changed/);
  assert.match(webviewPreload, /createTheaterModeController/);
  assert.match(webviewPreload, /browser:set-theater-mode-request/);
  assert.match(webviewPreload, /browser:get-theater-mode-request/);
  assert.match(webviewPreload, /browser:apply-theater-mode/);
  assert.match(webviewPreload, /browser:leave-theater-mode/);
  assert.match(webviewPreload, /theaterModeController\.install\(\)/);
  assert.match(theaterModeSource, /function installTheaterModeController/);
  assert.match(theaterModeSource, /function theaterModeTargetForVideo/);
  assert.match(theaterModeSource, /THEATER_MODE_EXIT_BUTTON_ID/);
  assert.match(theaterModeSource, /function ensureTheaterModeExitButton/);
  assert.match(theaterModeSource, /options\.sendChanged\(result\)/);
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
  const playbackCaptureSource = readSource(DOWNLOAD_PLAYBACK_CAPTURE_SOURCE_PATH);
  const queueActionsSource = readSource(DOWNLOAD_QUEUE_ACTIONS_SOURCE_PATH);
  const shutdownSource = readSource(DOWNLOAD_SHUTDOWN_SOURCE_PATH);
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
  assert.match(playbackCaptureSource, /function isPlaybackAutoResumeBlockedRecord/);
  assert.match(queueActionsSource, /function playbackAutoResumeBlockedAfterPause/);
  assert.match(playbackCaptureSource, /if \(isPlaybackAutoResumeBlockedRecord\(existingRecord\)\) return null/);
  assert.match(playbackCaptureSource, /if \(isPlaybackAutoResumeBlockedRecord\(record\)\) return false/);
  assert.match(queueActionsSource, /if \(isNormalDownloaderActive \|\| isNormalDownloaderQueued\) return true/);
  assert.match(queueActionsSource, /if \(isPlaybackCaptureOwned\) return false/);
  assert.match(queueActionsSource, /queuedItem\.source === 'normal'/);
  assert.match(queueActionsSource, /queuedItem\.source === 'playback_background'/);
  assert.match(playbackCaptureSource, /downloadSource: 'playback_auto'/);
  assert.match(queueActionsSource, /downloadSource: 'normal'/);
  assert.match(queueActionsSource, /playbackAutoResumeBlocked: false/);
  assert.match(shutdownSource, /item\.source === 'normal' \? true : record\.playbackAutoResumeBlocked/);
  assert.match(shutdownSource, /runtime\.source === 'normal' \? true : record\.playbackAutoResumeBlocked/);
});

test('HLS playback probe is debug-only and keeps HLS URLs out of logs', function () {
  const mainSource = readSource(MAIN_SOURCE_PATH);
  const downloadManagerSource = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);
  const activeRunnerSource = readSource(DOWNLOAD_ACTIVE_RUNNER_SOURCE_PATH);
  const playbackCaptureSource = readSource(DOWNLOAD_PLAYBACK_CAPTURE_SOURCE_PATH);
  const hlsCaptureSource = readSource(HLS_CAPTURE_SOURCE_PATH);
  const hlsCaptureWritesSource = readSource(HLS_CAPTURE_WRITES_SOURCE_PATH);
  const hlsHelperSource = readSource(HLS_HELPERS_SOURCE_PATH);
  const hlsIpcSource = readSource(HLS_IPC_SOURCE_PATH);
  const hlsProbeSource = readSource(HLS_PROBE_SOURCE_PATH);
  const hlsPlaybackSource = readSource(WEBVIEW_HLS_PLAYBACK_SOURCE_PATH);
  const hlsProxyHeadersSource = readSource(HLS_PROXY_HEADERS_SOURCE_PATH);
  const hlsProxySource = readSource(HLS_PROXY_SOURCE_PATH);
  const hlsResearchSource = readSource(HLS_RESEARCH_SOURCE_PATH);
  const hlsSharedSource = readSource(HLS_SHARED_SOURCE_PATH);
  const webviewPreload = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const hlsProductionSource = [
    hlsCaptureSource,
    hlsCaptureWritesSource,
    hlsIpcSource,
    hlsProbeSource,
    hlsProxyHeadersSource,
    hlsProxySource,
    hlsSharedSource
  ].join('\n');

  assert.match(mainSource, /hlsPlaybackCapture\.installHlsPlaybackCapture/);
  assert.match(mainSource, /main-process\/hls-playback\/capture/);
  assert.doesNotMatch(mainSource, /main-process\/hls-playback-capture/);
  assert.doesNotMatch(mainSource, /main-process\/hls-playback-research/);
  assert.match(mainSource, /jableSession: session\.fromPartition\(JABLE_SESSION_PARTITION\)/);
  assert.match(hlsSharedSource, /JABLE_HLS_PROBE/);
  assert.match(hlsResearchSource, /installHlsPlaybackResearch/);
  assert.match(hlsResearchSource, /installHlsPlaybackCapture\(context\)/);
  assert.match(hlsSharedSource, /JABLE_HLS_PROXY/);
  assert.match(hlsSharedSource, /JABLE_HLS_CAPTURE/);
  assert.match(hlsSharedSource, /JABLE_HLS_VERBOSE/);
  assert.match(hlsSharedSource, /hlsPlaybackDebugLog/);
  assert.match(hlsCaptureSource, /installHlsPlaybackCapture/);
  assert.match(hlsCaptureSource, /installHlsPlaybackProbe\(context\)/);
  assert.match(hlsCaptureSource, /installHlsPlaylistProxy\(context\)/);
  assert.match(hlsSharedSource, /const HLS_PLAYLIST_PROXY_HOST = '127\.0\.0\.1'/);
  assert.match(hlsProxySource, /http\.createServer/);
  assert.match(hlsProxySource, /startHlsPlaylistProxyServer/);
  assert.match(hlsProxySource, /hlsPlaylistProxyServerStartPromise/);
  assert.match(hlsProxySource, /ensureHlsPlaylistProxyServer/);
  assert.match(hlsIpcSource, /ensurePlaylistProxyServer\(context\)/);
  assert.match(hlsIpcSource, /ipcMain\.handle\('hls:playlist-proxy-url'/);
  assert.match(hlsIpcSource, /\[hls-proxy\] token/);
  assert.match(hlsIpcSource, /hlsPlaybackDebugLog\(\s*context,\s*'\[hls-proxy\] token'/);
  assert.match(hlsProxySource, /\/playlist\/' \+ token \+ '\.m3u8'/);
  assert.match(hlsHelperSource, /function hlsPlaylistProxyRequestTargetFromUrl/);
  assert.equal(hlsHelperSource.includes('parsed.pathname.match(/^\\/playlist\\/([A-Za-z0-9_-]+)\\.m3u8$/)'), true);
  assert.match(hlsProbeSource, /webRequest\.onBeforeSendHeaders/);
  assert.match(hlsProbeSource, /webRequest\.onCompleted/);
  assert.equal(hlsProductionSource.includes('webRequest.onBeforeRequest'), false);
  assert.match(hlsProbeSource, /hlsProbePathHash/);
  assert.match(hlsProxySource, /hlsPlaylistProxyRewritePlaylist/);
  assert.match(hlsHelperSource, /function hlsPlaylistProxyRewritePlaylistContent/);
  assert.match(hlsProxySource, /hlsPlaylistProxyAssetUrl/);
  assert.match(hlsProxySource, /prepareHlsPlaybackCapture/);
  assert.match(hlsCaptureWritesSource, /recordHlsPlaybackCaptureSegment/);
  assert.match(hlsIpcSource, /hls:playback-started/);
  assert.match(hlsIpcSource, /hlsPlaylistProxyPayloadMetadata/);
  assert.match(hlsIpcSource, /hlsPlaylistProxyPayloadPageLoadId/);
  assert.match(hlsIpcSource, /userInitiatedPlayback/);
  assert.match(hlsIpcSource, /shouldProxyHlsPlaybackCapture/);
  assert.match(
    hlsProxySource,
    /function hlsPlaybackCaptureActivePageKey\(webContentsId: number, videoUrl: string, pageLoadId: string \| null\)/
  );
  assert.match(
    hlsProxySource,
    /hlsPlaybackCaptureActivePageKey\(entry\.webContentsId, entry\.videoUrl, entry\.pageLoadId\)/
  );
  assert.match(hlsIpcSource, /state\.activePageKey\(event\.sender\.id, senderVideoUrl, pageLoadId\)/);
  assert.match(hlsCaptureWritesSource, /class HlsPlaybackCaptureStoppedError/);
  assert.equal(hlsCaptureWritesSource.includes("stopped ? '[hls-capture] segment stopped'"), true);
  assert.match(hlsProxySource, /hlsPlaybackCaptureActivePage/);
  assert.match(hlsCaptureWritesSource, /shouldContinueHlsPlaybackCapture/);
  assert.match(hlsSharedSource, /isAutoDownloadOnPlaybackEnabled/);
  assert.match(hlsProxySource, /startHlsPlaybackCapturePrefetch/);
  assert.match(hlsCaptureWritesSource, /queueHlsPlaybackBackgroundCompletion/);
  assert.match(hlsCaptureWritesSource, /runHlsPlaybackCapturePrefetchWithCompletion/);
  assert.match(hlsProxySource, /hlsPlaylistProxyCapturedAssetResponse/);
  assert.match(mainSource, /getAppSettings\(\)\.autoDownloadOnPlayback/);
  assert.match(mainSource, /queueHlsPlaybackBackgroundCompletion: function/);
  assert.match(hlsProxySource, /\[hls-capture\] prepared/);
  assert.match(hlsProxySource, /hlsPlaybackDebugLog\(\s*context,\s*'\[hls-capture\] prepared'/);
  assert.match(hlsCaptureWritesSource, /\[hls-capture\] segment saved/);
  assert.match(hlsCaptureWritesSource, /hlsPlaybackDebugLog\(\s*context,\s*'\[hls-capture\] segment saved'/);
  assert.match(activeRunnerSource, /type DownloadQueueSource = 'normal' \| 'playback_background'/);
  assert.match(playbackCaptureSource, /type HlsPlaybackBackgroundCompletionWorker/);
  assert.match(downloadManagerSource, /const downloadQueue: DownloadQueueItem\[\] = \[\]/);
  assert.match(downloadManagerSource, /prepareHlsPlaybackCapture/);
  assert.match(playbackCaptureSource, /playbackCaptureUserInitiated/);
  assert.match(downloadManagerSource, /queueHlsPlaybackBackgroundCompletion/);
  assert.match(downloadManagerSource, /runQueuedPlaybackBackgroundDownload/);
  assert.match(downloadManagerSource, /recordHlsPlaybackCaptureSegment/);
  assert.match(downloadManagerSource, /completeHlsPlaybackCapture/);
  assert.match(playbackCaptureSource, /runtimeProgress/);
  assert.match(playbackCaptureSource, /suppressedPageLoadIds/);
  assert.match(downloadManagerSource, /upsertVideoMetadata/);
  assert.match(hlsProxySource, /\/asset\//);
  assert.match(hlsProxySource, /\[hls-proxy\] asset/);
  assert.match(hlsProxySource, /hlsPlaybackDebugLog\(\s*context,\s*'\[hls-proxy\] asset'/);
  assert.match(hlsProxySource, /\[hls-proxy\] asset served/);
  assert.match(hlsProxySource, /hlsPlaybackDebugLog\(\s*context,\s*'\[hls-proxy\] asset served'/);
  assert.match(hlsProxySource, /hlsPlaylistProxyFallbackRedirect/);
  assert.match(hlsProxyHeadersSource, /referer: entry\.origin \+ '\/'/);
  assert.match(hlsProxyHeadersSource, /webContents\.getUserAgent\(\)/);
  assert.match(hlsProxySource, /hlsPlaylistProxyUserAgent\(context, entry\)/);
  assert.match(hlsCaptureWritesSource, /hlsPlaylistProxyUserAgent\(context, entry\)/);
  assert.match(hlsProxyHeadersSource, /access-control-allow-credentials/);
  assert.match(hlsProxyHeadersSource, /access-control-allow-private-network/);
  assert.match(hlsSharedSource, /HLS_PLAYLIST_PROXY_FETCH_TIMEOUT_MS/);
  assert.match(hlsProxySource, /\[hls-proxy\] request error/);
  assert.match(hlsProxySource, /loopback HLS proxy/);
  assert.match(hlsProxySource, /playlist requests require Settings auto-download or debug env/);
  assert.match(hlsProbeSource, /full HLS URLs are not logged/);
  assert.match(hlsProbeSource, /getBrowserTabByWebContents\(webContents\)/);
  assert.match(hlsIpcSource, /getBrowserTabByWebContents\(event\.sender\)/);
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
  assert.equal(hlsProbeSource.includes('[hls-probe] request'), true);
  for (const line of hlsProductionSource.split('\n')) {
    if (line.indexOf('logger(context).info') === -1 && line.indexOf('hlsPlaybackDebugLog') === -1) continue;
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
  const ffmpegRemuxSource = readSource(DOWNLOAD_FFMPEG_REMUX_SOURCE_PATH);

  assert.match(ffmpegRemuxSource, /const tempPath = outputPath \+ '\.part'/);
  assert.match(ffmpegRemuxSource, /'-movflags',\n\s*'\+faststart',\n\s*'-f',\n\s*'mp4',\n\s*tempPath/);
});

test('main process streams FFmpeg download progress without persisting runtime fields', function () {
  const recordStateSource = readSource(DOWNLOAD_RECORD_STATE_SOURCE_PATH);
  const runtimeProgressSource = readSource(DOWNLOAD_RUNTIME_PROGRESS_SOURCE_PATH);
  const ffmpegRemuxSource = readSource(DOWNLOAD_FFMPEG_REMUX_SOURCE_PATH);
  const segmentWorkspaceSource = readSource(DOWNLOAD_SEGMENT_WORKSPACE_SOURCE_PATH);
  const types = readSource(path.join(ROOT_DIR, 'app', 'types', 'jable.ts'));

  assert.match(runtimeProgressSource, /const progressByVideoUrl = new Map<string, DownloadRuntimeProgressState>\(\)/);
  assert.match(ffmpegRemuxSource, /'-progress',\n\s*'pipe:1'/);
  assert.match(ffmpegRemuxSource, /child\.stdout\?\.on\('data'/);
  assert.match(recordStateSource, /downloadedBytes: runtimeProgress\.downloadedBytes/);
  assert.match(recordStateSource, /downloadSpeedBytesPerSecond: runtimeProgress\.downloadSpeedBytesPerSecond/);
  assert.equal(segmentWorkspaceSource.includes('/^segment-\\d{6}\\.(aac|m4s|mp4|ts)$/'), true);
  assert.match(types, /downloadedBytes\?: number \| null/);
  assert.match(types, /downloadSpeedBytesPerSecond\?: number \| null/);
});

test('main process downloads HLS segments in bounded parallel batches', function () {
  const source = readSource(DOWNLOAD_MANAGER_SOURCE_PATH);
  const activeRunnerSource = readSource(DOWNLOAD_ACTIVE_RUNNER_SOURCE_PATH);
  const shutdownSource = readSource(DOWNLOAD_SHUTDOWN_SOURCE_PATH);
  const hlsSegmentsSource = readSource(DOWNLOAD_HLS_SEGMENTS_SOURCE_PATH);
  const segmentWorkspaceSource = readSource(DOWNLOAD_SEGMENT_WORKSPACE_SOURCE_PATH);
  const mainSource = readSource(MAIN_SOURCE_PATH);
  const downloadAppShutdownSource = readSource(DOWNLOAD_APP_SHUTDOWN_SOURCE_PATH);
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
  assert.match(hlsSegmentsSource, /options\.getDownloadEngine\(\)\.downloadHlsSegments/);
  assert.match(hlsSegmentsSource, /const concurrency = options\.currentDownloadSegmentConcurrency\(\)/);
  assert.match(hlsSegmentsSource, /minConcurrency: concurrency\.min/);
  assert.match(hlsSegmentsSource, /maxConcurrency: concurrency\.max/);
  assert.match(hlsSegmentsSource, /sampleSegmentCount: options\.sampleSegmentCount/);
  assert.match(hlsSegmentsSource, /retryLimit: options\.retryLimit/);
  assert.match(source, /const activeDownloads = new Map<string, ActiveDownloadRuntime>\(\)/);
  assert.match(source, /const activeDownloadTasks = new Map<string, Promise<void>>\(\)/);
  assert.match(source, /while \(activeDownloads\.size < maxConcurrentDownloads\(\)\)/);
  assert.match(shutdownSource, /function waitForActiveDownloadTasks\(\): Promise<void>/);
  assert.match(source, /pauseDownloadsForShutdown\(\): Promise<void>/);
  assert.match(shutdownSource, /if \(runtime\.nativeId\) options\.cancelNativeDownloadIfLoaded\(runtime\.nativeId\)/);
  assert.match(source, /const pausedDownloadUrls = new Set<string>\(\)/);
  assert.match(source, /const resumedDownloadUrls = new Set<string>\(\)/);
  assert.match(shutdownSource, /state: 'paused'/);
  assert.match(hlsSegmentsSource, /resumeManifestMatches\(outputPath, playlist\)/);
  assert.match(source, /downloadHlsSegmentsWithPlaylistRefresh/);
  assert.match(
    activeRunnerSource,
    /resolveDownloadHlsSource\(\n\s*record\.videoUrl,\n\s*runtime\.abortController\.signal/
  );
  assert.match(hlsSegmentsSource, /isSegmentRefreshCandidate\(error\)/);
  assert.match(segmentWorkspaceSource, /function shouldReuseDownloadSegmentTempDirectory/);
  assert.match(segmentWorkspaceSource, /function reusableSegmentFileCount/);
  assert.match(segmentWorkspaceSource, /function segmentResumeExtension/);
  assert.match(segmentWorkspaceSource, /version: 2/);
  assert.match(segmentWorkspaceSource, /extension: segmentResumeExtension\(segment\.url\)/);
  assert.match(hlsSegmentsSource, /updateDownloadRuntimeProgress\(videoUrl, downloadSegmentDirectorySize\(tempDir\)\)/);
  assert.doesNotMatch(source, /stableMediaUrlIdentity/);
  assert.match(downloadAppShutdownSource, /let downloadShutdownInProgress: Promise<void> \| null = null/);
  assert.match(downloadAppShutdownSource, /function quitAfterDownloadsPaused\(\)/);
  assert.match(downloadAppShutdownSource, /allowDownloadWindowClose = true/);
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
  const activeRunnerSource = readSource(DOWNLOAD_ACTIVE_RUNNER_SOURCE_PATH);
  const ffmpegRemuxSource = readSource(DOWNLOAD_FFMPEG_REMUX_SOURCE_PATH);

  assert.match(activeRunnerSource, /const localPlaylistPath = await options\.downloadHlsSegmentsWithPlaylistRefresh/);
  assert.match(
    activeRunnerSource,
    /await runFfmpegRemux\(command, localPlaylistPath, record\.videoUrl, outputPath, runtime,/
  );
  assert.match(ffmpegRemuxSource, /'-allowed_extensions',\n\s*'ALL',\n\s*'-protocol_whitelist',\n\s*'file,crypto'/);
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
