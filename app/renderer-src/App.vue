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
  ExportResource,
  LibraryVideoMenuAction,
  LibraryVideoMenuPayload,
  SyncMode,
  SyncPagePayload,
  SyncProgressPayload,
  SyncQueueProgressPayload,
  SyncResult,
  SyncState,
  VideoRow
} from '../types/jable';

const SYNC_RETURNING_NOTICE_DELAY_MS = 450;
type ToastState = {
  text: string;
  tone: 'error' | 'warning' | 'success' | 'info';
  showQueueProgress?: boolean;
};

const api = useJableApi();
const i18n = useI18n();
const activeView = ref<AppView>('browser');
const toast = ref<ToastState | null>(null);
const syncQueueProgress = ref<SyncQueueProgressPayload | null>(null);
const busy = ref(false);
const syncing = ref(false);
const browserTabsCompact = ref(false);
const browserTabsWidth = ref(BROWSER_TABS_DEFAULT_WIDTH);
const appInfo = ref<AppInfo | null>(null);
const appSettings = ref<AppSettings>(Object.assign({}, DEFAULT_APP_SETTINGS));
const browser = useBrowserBounds(api, activeView);
const library = useLibraryState(api);
let activeSyncRunId: string | null = null;
let toastTimer: number | null = null;
let mainLocaleSynced = false;

const pageRows = computed<VideoRow[]>(function () {
  return library.pageRows.value;
});

const libraryBusy = computed(function () {
  return busy.value || syncing.value;
});

const syncQueueProgressProcessed = computed(function () {
  const progress = syncQueueProgress.value;
  if (!progress) return 0;
  if (progress.phase === 'complete') return progress.total;
  return Math.max(0, Math.min(progress.total, progress.processed || progress.applied || 0));
});

