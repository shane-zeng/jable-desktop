<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BrowserPanel from './components/BrowserPanel.vue';
import BrowserTabRail from './components/BrowserTabRail.vue';
import DownloadErrorLogModal from './components/DownloadErrorLogModal.vue';
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
import { useDownloadErrorLog } from './composables/useDownloadErrorLog';
import { useDownloadWorkflow } from './composables/useDownloadWorkflow';
import { useJableApi } from './composables/useJableApi';
import { useLibraryState } from './composables/useLibraryState';
import { usePendingRemoteActions } from './composables/usePendingRemoteActions';
import { useSyncWorkflow } from './composables/useSyncWorkflow';
import { errorMessage, useToastStatus } from './composables/useToastStatus';
import {
  downloadErrorSummaryLabel as displayDownloadErrorSummaryLabel,
  downloadFailurePhaseLabel as displayDownloadFailurePhaseLabel,
  optionalDownloadDetail as displayOptionalDownloadDetail
} from './download-display';
import { useI18n } from './i18n';
import type {
  AppSettings,
  AppSettingsPatch,
  AppInfo,
  AppView,
  BrowserMessage,
  BrowserNavigationState,
  BrowserTabMenuPayload,
  BrowserTabsMode,
  BrowserTabsState,
  CollectionKey,
  CollectionToggleResult,
  DownloadRecord,
  DownloadRootInfo,
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
const browserTabsMode = ref<BrowserTabsMode>(DEFAULT_APP_SETTINGS.browserTabsMode);
const browserTabsWidth = ref(BROWSER_TABS_DEFAULT_WIDTH);
const appInfo = ref<AppInfo | null>(null);
const appSettings = ref<AppSettings>(
  Object.assign({}, DEFAULT_APP_SETTINGS, {
    downloadStateFilters: DEFAULT_APP_SETTINGS.downloadStateFilters.slice()
  })
);
const ffmpegStatus = ref<FfmpegStatus | null>(null);
const downloadRoot = ref<DownloadRootInfo | null>(null);
const browser = useBrowserBounds(api, activeView);
const library = useLibraryState(api);
let mainLocaleSynced = false;
let locatedDownloadTimer: ReturnType<typeof setTimeout> | null = null;
let locatedDownloadCard: HTMLElement | null = null;
const LOCATED_DOWNLOAD_CLASS = 'download-card-located';

function serializedError(error: unknown) {
  if (!(error instanceof Error)) {
    return {
      message: String(error)
    };
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack || null
  };
}

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
const downloadWorkflow = useDownloadWorkflow({
  api: api,
  busy: busy,
  syncing: syncing,
  errorMessage: errorMessage,
  library: library,
  setStatus: setStatus,
  t: i18n.t
});
const selectedDownloadUrls = downloadWorkflow.selectedDownloadUrls;
const openDownloadFile = downloadWorkflow.openDownloadFile;
const revealDownloadFile = downloadWorkflow.revealDownloadFile;
const retryDownload = downloadWorkflow.retryDownload;
const retryFailedDownloads = downloadWorkflow.retryFailedDownloads;
const pauseDownload = downloadWorkflow.pauseDownload;
const pauseAllDownloads = downloadWorkflow.pauseAllDownloads;
const resumeDownload = downloadWorkflow.resumeDownload;
const resumePausedDownloads = downloadWorkflow.resumePausedDownloads;
const cancelDownload = downloadWorkflow.cancelDownload;
const cancelQueuedDownloads = downloadWorkflow.cancelQueuedDownloads;
const deleteDownload = downloadWorkflow.deleteDownload;
const deleteSelectedDownloads = downloadWorkflow.deleteSelectedDownloads;
const toggleDownloadRecordSelection = downloadWorkflow.toggleDownloadRecordSelection;
const downloadVideo = downloadWorkflow.downloadVideo;
const selectBatchDownloadVideos = downloadWorkflow.selectBatchDownloadVideos;
const downloadSelectedVideos = downloadWorkflow.downloadSelectedVideos;
const downloadErrorLog = useDownloadErrorLog({
  records: library.downloadRecords,
  isAvailable: isDownloadErrorLogAvailable
});
const showDownloadErrorLog = downloadErrorLog.show;
const showAllDownloadErrorLog = downloadErrorLog.showAll;
const downloadErrorLogRecords = downloadErrorLog.records;
const downloadErrorLogTotal = downloadErrorLog.total;
const downloadErrorLogShown = downloadErrorLog.shown;
const downloadErrorLogCanShowAll = downloadErrorLog.canShowAll;
const downloadErrorLogPreviewLimit = downloadErrorLog.previewLimit;
const closeDownloadErrorLog = downloadErrorLog.close;
const toggleDownloadErrorLogShowAll = downloadErrorLog.toggleShowAll;

const pageRows = computed<VideoRow[]>(function () {
  return library.pageRows.value;
});

const libraryBusy = computed(function () {
  return busy.value || syncing.value;
});

const browserTabsCompact = computed(function () {
  return browserTabsMode.value === 'compact';
});

const browserTabsShared = computed(function () {
  return browserTabsMode.value === 'shared';
});

const showSharedBrowserTabs = computed(function () {
  return browserTabsShared.value && activeView.value !== 'settings';
});

const sharedBrowserLayoutStyle = computed(function () {
  return {
    gridTemplateColumns: browserTabsWidth.value + 'px 6px minmax(0, 1fr)'
  };
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
  await setBrowserTabsMode(value ? 'compact' : 'standard');
}

async function setBrowserTabsMode(mode: BrowserTabsMode) {
  browserTabsMode.value = mode;
  browser.scheduleResize();
  try {
    applyAppSettings(await api.updateSettings({ browserTabsMode: mode }));
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

function isDownloadErrorLogAvailable() {
  return activeView.value === 'library' && library.activeTab.value === 'downloads';
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
    const openInBackground = activeView.value === 'library';
    if (!openInBackground) {
      setActiveView('browser');
    }
    await browser.createTab(url, { active: !openInBackground });
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
    if (records) downloadWorkflow.applyDownloadNotifications(records);
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

  if (message.channel === 'browser-tabs-shared-toggle-shortcut' && activeView.value !== 'settings') {
    setBrowserTabsMode(browserTabsShared.value ? 'standard' : 'shared');
  }

  if (message.channel === 'browser-tab-shortcut') {
    setActiveView('browser');
  }

  if (message.channel === 'app-view-shortcut') {
    const payload = (message.args[0] || {}) as { view?: string };
    if (payload.view === 'browser' || payload.view === 'library' || payload.view === 'settings') {
      setActiveView(payload.view);
    }
  }

  if (message.channel === 'jable-origin-fallback') {
    const payload = (message.args[0] || {}) as { origin?: string };
    setStatus(i18n.t('status.jableFallback', { origin: payload.origin || 'https://fs1.app' }), 'warning');
  }
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

function downloadRecordCardElement(videoUrl: string) {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-test="download-record-card"]'));

  return (
    cards.find(function (card) {
      return card.dataset.videoUrl === videoUrl;
    }) || null
  );
}

function clearLocatedDownloadTimer() {
  if (!locatedDownloadTimer) return;

  clearTimeout(locatedDownloadTimer);
  locatedDownloadTimer = null;
}

function clearLocatedDownloadHighlight() {
  clearLocatedDownloadTimer();
  if (locatedDownloadCard) locatedDownloadCard.classList.remove(LOCATED_DOWNLOAD_CLASS);
  locatedDownloadCard = null;
}

async function locateDownloadRecord(videoUrl: string) {
  if (!videoUrl) return;

  clearLocatedDownloadHighlight();
  library.downloadSearch.value = '';
  library.downloadStateFilters.value = ['all'];
  await library.selectTab('downloads');
  await nextTick();
  await nextTick();

  const card = downloadRecordCardElement(videoUrl);
  if (!card) {
    setStatus(i18n.t('status.downloadLocateFailed'), 'warning');
    return;
  }

  card.classList.add(LOCATED_DOWNLOAD_CLASS);
  locatedDownloadCard = card;
  if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  try {
    card.focus({ preventScroll: true });
  } catch {
    card.focus();
  }
  locatedDownloadTimer = setTimeout(function () {
    if (locatedDownloadCard === card) {
      locatedDownloadCard.classList.remove(LOCATED_DOWNLOAD_CLASS);
      locatedDownloadCard = null;
    }
    locatedDownloadTimer = null;
  }, 1800);
}

async function newBrowserTab() {
  if (activeView.value === 'library' && browserTabsShared.value) {
    try {
      await browser.createTab(DEFAULT_BROWSER_URL, { active: false });
    } catch (error) {
      console.error(error);
      setStatus(i18n.t('status.newTabFailed', { error: errorMessage(error) }), 'error');
    }
    return;
  }

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
  browserTabsMode.value = settings.browserTabsMode || (settings.compactBrowserTabs ? 'compact' : 'standard');
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

async function openFfmpegGuide() {
  try {
    await api.openFfmpegGuide();
    setStatus(i18n.t('status.ffmpegGuideOpened'), 'success');
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.ffmpegGuideOpenFailed', { error: errorMessage(error) }), 'error');
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

function downloadFailurePhaseLabel(record: DownloadRecord) {
  return displayDownloadFailurePhaseLabel(record, i18n.t);
}

function downloadErrorSummaryLabel(record: DownloadRecord) {
  return displayDownloadErrorSummaryLabel(record, i18n.t);
}

function optionalDownloadDetail(value: string | number | null | undefined) {
  return displayOptionalDownloadDetail(value, i18n.t);
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

async function openLogFolder() {
  if (busy.value || syncing.value) return;

  busy.value = true;

  try {
    await api.openLogFolder();
    setStatus(i18n.t('status.logFolderOpened'), 'success');
  } catch (error) {
    console.error(error);
    api.reportRendererError({
      level: 'error',
      event: 'open-log-folder-failed',
      error: serializedError(error)
    });
    setStatus(i18n.t('status.logFolderOpenFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function clearDiagnostics() {
  if (busy.value || syncing.value) return;

  busy.value = true;

  try {
    const result = await api.clearDiagnostics();
    if (result.canceled) {
      setStatus(i18n.t('status.clearDiagnosticsCanceled'), 'info');
    } else if (result.failedFiles > 0) {
      setStatus(
        i18n.t('status.clearDiagnosticsPartial', {
          deleted: result.deletedFiles,
          failed: result.failedFiles
        }),
        'warning'
      );
    } else {
      setStatus(i18n.t('status.clearDiagnosticsComplete', { deleted: result.deletedFiles }), 'success');
    }
  } catch (error) {
    console.error(error);
    api.reportRendererError({
      level: 'error',
      event: 'clear-diagnostics-failed',
      error: serializedError(error)
    });
    setStatus(i18n.t('status.clearDiagnosticsFailed', { error: errorMessage(error) }), 'error');
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

onMounted(async function () {
  downloadErrorLog.registerShortcut();
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

onBeforeUnmount(function () {
  clearLocatedDownloadHighlight();
  downloadErrorLog.unregisterShortcut();
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
    >
      <template #status>
        <Transition name="status-toast">
          <div
            v-if="toast"
            class="app-toast app-toast-inline"
            :class="'app-toast-' + toast.tone"
            role="status"
            aria-live="polite"
          >
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
            <button class="app-toast-close" type="button" :aria-label="i18n.t('toast.close')" @click="hideToast">
              ×
            </button>
          </div>
        </Transition>
      </template>
    </TopBar>

    <main
      class="relative h-full min-h-0 overflow-hidden"
      :class="showSharedBrowserTabs ? 'grid min-w-0' : 'block'"
      :style="showSharedBrowserTabs ? sharedBrowserLayoutStyle : null"
    >
      <BrowserTabRail
        v-if="showSharedBrowserTabs"
        :tabs="browser.tabs.value"
        :active-tab-id="browser.activeTabId.value"
        :can-create-tab="browser.canCreateTab.value"
        :compact="false"
        :tab-width="browserTabsWidth"
        @new-tab="newBrowserTab"
        @activate-tab="activateBrowserTab"
        @close-tab="closeBrowserTab"
        @set-tab-muted="setBrowserTabMuted"
        @tab-context-menu="showBrowserTabMenu"
        @resize-tabs="setBrowserTabsWidth"
        @layout-change="browser.scheduleResize"
      />

      <div :class="showSharedBrowserTabs ? 'relative min-h-0 min-w-0 overflow-hidden' : 'contents'">
        <BrowserPanel
          :active="activeView === 'browser'"
          :tabs="browser.tabs.value"
          :active-tab-id="browser.activeTabId.value"
          :can-create-tab="browser.canCreateTab.value"
          :compact="showSharedBrowserTabs ? false : browserTabsCompact"
          :external-rail="showSharedBrowserTabs"
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
          @toggle-download-record-selection="toggleDownloadRecordSelection"
          @refresh-ffmpeg="refreshFfmpegStatus"
          @choose-ffmpeg="chooseFfmpegPath"
          @open-ffmpeg-guide="openFfmpegGuide"
          @download-video="downloadVideo"
          @locate-download="locateDownloadRecord"
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
      </div>

      <SettingsPanel
        :active="activeView === 'settings'"
        :busy="busy || syncing"
        :settings="appSettings"
        :ffmpeg-status="ffmpegStatus"
        :download-root="downloadRoot"
        :database-path="appInfo && appInfo.databasePath"
        :platform="appInfo && appInfo.platform"
        :app-version="appInfo && appInfo.version"
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
        @open-log-folder="openLogFolder"
        @clear-diagnostics="clearDiagnostics"
        @check-updates="checkForUpdates"
        @import-json="importJsonToCollection"
        @export-json="exportCollection"
      />

      <Transition name="app-modal">
        <DownloadErrorLogModal
          v-if="showDownloadErrorLog"
          :records="downloadErrorLogRecords"
          :shown="downloadErrorLogShown"
          :total="downloadErrorLogTotal"
          :can-show-all="downloadErrorLogCanShowAll"
          :show-all="showAllDownloadErrorLog"
          :preview-limit="downloadErrorLogPreviewLimit"
          :error-summary-label="downloadErrorSummaryLabel"
          :failure-phase-label="downloadFailurePhaseLabel"
          :optional-detail="optionalDownloadDetail"
          @close="closeDownloadErrorLog"
          @toggle-show-all="toggleDownloadErrorLogShowAll"
        />
      </Transition>
    </main>
  </div>
</template>
