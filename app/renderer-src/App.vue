<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import BrowserPanel from './components/BrowserPanel.vue';
import LibraryPanel from './components/LibraryPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import TopBar from './components/TopBar.vue';
import {
  BROWSER_TABS_DEFAULT_WIDTH,
  BROWSER_TABS_COMPACT_STORAGE_KEY,
  BROWSER_TABS_MAX_WIDTH,
  BROWSER_TABS_MIN_WIDTH,
  BROWSER_TABS_WIDTH_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  DEFAULT_BROWSER_URL
} from './constants';
import { useBrowserBounds } from './composables/useBrowserBounds';
import { useJableApi } from './composables/useJableApi';
import { useLibraryState } from './composables/useLibraryState';
import { usePendingRemoteActions } from './composables/usePendingRemoteActions';
import { useSyncWorkflow } from './composables/useSyncWorkflow';
import { errorMessage, useToastStatus } from './composables/useToastStatus';
import { useI18n } from './i18n';
import type {
  AppSettings,
  AppSettingsPatch,
  AppInfo,
  AppView,
  BrowserMessage,
  BrowserNavigationState,
  BrowserTabMenuPayload,
  BrowserTabsState,
  CollectionKey,
  CollectionToggleResult,
  DownloadRecord,
  DownloadRequestPayload,
  DownloadRootInfo,
  DownloadState,
  DownloadStateFilters,
  ExportResource,
  FfmpegStatus,
  LibraryVideoMenuAction,
  LibraryVideoMenuPayload,
  SyncPagePayload,
  SyncProgressPayload,
  SyncQueueProgressPayload,
  VideoRow
} from '../types/jable';

const api = useJableApi();
const i18n = useI18n();
const activeView = ref<AppView>('browser');
const toastStatus = useToastStatus();
const toast = toastStatus.toast;
const setStatus = toastStatus.setStatus;
const hideToast = toastStatus.hideToast;
const busy = ref(false);
const browserTabsCompact = ref(false);
const browserTabsWidth = ref(BROWSER_TABS_DEFAULT_WIDTH);
const appInfo = ref<AppInfo | null>(null);
const appSettings = ref<AppSettings>(
  Object.assign({}, DEFAULT_APP_SETTINGS, {
    downloadStateFilters: DEFAULT_APP_SETTINGS.downloadStateFilters.slice()
  })
);
const ffmpegStatus = ref<FfmpegStatus | null>(null);
const downloadRoot = ref<DownloadRootInfo | null>(null);
const selectedDownloadUrls = ref<string[]>([]);
const showDownloadErrorLog = ref(false);
const browser = useBrowserBounds(api, activeView);
const library = useLibraryState(api);
let mainLocaleSynced = false;
let downloadNotificationStates = new Map<string, DownloadState>();
const suppressedDownloadFailureUrls = new Set<string>();
const sync = useSyncWorkflow({
  api: api,
  busy: busy,
  errorMessage: errorMessage,
  library: library,
  setActiveView: setActiveView,
  setStatus: setStatus,
  t: i18n.t
});
const syncing = sync.syncing;
const syncQueueProgress = sync.syncQueueProgress;
const syncQueueProgressProcessed = sync.syncQueueProgressProcessed;
const syncQueueProgressPercent = sync.syncQueueProgressPercent;
const { addPendingRemoteOperationGroup, removePendingRemoteOperationGroup, resolvePendingRemoteOperationGroup } =
  usePendingRemoteActions({
    api: api,
    busy: busy,
    errorMessage: errorMessage,
    library: library,
    setStatus: setStatus,
    t: i18n.t
  });

const pageRows = computed<VideoRow[]>(function () {
  return library.pageRows.value;
});

const downloadErrorLogRecords = computed<DownloadRecord[]>(function () {
  return library.downloadRecords.value.filter(function (record) {
    return record.state === 'failed' || record.state === 'missing';
  });
});

const libraryBusy = computed(function () {
  return busy.value || syncing.value;
});

function loadLegacyBrowserTabsCompact() {
  const value = localStorage.getItem(BROWSER_TABS_COMPACT_STORAGE_KEY);
  if (value !== null) return value === 'true';

  const collapsed = localStorage.getItem('jable-desktop:browser-tabs-collapsed');
  return collapsed === null ? null : collapsed === 'true';
}

function clearLegacyBrowserTabsCompact() {
  localStorage.removeItem(BROWSER_TABS_COMPACT_STORAGE_KEY);
  localStorage.removeItem('jable-desktop:browser-tabs-collapsed');
}

async function setBrowserTabsCompact(value: boolean) {
  browserTabsCompact.value = Boolean(value);
  browser.scheduleResize();
  try {
    applyAppSettings(await api.updateSettings({ compactBrowserTabs: browserTabsCompact.value }));
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.settingsSaveFailed', { error: errorMessage(error) }), 'error');
  }
}

function clampBrowserTabsWidth(value: unknown) {
  const width = Number(value) || BROWSER_TABS_DEFAULT_WIDTH;
  return Math.max(BROWSER_TABS_MIN_WIDTH, Math.min(BROWSER_TABS_MAX_WIDTH, Math.round(width)));
}