const syncQueueProgressPercent = computed(function () {
  const progress = syncQueueProgress.value;
  if (!progress || progress.total <= 0) return 0;
  return Math.round((syncQueueProgressProcessed.value / progress.total) * 100);
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldSkipStatus(text: string) {
  return (
    !text ||
    text === '準備中' ||
    text === '就緒' ||
    text === '已新增分頁' ||
    text === '開啟影片中…' ||
    text === 'Preparing...' ||
    text === 'Ready' ||
    text === 'New tab added' ||
    text === 'Opening video...'
  );
}

function statusTone(text: string) {
  if (/失敗|錯誤|未知|failed|error|unknown/i.test(text)) return 'error';
  if (/暫停|未完整|請先|paused|did not complete|please log in/i.test(text)) return 'warning';
  if (/完成|已匯出|已匯入|complete|exported|imported/i.test(text)) return 'success';
  return 'info';
}

function hideToast() {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  toast.value = null;
}

function setStatus(
  text: string,
  tone?: 'error' | 'warning' | 'success' | 'info',
  options?: { sticky?: boolean; queueProgress?: boolean }
) {
  if (shouldSkipStatus(text)) return;

  if (toastTimer) clearTimeout(toastTimer);
  toast.value = {
    text: text,
    tone: tone || statusTone(text),
    showQueueProgress: Boolean(options && options.queueProgress)
  };
  if (options && options.sticky) {
    toastTimer = null;
    return;
  }

  toastTimer = setTimeout(function () {
    toast.value = null;
    toastTimer = null;
  }, 4200);
}

function waitForSyncReturningNotice() {
  return new Promise(function (resolve) {
    setTimeout(resolve, SYNC_RETURNING_NOTICE_DELAY_MS);
  });
}

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

function syncModeName(mode: SyncMode) {
  return mode === 'full' ? i18n.t('sync.full') : i18n.t('sync.quick');
}

function createSyncRunId(mode: SyncMode, collectionKey: CollectionKey) {
  return [mode, collectionKey, Date.now(), Math.random().toString(36).slice(2)].join(':');
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

function updateSyncQueueProgress(progress: SyncQueueProgressPayload) {
  const collection = collectionName(progress.collectionKey);
  const processed = Math.max(0, Math.min(progress.total, progress.processed || 0));

  if (progress.phase === 'complete') {
    syncQueueProgress.value = null;
    setStatus(
      i18n.t('status.syncQueueProcessed', {
        collection: collection,
        applied: progress.applied || 0,
        failed: progress.failed || 0
      }),
      progress.failed ? 'warning' : 'success'
    );
    return;
  }

  syncQueueProgress.value = progress;
  setStatus(
    i18n.t('status.syncQueueProgress', {
      collection: collection,
      processed: processed,
      total: progress.total
    }),
    'info',
    { sticky: true, queueProgress: true }
  );
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
    if (activeSyncRunId && payload.syncRunId !== activeSyncRunId) return;
    setStatus(i18n.t('status.syncPage', { page: payload.page, count: payload.rows.length }));
  }

  if (message.channel === 'sync-progress') {
    const progress = message.args[0] as SyncProgressPayload;
    if (activeSyncRunId && progress.syncRunId && progress.syncRunId !== activeSyncRunId) return;
    if (progress.message === 'ajax-page-retry') {
      setStatus(
        i18n.t('status.syncAjaxRetry', {
          page: progress.page,
          attempt: progress.attempt || 1,
          maxRetries: progress.maxRetries || 1,
          delay: Math.round((progress.delayMs || 0) / 1000),
          reason: progress.reason || i18n.t('status.unknownError')
        }),
        'warning'
      );
      return;
    }
    if (progress.message === 'ajax-window-fallback') {
      setStatus(
        i18n.t('status.syncAjaxFallback', {
          reason: progress.reason || i18n.t('status.unknownError')
        }),
        'warning'
      );
      return;
    }
    setStatus(i18n.t('status.syncProgress', { page: progress.page }));
  }

  if (message.channel === 'sync-queue-progress') {
    const progress = message.args[0] as SyncQueueProgressPayload;
    if (activeSyncRunId && progress.syncRunId && progress.syncRunId !== activeSyncRunId) return;

    updateSyncQueueProgress(progress);
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

function resultStatus(
  collectionKey: CollectionKey,
  mode: SyncMode,
  result: SyncResult,
  finishState: SyncState,
  visibleRows?: number
) {
  const name = syncModeName(mode);
  const collection = collectionName(collectionKey);
  const queuedFailures = result.queuedOperationsFailed || 0;
  const queuedSkipped = result.queuedOperationsSkipped || 0;
  const totalRows = typeof visibleRows === 'number' ? visibleRows : result.totalRows;

  function withAjaxFallback(status: string) {
    if (!result.ajaxFallbackReason) return status;

    return i18n.t('status.syncAjaxFallbackResult', {
      status: status,
      reason: result.ajaxFallbackReason,
      retries: result.ajaxRetryCount || 0
    });
  }

  if (queuedFailures > 0) {
    return withAjaxFallback(
      i18n.t('status.syncQueuedOperationsFailed', {
        collection: collection,
        count: queuedFailures
      })
    );
  }

  if (queuedSkipped > 0) {
    return withAjaxFallback(
      i18n.t('status.syncQueuedOperationsSkipped', {
        collection: collection,
        count: queuedSkipped
      })
    );
  }

  if (result.completed === false) {
    if (result.incompleteReason === 'login-required') {
      return i18n.t('status.loginRequired', { collection: collection });
    }

    if (result.incompleteReason === 'first-page-unavailable' || result.incompleteReason === 'first-page-unchanged') {
      return i18n.t('status.firstPageRequired', { collection: collection, mode: name });
    }

    if (result.incompleteReason === 'collection-mutated-during-sync') {
      return i18n.t('status.syncChangedDuringRun', {
        collection: collection,
        mode: name,
        count: (finishState && finishState.mutationsReconciled) || 0
      });
    }

    if (result.incompleteReason === 'batch-limit') {
      return i18n.t('status.fullSyncPaused', {
        collection: collection,
        mode: name,
        pages: result.totalPages,
        rows: result.totalRows
      });
    }

    if (result.ajaxFallbackReason) {
      return i18n.t('status.syncIncompleteAfterAjaxFallback', {
        collection: collection,
        mode: name,
        reason: result.incompleteReason || i18n.t('status.unknownError'),
        ajaxReason: result.ajaxFallbackReason
      });
    }

    return i18n.t('status.syncIncomplete', {
      collection: collection,
      mode: name,
      reason: result.incompleteReason || i18n.t('status.unknownError')
    });
  }

  if (mode === 'full') {
    return withAjaxFallback(
      i18n.t('status.fullSyncComplete', {
        collection: collection,
        rows: totalRows,
        hidden: (finishState && finishState.hidden) || 0
      })
    );
  }

  const reason = result.stoppedByKnownPage
    ? i18n.t('status.stoppedByKnownPage')
    : i18n.t('status.finishedVisiblePages');
  return withAjaxFallback(
    i18n.t('status.quickSyncComplete', {
      collection: collection,
      rows: totalRows,
      reason: reason
    })
  );
}

async function syncCollection(mode: SyncMode) {
  if (busy.value || syncing.value) return;

  syncing.value = true;
  activeSyncRunId = null;
  syncQueueProgress.value = null;
  let syncTabId: string | null = null;

  try {
    const collectionKey = library.activeCollection.value;
    const continuation =
      mode === 'full' &&
      library.fullSyncContinuation.value &&
      library.fullSyncContinuation.value.collectionKey === collectionKey
        ? library.fullSyncContinuation.value
        : null;
    const usedContinuation = Boolean(continuation && continuation.tabId);
    syncTabId = usedContinuation && continuation ? continuation.tabId : null;
    const syncRunId = usedContinuation && continuation ? continuation.syncRunId : createSyncRunId(mode, collectionKey);
    const siteOrderOffset = usedContinuation && continuation ? continuation.siteOrderOffset : 0;
    const startPage = usedContinuation && continuation ? continuation.lastScrapedPage : null;

    const options = {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      siteOrderOffset: siteOrderOffset,
      startPage: startPage,
      stopOnKnownPage: mode === 'quick',
      batchLimit: null
    };

    setStatus(i18n.t('status.syncStart', { mode: syncModeName(mode), collection: collectionName(collectionKey) }));
    activeSyncRunId = syncRunId;
    const result = await api.syncBrowserCollection({
      tabId: syncTabId,
      options: options
    });
    syncTabId = result.syncWorkerId || syncTabId;
    setStatus(i18n.t('status.syncFinalizingLocalData', { collection: collectionName(collectionKey) }), 'info');

    const finishState = await api.finishSync({
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      result: result
    });

    if (mode === 'full' && result.completed === false && result.incompleteReason === 'batch-limit') {
      library.fullSyncContinuation.value = {
        collectionKey: collectionKey,
        syncRunId: syncRunId,
        tabId: result.syncWorkerId || syncTabId || '',
        siteOrderOffset: siteOrderOffset + result.totalRows,
        lastScrapedPage: result.lastScrapedPage
      };
    } else if (mode === 'full') {
      library.fullSyncContinuation.value = null;
    }

    const finalVisibleRows = await api.countVideos({ collectionKey: collectionKey });
    library.currentPage.value = 1;
    setStatus(i18n.t('status.syncReturningLibrary', { collection: collectionName(collectionKey) }), 'info');
    await waitForSyncReturningNotice();
    setActiveView('library');
    await library.refreshVideos();
    await library.refreshPendingGroups();

    setStatus(
      resultStatus(collectionKey, mode, result, finishState, finalVisibleRows),
      result.queuedOperationsFailed || result.queuedOperationsSkipped || result.ajaxFallbackReason
        ? 'warning'
        : undefined,
      {
        sticky: result.completed === false
      }
    );
  } catch (error) {
    console.error(error);
    syncQueueProgress.value = null;
    setStatus(i18n.t('status.syncFailed', { mode: syncModeName(mode), error: errorMessage(error) }), 'error');
  } finally {
    activeSyncRunId = null;
    syncing.value = false;
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

async function retryPendingRemoteOperationGroup(groupId: string) {
  busy.value = true;
  try {
    const result = await api.retryPendingRemoteOperationGroup(groupId);
    await library.refreshPendingGroups();
    if (result.resolved) {
      await library.refreshVideos();
      setStatus(i18n.t('status.pendingRemoteResolved'), 'success');
    } else {
      setStatus(
        i18n.t('status.pendingRemoteRetryFailed', { error: result.error || i18n.t('status.unknownError') }),
        'error',
        {
          sticky: true
        }
      );
    }
  } catch (error) {
    setStatus(i18n.t('status.pendingRemoteRetryFailed', { error: errorMessage(error) }), 'error', { sticky: true });
  } finally {
    busy.value = false;
  }
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

function changeLocale(locale: string) {
  i18n.setLocale(locale);
}

function resetBrowserTabsWidth() {
  setBrowserTabsWidth(BROWSER_TABS_DEFAULT_WIDTH);
  setStatus(i18n.t('status.settingsSaved'), 'success');
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
  browserTabsWidth.value = loadBrowserTabsWidth();
  appInfo.value = await api.getAppInfo();
  applyAppSettings(await api.getSettings());
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
        :full-sync-label="library.fullSyncButtonLabel.value"
        :pending-count="library.pendingCount.value"
        :pending-groups="library.pendingGroups.value"
        :search="library.search.value"
        :search-mode="library.searchMode.value"
        :sort="library.sort.value"
        :direction="library.direction.value"
        :count-label="library.countLabel.value"
        :page-label="library.pageLabel.value"
        :rows="pageRows"
        :current-page="library.currentPage.value"
        :total-pages="library.totalPages.value"
        @select-tab="selectLibraryTab"
        @quick-sync="syncCollection('quick')"
        @full-sync="syncCollection('full')"
        @update:search="library.search.value = $event"
        @update:search-mode="library.searchMode.value = $event"
        @update:sort="library.sort.value = $event"
        @update:direction="library.direction.value = $event"
        @prev-page="library.goToPage(library.currentPage.value - 1)"
        @next-page="library.goToPage(library.currentPage.value + 1)"
        @go-page="library.goToPage($event)"
        @retry-pending-group="retryPendingRemoteOperationGroup"
        @open-video="openInBrowser"
        @open-video-new-tab="openInNewBrowserTab"
        @video-context-menu="showLibraryVideoMenu"
      />

      <SettingsPanel
        :active="activeView === 'settings'"
        :busy="busy || syncing"
        :settings="appSettings"
        :database-path="appInfo && appInfo.databasePath"
        @update-settings="updateAppSettings"
        @change-locale="changeLocale"
        @reset-tabs-width="resetBrowserTabsWidth"
        @import-json="importJsonToCollection"
        @export-json="exportCollection"
      />
    </main>
  </div>
</template>