function loadBrowserTabsWidth() {
  return clampBrowserTabsWidth(localStorage.getItem(BROWSER_TABS_WIDTH_STORAGE_KEY));
}

function setBrowserTabsWidth(value: number) {
  browserTabsWidth.value = clampBrowserTabsWidth(value);
  localStorage.setItem(BROWSER_TABS_WIDTH_STORAGE_KEY, String(browserTabsWidth.value));
  browser.scheduleResize();
}

function setActiveView(view: AppView) {
  activeView.value = view;
  if (view !== 'browser') browser.hide();
  browser.scheduleResize();
  if (view === 'library') library.refreshVideos();
}

function collectionName(collectionKey: CollectionKey) {
  return i18n.t('collections.' + collectionKey);
}

async function openInBrowser(url: string) {
  if (!url || busy.value) return;

  try {
    setActiveView('browser');
    await browser.loadBrowser(url, false);
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.browserOpenFailed', { error: errorMessage(error) }), 'error');
  }
}

async function openInNewBrowserTab(url: string) {
  if (!url || busy.value) return;

  try {
    setActiveView('browser');
    await browser.createTab(url, { active: true });
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.browserOpenNewTabFailed', { error: errorMessage(error) }), 'error');
  }
}

function handleLibraryVideoMenuAction(payload: LibraryVideoMenuAction | null | undefined) {
  if (!payload) return;
  if (payload.action === 'open-current') {
    openInBrowser(payload.url);
  } else if (payload.action === 'open-new') {
    openInNewBrowserTab(payload.url);
  }
}

function collectionToggleStatus(payload: CollectionToggleResult) {
  const name = collectionName(payload.collectionKey);

  if (payload.queued) {
    if (!appSettings.value.autoReplayDeferredSyncOperations) {
      return payload.action === 'remove'
        ? i18n.t('status.collectionRemoveQueuedManual', { collection: name })
        : i18n.t('status.collectionAddQueuedManual', { collection: name });
    }

    return payload.action === 'remove'
      ? i18n.t('status.collectionRemoveQueued', { collection: name })
      : i18n.t('status.collectionAddQueued', { collection: name });
  }

  if (payload.action === 'remove') {
    return payload.changed
      ? i18n.t('status.collectionRemoved', { collection: name })
      : i18n.t('status.collectionRemoveNoop', { collection: name });
  }

  return i18n.t('status.collectionAdded', { collection: name });
}

function handleBrowserMessage(message: BrowserMessage) {
  if (message.channel === 'browser-tabs-changed') {
    browser.applyTabsState(message.args[0] as BrowserTabsState);
  }

  if (message.channel === 'settings-changed') {
    applyAppSettings(message.args[0] as AppSettings);
  }

  if (message.channel === 'browser-error') {
    const errorPayload = (message.args[0] || {}) as { message?: string };
    setStatus(
      i18n.t('status.browserTabError', { error: errorPayload.message || i18n.t('status.unknownError') }),
      'error'
    );
  }

  if (message.channel === 'library-video-menu-action') {
    handleLibraryVideoMenuAction(message.args[0] as LibraryVideoMenuAction);
  }

  if (message.channel === 'sync-page') {
    const payload = message.args[0] as SyncPagePayload;
    sync.handleSyncPage(payload);
  }

  if (message.channel === 'sync-progress') {
    const progress = message.args[0] as SyncProgressPayload;
    sync.handleSyncProgress(progress);
  }

  if (message.channel === 'sync-queue-progress') {
    const progress = message.args[0] as SyncQueueProgressPayload;
    sync.handleSyncQueueProgress(progress);
  }

  if (message.channel === 'collection-toggle') {
    const togglePayload = message.args[0] as CollectionToggleResult;
    if (togglePayload.collectionKey === library.activeCollection.value) {
      if (togglePayload.action === 'add') library.currentPage.value = 1;
      library.refreshVideos().catch(function (error) {
        console.error(error);
        setStatus(i18n.t('status.updateLibraryFailed', { error: errorMessage(error) }), 'error');
      });
    }
    setStatus(collectionToggleStatus(togglePayload));
  }

  if (message.channel === 'browser-navigation-state') {
    browser.setNavigationState(message.args[0] as BrowserNavigationState);
  }

  if (message.channel === 'downloads-changed') {
    const records = Array.isArray(message.args[0]) ? (message.args[0] as DownloadRecord[]) : null;
    if (records) applyDownloadNotifications(records);
    library.refreshDownloads().catch(function (error) {
      console.error(error);
    });
  }

  if (message.channel === 'browser-tabs-compact-mode') {
    const compactPayload = (message.args[0] || {}) as { compact?: boolean };
    setBrowserTabsCompact(Boolean(compactPayload.compact));
  }

  if (message.channel === 'browser-tabs-compact-toggle-shortcut' && activeView.value === 'browser') {
    setBrowserTabsCompact(!browserTabsCompact.value);
  }

  if (message.channel === 'browser-tab-shortcut') {
    setActiveView('browser');
  }

  if (message.channel === 'jable-origin-fallback') {
    const payload = (message.args[0] || {}) as { origin?: string };
    setStatus(i18n.t('status.jableFallback', { origin: payload.origin || 'https://fs1.app' }), 'warning');
  }
}

function downloadNotificationTitle(record: DownloadRecord) {
  return record.title || record.videoUrl;
}

function applyDownloadNotifications(records: DownloadRecord[]) {
  const nextStates = new Map<string, DownloadState>();

  for (const record of records) {
    const previousState = downloadNotificationStates.get(record.videoUrl) || null;
    nextStates.set(record.videoUrl, record.state);
    if (record.state !== 'failed' && previousState === 'failed') suppressedDownloadFailureUrls.delete(record.videoUrl);

    if (!previousState || previousState === record.state) continue;

    if (record.state === 'ready') {
      setStatus(i18n.t('status.downloadCompleted', { title: downloadNotificationTitle(record) }), 'success');
    } else if (record.state === 'failed') {
      if (suppressedDownloadFailureUrls.has(record.videoUrl)) {
        suppressedDownloadFailureUrls.delete(record.videoUrl);
      } else {
        setStatus(
          i18n.t('status.downloadFailed', {
            title: downloadNotificationTitle(record),
            error: record.error || i18n.t('status.unknownError')
          }),
          'error'
        );
      }
    }
  }

  downloadNotificationStates = nextStates;
}

async function exportCollection(collectionKey: CollectionKey) {
  if (busy.value || syncing.value) return;

  busy.value = true;

  try {
    const result = await api.exportJsonFile(collectionKey);

    if (result && result.canceled) {
      setStatus(i18n.t('status.exportCanceled'));
      return;
    }

    setStatus(
      i18n.t('status.exported', { filename: (result && result.filename) || collectionKey + '.json' }),
      'success'
    );
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.exportFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function importJsonToCollection(payload: { collectionKey: CollectionKey; resource: ExportResource }) {
  if (busy.value) return;

  busy.value = true;

  try {
    const result = await api.importJson({
      collectionKey: payload.collectionKey,
      resource: payload.resource
    });

    if (library.activeCollection.value === payload.collectionKey) {
      library.currentPage.value = 1;
      await library.refreshVideos();
    }
    setStatus(
      i18n.t('status.imported', { count: result.imported, collection: collectionName(payload.collectionKey) }),
      'success'
    );
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.importFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function diagnoseLayout() {
  setStatus(await browser.diagnose());
}

async function selectLibraryTab(tabKey: string) {
  await library.selectTab(tabKey);
}

async function newBrowserTab() {
  try {
    setActiveView('browser');
    await browser.createTab(DEFAULT_BROWSER_URL, { active: true });
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.newTabFailed', { error: errorMessage(error) }), 'error');
  }
}

async function activateBrowserTab(tabId: string) {
  try {
    setActiveView('browser');
    await browser.activateTab(tabId);
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.activateTabFailed', { error: errorMessage(error) }), 'error');
  }
}

async function closeBrowserTab(tabId: string) {
  try {
    await browser.closeTab(tabId);
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.closeTabFailed', { error: errorMessage(error) }), 'error');
  }
}

async function setBrowserTabMuted(payload: { tabId: string | null; muted: boolean }) {
  try {
    await browser.setTabMuted(payload.tabId, payload.muted);
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.muteTabFailed', { error: errorMessage(error) }), 'error');
  }
}

async function showBrowserTabMenu(payload: BrowserTabMenuPayload) {
  try {
    await api.showBrowserTabMenu(
      Object.assign({}, payload, {
        compactMode: browserTabsCompact.value
      })
    );
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.tabMenuFailed', { error: errorMessage(error) }), 'error');
  }
}

async function showLibraryVideoMenu(payload: LibraryVideoMenuPayload) {
  try {
    await api.showLibraryVideoMenu(payload);
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.videoMenuFailed', { error: errorMessage(error) }), 'error');
  }
}

function applyAppSettings(settings: AppSettings) {
  appSettings.value = settings;
  browserTabsCompact.value = Boolean(settings.compactBrowserTabs);
  library.downloadStateFilters.value = settings.downloadStateFilters.slice();
  browser.scheduleResize();
}

async function updateAppSettings(patch: AppSettingsPatch) {
  try {
    applyAppSettings(await api.updateSettings(patch));
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.settingsSaveFailed', { error: errorMessage(error) }), 'error');
  }
}

async function updateDownloadStateFilters(value: DownloadStateFilters) {
  library.downloadStateFilters.value = value;
  try {
    applyAppSettings(await api.updateSettings({ downloadStateFilters: value }));
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.settingsSaveFailed', { error: errorMessage(error) }), 'error');
  }
}

function changeLocale(locale: string) {
  i18n.setLocale(locale);
}

function resetBrowserTabsWidth() {
  setBrowserTabsWidth(BROWSER_TABS_DEFAULT_WIDTH);
  setStatus(i18n.t('status.settingsSaved'), 'success');
}

function ffmpegStatusTone(status: FfmpegStatus | null) {
  return status && status.state === 'detected' ? 'success' : 'warning';
}

function ffmpegStatusMessage(status: FfmpegStatus | null) {
  if (!status) return i18n.t('status.ffmpegStatusUnknown');
  if (status.state === 'detected') {
    return i18n.t('status.ffmpegDetected', { version: status.version || status.path || 'ffmpeg' });
  }
  if (status.state === 'invalid_path') {
    return i18n.t('status.ffmpegInvalidPath', { error: status.error || i18n.t('status.unknownError') });
  }
  if (status.state === 'unsupported') {
    return i18n.t('status.ffmpegUnsupported', { error: status.error || i18n.t('status.unknownError') });
  }
  return i18n.t('status.ffmpegMissing');
}

async function refreshFfmpegStatus() {
  try {
    ffmpegStatus.value = await api.refreshFfmpegStatus();
    setStatus(ffmpegStatusMessage(ffmpegStatus.value), ffmpegStatusTone(ffmpegStatus.value));
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.ffmpegCheckFailed', { error: errorMessage(error) }), 'error');
  }
}

async function chooseFfmpegPath() {
  try {
    const result = await api.chooseFfmpegPath();
    ffmpegStatus.value = result;
    if (result.canceled) return;
    applyAppSettings(await api.getSettings());
    setStatus(ffmpegStatusMessage(ffmpegStatus.value), ffmpegStatusTone(ffmpegStatus.value));
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.ffmpegPathSelectFailed', { error: errorMessage(error) }), 'error');
  }
}

async function clearFfmpegPath() {
  try {
    ffmpegStatus.value = await api.clearFfmpegPath();
    applyAppSettings(await api.getSettings());
    setStatus(ffmpegStatusMessage(ffmpegStatus.value), ffmpegStatusTone(ffmpegStatus.value));
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.ffmpegPathClearFailed', { error: errorMessage(error) }), 'error');
  }
}

async function chooseDownloadRoot() {
  try {
    const result = await api.chooseDownloadRoot();
    downloadRoot.value = result;
    if (result.canceled) return;
    applyAppSettings(await api.getSettings());
    setStatus(i18n.t('status.downloadRootSelected', { path: result.path }), 'success');
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadRootSelectFailed', { error: errorMessage(error) }), 'error');
  }
}

async function clearDownloadRoot() {
  try {
    downloadRoot.value = await api.clearDownloadRoot();
    applyAppSettings(await api.getSettings());
    setStatus(i18n.t('status.downloadRootDefault', { path: downloadRoot.value.path }), 'success');
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadRootClearFailed', { error: errorMessage(error) }), 'error');
  }
}

async function openDownloadRoot() {
  if (busy.value || syncing.value) return;

  busy.value = true;

  try {
    const result = await api.openDownloadRoot();
    downloadRoot.value = await api.getDownloadRoot();
    setStatus(i18n.t('status.downloadRootOpened', { path: result.path }), 'success');
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadRootOpenFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function openDownloadFile(videoUrl: string) {
  if (!videoUrl || busy.value || syncing.value) return;

  try {
    await api.openDownloadFile(videoUrl);
    setStatus(i18n.t('status.downloadFileOpened'), 'success');
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadFileOpenFailed', { error: errorMessage(error) }), 'error');
    library.refreshDownloads().catch(function (refreshError) {
      console.error(refreshError);
    });
  }
}

async function revealDownloadFile(videoUrl: string) {
  if (!videoUrl || busy.value || syncing.value) return;

  try {
    await api.revealDownloadFile(videoUrl);
    setStatus(i18n.t('status.downloadFileRevealed'), 'success');
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadFileRevealFailed', { error: errorMessage(error) }), 'error');
    library.refreshDownloads().catch(function (refreshError) {
      console.error(refreshError);
    });
  }
}

function downloadRequestVideo(video: VideoRow): DownloadRequestPayload['video'] {
  return {
    title: video.title,
    url: video.url,
    views: video.views,
    likes: video.likes,
    img: video.img,
    preview: video.preview
  };
}

function downloadRecordForVideoUrl(videoUrl: string) {
  return (
    library.downloadRecords.value.find(function (record) {
      return record.videoUrl === videoUrl;
    }) || null
  );
}

function selectBatchDownloadVideos(videos: VideoRow[]) {
  library.selectBatchDownloadVideos(
    videos.map(function (video) {
      return video.url;
    })
  );
}

function isDownloadDeleteSelectable(record: DownloadRecord) {
  return (
    record.state === 'ready' || record.state === 'paused' || record.state === 'failed' || record.state === 'missing'
  );
}

function toggleDownloadRecordSelection(payload: { videoUrl: string; selected: boolean }) {
  const next = new Set(selectedDownloadUrls.value);
  if (payload.selected) next.add(payload.videoUrl);
  else next.delete(payload.videoUrl);
  selectedDownloadUrls.value = Array.from(next);
}

function selectedVisibleDownloadUrls() {
  const selected = new Set(selectedDownloadUrls.value);
  return library.downloads.value
    .filter(function (record) {
      return selected.has(record.videoUrl) && isDownloadDeleteSelectable(record);
    })
    .map(function (record) {
      return record.videoUrl;
    });
}

function downloadFailurePhaseLabel(record: DownloadRecord) {
  const phase = record.failurePhase || 'unknown';
  if (
    phase !== 'ffmpeg_check' &&
    phase !== 'video_page' &&
    phase !== 'playlist' &&
    phase !== 'segments' &&
    phase !== 'remux' &&
    phase !== 'file'
  ) {
    return i18n.t('downloadList.failurePhaseLabel.unknown');
  }
  return i18n.t('downloadList.failurePhaseLabel.' + phase);
}

function downloadErrorSummaryLabel(record: DownloadRecord) {
  if (record.state === 'missing') return i18n.t('downloadList.errorReason.missingFile');

  const text = (record.error || '').trim();
  if (!text) return i18n.t('downloadList.errorReason.generic');
  if (/取消|cancel/i.test(text)) return i18n.t('downloadList.errorReason.cancelled');
  if (/http\s*(401|403|428|429)|precondition|required|forbidden|unauthorized|too many requests/i.test(text)) {
    return i18n.t('downloadList.errorReason.accessRejected');
  }
  if (/enoent|no such file|file removed|not found|找不到|遺失/i.test(text)) {
    return i18n.t('downloadList.errorReason.missingFile');
  }
  if (/ffmpeg|muxer|output format|invalid argument|remux/i.test(text)) {
    return i18n.t('downloadList.errorReason.ffmpeg');
  }
  if (/m3u8|playlist|hls|segment/i.test(text)) return i18n.t('downloadList.errorReason.playlist');
  if (/network|timeout|timed out|econn|dns|socket|connection/i.test(text)) {
    return i18n.t('downloadList.errorReason.network');
  }
  return i18n.t('downloadList.errorReason.generic');
}

function optionalDownloadDetail(value: string | number | null | undefined) {
  if (value === null || typeof value === 'undefined' || value === '') return i18n.t('downloadList.notAvailable');
  return String(value);
}

async function downloadVideo(video: VideoRow) {
  if (!video || !video.url || busy.value || syncing.value) return;

  try {
    const result = await api.enqueueDownload({
      collectionKey: library.activeCollection.value,
      video: downloadRequestVideo(video)
    });
    setStatus(
      result.queued ? i18n.t('status.downloadQueued') : i18n.t('status.downloadAlreadyQueued'),
      result.queued ? 'success' : 'info'
    );
    await library.refreshDownloads();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadStartFailed', { error: errorMessage(error) }), 'error');
  }
}

async function downloadSelectedVideos() {
  if (busy.value || syncing.value) return;

  const videos = library.selectedBatchDownloadVideos.value.slice();
  if (!videos.length) {
    setStatus(i18n.t('status.downloadBatchNoSelection'), 'info');
    return;
  }

  busy.value = true;
  let queued = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (const video of videos) {
      try {
        const record = downloadRecordForVideoUrl(video.url);
        const result =
          record && record.state === 'paused'
            ? await api.resumeDownload(record.videoUrl)
            : record && (record.state === 'failed' || record.state === 'missing')
              ? await api.retryDownload(record.videoUrl)
              : await api.enqueueDownload({
                  collectionKey: library.activeCollection.value,
                  video: downloadRequestVideo(video)
                });

        if (result.queued) queued += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        console.error(error);
      }
    }

    library.clearBatchDownloadSelection();
    await library.refreshDownloads();
    setStatus(
      i18n.t('status.downloadBatchQueued', {
        queued: queued,
        skipped: skipped,
        failed: failed
      }),
      failed > 0 ? 'warning' : queued > 0 ? 'success' : 'info'
    );
  } finally {
    busy.value = false;
  }
}

async function retryDownload(videoUrl: string) {
  if (!videoUrl || busy.value || syncing.value) return;

  try {
    const result = await api.retryDownload(videoUrl);
    setStatus(
      result.queued ? i18n.t('status.downloadQueued') : i18n.t('status.downloadAlreadyQueued'),
      result.queued ? 'success' : 'info'
    );
    await library.refreshDownloads();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadRetryFailed', { error: errorMessage(error) }), 'error');
  }
}

async function retryFailedDownloads() {
  if (busy.value || syncing.value) return;

  busy.value = true;
  try {
    const result = await api.retryFailedDownloads();
    setStatus(
      i18n.t('status.downloadBulkActionComplete', {
        affected: result.affected,
        skipped: result.skipped,
        failed: result.failed
      }),
      result.failed > 0 ? 'warning' : result.affected > 0 ? 'success' : 'info'
    );
    await library.refreshDownloads();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadRetryFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function resumeDownload(videoUrl: string) {
  if (!videoUrl || busy.value || syncing.value) return;

  try {
    const result = await api.resumeDownload(videoUrl);
    setStatus(
      result.queued ? i18n.t('status.downloadResumed') : i18n.t('status.downloadAlreadyQueued'),
      result.queued ? 'success' : 'info'
    );
    await library.refreshDownloads();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadResumeFailed', { error: errorMessage(error) }), 'error');
  }
}

async function pauseDownload(videoUrl: string) {
  if (!videoUrl || busy.value || syncing.value) return;

  try {
    await api.pauseDownload(videoUrl);
    setStatus(i18n.t('status.downloadPaused'), 'success');
    await library.refreshDownloads();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadPauseFailed', { error: errorMessage(error) }), 'error');
  }
}

async function pauseAllDownloads() {
  if (busy.value || syncing.value) return;

  busy.value = true;
  try {
    const result = await api.pauseAllDownloads();
    setStatus(
      i18n.t('status.downloadBulkActionComplete', {
        affected: result.affected,
        skipped: result.skipped,
        failed: result.failed
      }),
      result.failed > 0 ? 'warning' : result.affected > 0 ? 'success' : 'info'
    );
    await library.refreshDownloads();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadPauseFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function resumePausedDownloads() {
  if (busy.value || syncing.value) return;

  busy.value = true;
  try {
    const result = await api.resumePausedDownloads();
    setStatus(
      i18n.t('status.downloadBulkActionComplete', {
        affected: result.affected,
        skipped: result.skipped,
        failed: result.failed
      }),
      result.failed > 0 ? 'warning' : result.affected > 0 ? 'success' : 'info'
    );
    await library.refreshDownloads();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadResumeFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function cancelDownload(videoUrl: string) {
  if (!videoUrl || busy.value || syncing.value) return;

  suppressedDownloadFailureUrls.add(videoUrl);
  try {
    await api.cancelDownload(videoUrl);
    setStatus(i18n.t('status.downloadCanceled'), 'success');
    await library.refreshDownloads();
  } catch (error) {
    suppressedDownloadFailureUrls.delete(videoUrl);
    console.error(error);
    setStatus(i18n.t('status.downloadCancelFailed', { error: errorMessage(error) }), 'error');
  }
}

async function cancelQueuedDownloads() {
  if (busy.value || syncing.value) return;

  busy.value = true;
  try {
    const queuedUrls = library.downloadRecords.value
      .filter(function (record) {
        return record.state === 'queued';
      })
      .map(function (record) {
        return record.videoUrl;
      });
    queuedUrls.forEach(function (videoUrl) {
      suppressedDownloadFailureUrls.add(videoUrl);
    });
    const result = await api.cancelQueuedDownloads();
    setStatus(
      i18n.t('status.downloadBulkActionComplete', {
        affected: result.affected,
        skipped: result.skipped,
        failed: result.failed
      }),
      result.failed > 0 ? 'warning' : result.affected > 0 ? 'success' : 'info'
    );
    await library.refreshDownloads();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadCancelFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function deleteDownload(videoUrl: string) {
  if (!videoUrl || busy.value || syncing.value) return;

  try {
    const result = await api.deleteDownload(videoUrl);
    if (result.canceled) return;
    setStatus(i18n.t('status.downloadDeleted'), 'success');
    await library.refreshDownloads();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadDeleteFailed', { error: errorMessage(error) }), 'error');
  }
}

async function deleteSelectedDownloads() {
  if (busy.value || syncing.value) return;

  const videoUrls = selectedVisibleDownloadUrls();
  if (!videoUrls.length) {
    setStatus(i18n.t('status.downloadBulkNoSelection'), 'info');
    return;
  }

  busy.value = true;
  try {
    const result = await api.deleteDownloads(videoUrls);
    if (result.canceled) return;
    selectedDownloadUrls.value = selectedDownloadUrls.value.filter(function (videoUrl) {
      return videoUrls.indexOf(videoUrl) === -1;
    });
    setStatus(
      i18n.t('status.downloadBulkDeleteComplete', {
        deletedFiles: result.deletedFiles,
        removedRecords: result.removedRecords,
        skipped: result.skipped,
        failed: result.failed
      }),
      result.failed > 0 ? 'warning' : result.removedRecords > 0 ? 'success' : 'info'
    );
    await library.refreshDownloads();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.downloadDeleteFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function openLocalDataFolder() {
  if (busy.value || syncing.value) return;

  busy.value = true;

  try {
    await api.openLocalDataFolder();
    setStatus(i18n.t('status.localDataFolderOpened'), 'success');
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.localDataFolderOpenFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function checkForUpdates() {
  if (busy.value || syncing.value) return;

  busy.value = true;
  setStatus(i18n.t('status.checkingUpdates'), 'info', { sticky: true });

  try {
    await api.checkForUpdates();
    hideToast();
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.updateCheckFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function syncMainLocale(locale: string) {
  try {
    await api.setLocale(locale);
  } catch (error) {
    console.error(error);
  }
}

watch(i18n.locale, function (locale) {
  if (!mainLocaleSynced) return;
  syncMainLocale(locale);
});

watch(library.downloadRecords, function (records) {
  const selectable = new Set(
    records.filter(isDownloadDeleteSelectable).map(function (record) {
      return record.videoUrl;
    })
  );
  selectedDownloadUrls.value = selectedDownloadUrls.value.filter(function (videoUrl) {
    return selectable.has(videoUrl);
  });
});

onMounted(async function () {
  browserTabsWidth.value = loadBrowserTabsWidth();
  appInfo.value = await api.getAppInfo();
  applyAppSettings(await api.getSettings());
  ffmpegStatus.value = await api.getFfmpegStatus();
  downloadRoot.value = await api.getDownloadRoot();
  const legacyCompact = loadLegacyBrowserTabsCompact();
  if (legacyCompact !== null) {
    applyAppSettings(await api.updateSettings({ compactBrowserTabs: legacyCompact }));
    clearLegacyBrowserTabsCompact();
  }
  i18n.initializeLocale(appInfo.value.systemLocale || appInfo.value.locale);
  await syncMainLocale(i18n.locale.value);
  mainLocaleSynced = true;
  api.onBrowserMessage(handleBrowserMessage);
  setActiveView('browser');
  browser.scheduleResize();
  await browser.refreshTabs();
  await library.refreshVideos();
  await library.refreshDownloads();
  await library.refreshPendingGroups();
  browser.scheduleResize();
});
</script>

<template>
  <div class="app-shell">
    <TopBar
      :active-view="activeView"
      :busy="busy"
      :navigation="browser.navigation.value"
      @set-view="setActiveView"
      @back="browser.goBack"
      @forward="browser.goForward"
      @reload="browser.reload"
      @diagnose="diagnoseLayout"
    />

    <Transition name="status-toast">
      <div v-if="toast" class="app-toast" :class="'app-toast-' + toast.tone" role="status" aria-live="polite">
        <div class="app-toast-content">
          <span>{{ toast.text }}</span>
          <div
            v-if="toast.showQueueProgress && syncQueueProgress"
            class="app-toast-progress"
            role="progressbar"
            :aria-label="
              i18n.t('status.syncQueueProgressLabel', {
                processed: syncQueueProgressProcessed,
                total: syncQueueProgress.total
              })
            "
            aria-valuemin="0"
            :aria-valuemax="syncQueueProgress.total"
            :aria-valuenow="syncQueueProgressProcessed"
          >
            <span :style="{ width: syncQueueProgressPercent + '%' }"></span>
          </div>
        </div>
        <button class="app-toast-close" type="button" :aria-label="i18n.t('toast.close')" @click="hideToast">×</button>
      </div>
    </Transition>

    <main class="relative block h-full min-h-0 overflow-hidden">
      <BrowserPanel
        :active="activeView === 'browser'"
        :tabs="browser.tabs.value"
        :active-tab-id="browser.activeTabId.value"
        :can-create-tab="browser.canCreateTab.value"
        :compact="browserTabsCompact"
        :tab-width="browserTabsWidth"
        @host="browser.setHost"
        @new-tab="newBrowserTab"
        @activate-tab="activateBrowserTab"
        @close-tab="closeBrowserTab"
        @set-tab-muted="setBrowserTabMuted"
        @tab-context-menu="showBrowserTabMenu"
        @resize-tabs="setBrowserTabsWidth"
        @layout-change="browser.scheduleResize"
      />

      <LibraryPanel
        :active="activeView === 'library'"
        :active-collection="library.activeCollection.value"
        :active-tab="library.activeTab.value"
        :busy="libraryBusy"
        :ffmpeg-ready="ffmpegStatus ? ffmpegStatus.state === 'detected' : false"
        :full-sync-label="library.fullSyncButtonLabel.value"
        :pending-count="library.pendingCount.value"
        :pending-groups="library.pendingGroups.value"
        :search="library.search.value"
        :search-mode="library.searchMode.value"
        :collection-download-filter="library.collectionDownloadFilter.value"
        :sort="library.sort.value"
        :direction="library.direction.value"
        :download-search="library.downloadSearch.value"
        :download-sort="library.downloadSort.value"
        :download-direction="library.downloadDirection.value"
        :download-state-filters="library.downloadStateFilters.value"
        :count-label="library.countLabel.value"
        :page-label="library.pageLabel.value"
        :downloads="library.downloads.value"
        :download-records="library.downloadRecords.value"
        :batch-download-selection="library.batchDownloadSelection.value"
        :selected-download-urls="selectedDownloadUrls"
        :rows="pageRows"
        :current-page="library.currentPage.value"
        :total-pages="library.totalPages.value"
        @select-tab="selectLibraryTab"
        @quick-sync="sync.syncCollection('quick')"
        @full-sync="sync.syncCollection('full')"
        @update:search="library.search.value = $event"
        @update:search-mode="library.searchMode.value = $event"
        @update:collection-download-filter="library.collectionDownloadFilter.value = $event"
        @update:sort="library.sort.value = $event"
        @update:direction="library.direction.value = $event"
        @update:download-search="library.downloadSearch.value = $event"
        @update:download-sort="library.downloadSort.value = $event"
        @update:download-direction="library.downloadDirection.value = $event"
        @update:download-state-filters="updateDownloadStateFilters"
        @prev-page="library.goToPage(library.currentPage.value - 1)"
        @next-page="library.goToPage(library.currentPage.value + 1)"
        @go-page="library.goToPage($event)"
        @open-download="openDownloadFile"
        @reveal-download="revealDownloadFile"
        @retry-download="retryDownload"
        @retry-failed-downloads="retryFailedDownloads"
        @pause-download="pauseDownload"
        @pause-all-downloads="pauseAllDownloads"
        @resume-download="resumeDownload"
        @resume-paused-downloads="resumePausedDownloads"
        @cancel-download="cancelDownload"
        @cancel-queued-downloads="cancelQueuedDownloads"
        @delete-download="deleteDownload"
        @delete-selected-downloads="deleteSelectedDownloads"
        @show-download-error-log="showDownloadErrorLog = true"
        @toggle-download-record-selection="toggleDownloadRecordSelection"
        @download-video="downloadVideo"
        @select-downloadable="selectBatchDownloadVideos"
        @download-selected="downloadSelectedVideos"
        @clear-download-selection="library.clearBatchDownloadSelection"
        @toggle-download-selection="library.toggleBatchDownloadSelection($event.video.url, $event.selected)"
        @add-pending-group="addPendingRemoteOperationGroup"
        @remove-pending-group="removePendingRemoteOperationGroup"
        @resolve-pending-group="resolvePendingRemoteOperationGroup"
        @open-video="openInBrowser"
        @open-video-new-tab="openInNewBrowserTab"
        @video-context-menu="showLibraryVideoMenu"
      />

      <SettingsPanel
        :active="activeView === 'settings'"
        :busy="busy || syncing"
        :settings="appSettings"
        :ffmpeg-status="ffmpegStatus"
        :download-root="downloadRoot"
        :database-path="appInfo && appInfo.databasePath"
        @update-settings="updateAppSettings"
        @change-locale="changeLocale"
        @reset-tabs-width="resetBrowserTabsWidth"
        @refresh-ffmpeg="refreshFfmpegStatus"
        @choose-ffmpeg="chooseFfmpegPath"
        @clear-ffmpeg="clearFfmpegPath"
        @choose-download-root="chooseDownloadRoot"
        @clear-download-root="clearDownloadRoot"
        @open-download-root="openDownloadRoot"
        @open-data-folder="openLocalDataFolder"
        @check-updates="checkForUpdates"
        @import-json="importJsonToCollection"
        @export-json="exportCollection"
      />

      <Transition name="app-modal">
        <div
          v-if="showDownloadErrorLog"
          class="app-modal-backdrop"
          role="presentation"
          @click.self="showDownloadErrorLog = false"
        >
          <section
            class="app-modal"
            role="dialog"
            aria-modal="true"
            :aria-label="i18n.t('downloadList.errorLogTitle')"
            data-test="download-error-log-modal"
          >
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-base font-bold">{{ i18n.t('downloadList.errorLogTitle') }}</h2>
              <button
                type="button"
                class="app-toast-close"
                :aria-label="i18n.t('downloadList.errorLogClose')"
                @click="showDownloadErrorLog = false"
              >
                ×
              </button>
            </div>
            <div v-if="!downloadErrorLogRecords.length" class="text-sm text-[var(--muted)]">
              {{ i18n.t('downloadList.errorLogEmpty') }}
            </div>
            <div v-else class="grid max-h-[520px] gap-3 overflow-auto pr-1">
              <article
                v-for="record in downloadErrorLogRecords"
                :key="record.videoUrl"
                class="grid gap-1 rounded-md border border-[var(--panel-border)] bg-[var(--card)] p-3 text-xs leading-5"
                data-test="download-error-log-row"
              >
                <h3 class="text-sm font-semibold text-[var(--text)]">{{ record.title || record.videoUrl }}</h3>
                <p class="m-0 break-all text-[var(--muted)]">{{ record.videoUrl }}</p>
                <p class="m-0 text-[var(--muted)]">
                  {{ i18n.t('downloadList.errorLogState', { state: i18n.t('downloadList.state.' + record.state) }) }}
                </p>
                <p class="m-0 text-[#f2b35d]">{{ downloadErrorSummaryLabel(record) }}</p>
                <p class="m-0 text-[var(--muted)]">
                  {{ i18n.t('downloadList.failurePhase', { phase: downloadFailurePhaseLabel(record) }) }}
                </p>
                <p class="m-0 text-[var(--muted)]">
                  {{ i18n.t('downloadList.failureCode', { code: optionalDownloadDetail(record.failureCode) }) }}
                </p>
                <p class="m-0 text-[var(--muted)]">
                  {{ i18n.t('downloadList.attemptCount', { count: record.attemptCount || 0 }) }}
                </p>
                <p class="m-0 text-[var(--muted)]">
                  {{ i18n.t('downloadList.lastStartedAt', { time: optionalDownloadDetail(record.lastStartedAt) }) }}
                </p>
                <p class="m-0 text-[var(--muted)]">
                  {{ i18n.t('downloadList.lastErrorAt', { time: optionalDownloadDetail(record.lastErrorAt) }) }}
                </p>
              </article>
            </div>
          </section>
        </div>
      </Transition>
    </main>
  </div>
</template>
