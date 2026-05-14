<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import BrowserPanel from './components/BrowserPanel.vue';
import LibraryPanel from './components/LibraryPanel.vue';
import TopBar from './components/TopBar.vue';
import {
  BROWSER_TABS_DEFAULT_WIDTH,
  BROWSER_TABS_COMPACT_STORAGE_KEY,
  BROWSER_TABS_MAX_WIDTH,
  BROWSER_TABS_MIN_WIDTH,
  BROWSER_TABS_WIDTH_STORAGE_KEY,
  COLLECTIONS,
  DEFAULT_BROWSER_URL,
  FULL_SYNC_BATCH_LIMIT
} from './constants';
import { useBrowserBounds } from './composables/useBrowserBounds';
import { useJableApi } from './composables/useJableApi';
import { useLibraryState } from './composables/useLibraryState';
import { useI18n } from './i18n';
import type {
  AppInfo,
  AppView,
  BrowserMessage,
  BrowserNavigationState,
  BrowserTabMenuPayload,
  BrowserTabsState,
  CollectionDefinition,
  CollectionKey,
  CollectionToggleResult,
  ExportResource,
  FullSyncContinuation,
  LibraryVideoMenuAction,
  LibraryVideoMenuPayload,
  SyncMode,
  SyncPagePayload,
  SyncProgressPayload,
  SyncResult,
  SyncState,
  VideoRow
} from '../types/jable';

var api = useJableApi();
var i18n = useI18n();
var activeView = ref<AppView>('browser');
var toast = ref<{ text: string; tone: 'error' | 'warning' | 'success' | 'info' } | null>(null);
var busy = ref(false);
var syncing = ref(false);
var browserTabsCompact = ref(false);
var browserTabsWidth = ref(BROWSER_TABS_DEFAULT_WIDTH);
var appInfo = ref<AppInfo | null>(null);
var browser = useBrowserBounds(api, activeView);
var library = useLibraryState(api);
var pendingSaves: Promise<unknown>[] = [];
var saveFailure: unknown = null;
var activeSyncRunId: string | null = null;
var toastTimer: number | null = null;
var mainLocaleSynced = false;

var pageRows = computed<VideoRow[]>(function () {
  return library.pageRows.value;
});

var libraryBusy = computed(function () {
  return busy.value || syncing.value;
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

function setStatus(text: string, tone?: 'error' | 'warning' | 'success' | 'info') {
  if (shouldSkipStatus(text)) return;

  if (toastTimer) clearTimeout(toastTimer);
  toast.value = {
    text: text,
    tone: tone || statusTone(text)
  };
  toastTimer = setTimeout(function () {
    toast.value = null;
    toastTimer = null;
  }, 4200);
}

function loadBrowserTabsCompact() {
  var value = localStorage.getItem(BROWSER_TABS_COMPACT_STORAGE_KEY);
  if (value !== null) return value === 'true';

  return localStorage.getItem('jable-desktop:browser-tabs-collapsed') === 'true';
}

function setBrowserTabsCompact(value: boolean) {
  browserTabsCompact.value = !!value;
  localStorage.setItem(BROWSER_TABS_COMPACT_STORAGE_KEY, browserTabsCompact.value ? 'true' : 'false');
  browser.scheduleResize();
}

function clampBrowserTabsWidth(value: unknown) {
  var width = Number(value) || BROWSER_TABS_DEFAULT_WIDTH;
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

function currentCollection(): CollectionDefinition {
  return COLLECTIONS[library.activeCollection.value];
}

function collectionName(collectionKey: CollectionKey) {
  return i18n.t('collections.' + collectionKey);
}

function collectionUrlPattern(collectionKey: CollectionKey) {
  if (collectionKey === 'watch_later') return /\/my\/favourites\/videos-watch-later\/?$/;
  return /\/my\/favourites\/videos\/?$/;
}

function pathFromUrl(value: string) {
  try {
    return new URL(value).pathname;
  } catch (error) {
    return '';
  }
}

async function openInBrowser(url: string) {
  if (!url || busy.value || syncing.value) return;

  try {
    setActiveView('browser');
    await browser.loadBrowser(url, false);
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.browserOpenFailed', { error: errorMessage(error) }), 'error');
  }
}

async function openInNewBrowserTab(url: string) {
  if (!url || busy.value || syncing.value) return;

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
  var name = collectionName(payload.collectionKey);

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

  if (message.channel === 'browser-error') {
    var errorPayload = (message.args[0] || {}) as { message?: string };
    setStatus(
      i18n.t('status.browserTabError', { error: errorPayload.message || i18n.t('status.unknownError') }),
      'error'
    );
  }

  if (message.channel === 'library-video-menu-action') {
    handleLibraryVideoMenuAction(message.args[0] as LibraryVideoMenuAction);
  }

  if (message.channel === 'sync-page') {
    var payload = message.args[0] as SyncPagePayload;
    if (activeSyncRunId && payload.syncRunId !== activeSyncRunId) return;
    setStatus(i18n.t('status.syncPage', { page: payload.page, count: payload.rows.length }));

    var save = api.saveSyncPage(payload).catch(function (error) {
      saveFailure = error;
      throw error;
    });
    pendingSaves.push(save);
  }

  if (message.channel === 'sync-progress') {
    var progress = message.args[0] as SyncProgressPayload;
    if (activeSyncRunId && progress.syncRunId && progress.syncRunId !== activeSyncRunId) return;
    setStatus(i18n.t('status.syncProgress', { page: progress.page }));
  }

  if (message.channel === 'collection-toggle') {
    var togglePayload = message.args[0] as CollectionToggleResult;
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
    var compactPayload = (message.args[0] || {}) as { compact?: boolean };
    setBrowserTabsCompact(!!compactPayload.compact);
  }

  if (message.channel === 'browser-tabs-compact-toggle-shortcut' && activeView.value === 'browser') {
    setBrowserTabsCompact(!browserTabsCompact.value);
  }

  if (message.channel === 'browser-tab-shortcut') {
    setActiveView('browser');
  }
}

function resultStatus(collectionKey: CollectionKey, mode: SyncMode, result: SyncResult, finishState: SyncState) {
  var name = syncModeName(mode);
  var collection = collectionName(collectionKey);

  if (result.completed === false) {
    if (result.incompleteReason === 'batch-limit') {
      return i18n.t('status.fullSyncPaused', {
        collection: collection,
        mode: name,
        pages: result.totalPages,
        rows: result.totalRows
      });
    }

    return i18n.t('status.syncIncomplete', {
      collection: collection,
      mode: name,
      reason: result.incompleteReason || i18n.t('status.unknownError')
    });
  }

  if (mode === 'full') {
    return i18n.t('status.fullSyncComplete', {
      collection: collection,
      rows: result.totalRows,
      hidden: (finishState && finishState.hidden) || 0
    });
  }

  var reason = result.stoppedByKnownPage ? i18n.t('status.stoppedByKnownPage') : i18n.t('status.finishedVisiblePages');
  return i18n.t('status.quickSyncComplete', {
    collection: collection,
    rows: result.totalRows,
    reason: reason
  });
}

async function syncCollection(mode: SyncMode) {
  if (busy.value || syncing.value) return;

  syncing.value = true;
  pendingSaves = [];
  saveFailure = null;
  activeSyncRunId = null;
  var syncTabId: string | null = null;

  try {
    var collectionKey = library.activeCollection.value;
    var collection = currentCollection();
    var continuation =
      mode === 'full' &&
      library.fullSyncContinuation.value &&
      library.fullSyncContinuation.value.collectionKey === collectionKey
        ? library.fullSyncContinuation.value
        : null;
    var syncTab = await prepareSyncTab(collectionKey, collection, mode, continuation);
    syncTabId = syncTab.tabId;
    var usedContinuation = syncTab.usedContinuation;
    var syncRunId = usedContinuation && continuation ? continuation.syncRunId : createSyncRunId(mode, collectionKey);
    var siteOrderOffset = usedContinuation && continuation ? continuation.siteOrderOffset : 0;
    var startPage = usedContinuation && continuation ? continuation.lastScrapedPage : null;
    var browserUrl = await browser.currentBrowserUrl(syncTabId);

    if (!collectionUrlPattern(collectionKey).test(pathFromUrl(browserUrl))) {
      await browser.setTabLocked(syncTabId, false);
      setStatus(i18n.t('status.loginRequired', { collection: collectionName(collectionKey) }), 'warning');
      return;
    }

    var options = {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      siteOrderOffset: siteOrderOffset,
      startPage: startPage,
      stopOnKnownPage: mode === 'quick',
      batchLimit: mode === 'full' ? FULL_SYNC_BATCH_LIMIT : null
    };

    setStatus(i18n.t('status.syncStart', { mode: syncModeName(mode), collection: collectionName(collectionKey) }));
    activeSyncRunId = syncRunId;
    var result = await api.syncBrowserCollection({
      tabId: syncTabId,
      options: options
    });
    await Promise.all(pendingSaves);

    if (saveFailure) throw saveFailure;

    var finishState = await api.finishSync({
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      result: result
    });

    if (mode === 'full' && result.completed === false && result.incompleteReason === 'batch-limit') {
      library.fullSyncContinuation.value = {
        collectionKey: collectionKey,
        syncRunId: syncRunId,
        tabId: syncTabId,
        siteOrderOffset: siteOrderOffset + result.totalRows,
        lastScrapedPage: result.lastScrapedPage
      };
    } else if (mode === 'full') {
      library.fullSyncContinuation.value = null;
    }

    if (!(mode === 'full' && result.completed === false && result.incompleteReason === 'batch-limit')) {
      await browser.setTabLocked(syncTabId, false);
    }

    library.currentPage.value = 1;
    setActiveView('library');
    await library.refreshVideos();

    setStatus(resultStatus(collectionKey, mode, result, finishState));
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.syncFailed', { mode: syncModeName(mode), error: errorMessage(error) }), 'error');
    if (syncTabId) {
      try {
        await browser.setTabLocked(syncTabId, false);
      } catch (unlockError) {}
    }
  } finally {
    activeSyncRunId = null;
    syncing.value = false;
  }
}

async function prepareSyncTab(
  collectionKey: CollectionKey,
  collection: CollectionDefinition,
  mode: SyncMode,
  continuation: FullSyncContinuation | null
) {
  setActiveView('browser');

  if (mode === 'full' && continuation && continuation.tabId && browser.hasTab(continuation.tabId)) {
    await browser.activateTab(continuation.tabId);
    await browser.setTabLocked(continuation.tabId, true);

    var continuationUrl = await browser.currentBrowserUrl(continuation.tabId);
    if (collectionUrlPattern(collectionKey).test(pathFromUrl(continuationUrl))) {
      return {
        tabId: continuation.tabId,
        usedContinuation: true
      };
    }

    await browser.setTabLocked(continuation.tabId, false);
    library.fullSyncContinuation.value = null;
  }

  var existingSyncTab = browser.firstUnlockedSyncTab();
  if (existingSyncTab) {
    await browser.activateTab(existingSyncTab.id);
    await browser.loadBrowser(collection.url, true, existingSyncTab.id);
    await browser.setTabLocked(existingSyncTab.id, true);
    return {
      tabId: existingSyncTab.id,
      usedContinuation: false
    };
  }

  await browser.createTab(null, {
    active: true,
    kind: 'sync',
    title: i18n.t('browser.syncTabTitle', { collection: collectionName(collectionKey) })
  });
  var tabId = browser.activeTabId.value;
  if (!tabId) throw new Error(i18n.t('status.createSyncTabFailed'));
  await browser.loadBrowser(collection.url, true, tabId);
  await browser.setTabLocked(tabId, true);

  return {
    tabId: tabId,
    usedContinuation: false
  };
}

async function exportActiveCollection() {
  if (busy.value || syncing.value) return;

  busy.value = true;

  try {
    var result = await api.exportJsonFile(library.activeCollection.value);

    if (result && result.canceled) {
      setStatus(i18n.t('status.exportCanceled'));
      return;
    }

    setStatus(
      i18n.t('status.exported', { filename: (result && result.filename) || currentCollection().filename }),
      'success'
    );
  } catch (error) {
    console.error(error);
    setStatus(i18n.t('status.exportFailed', { error: errorMessage(error) }), 'error');
  } finally {
    busy.value = false;
  }
}

async function importJsonFile(file: File | null) {
  if (!file || busy.value) return;

  busy.value = true;

  try {
    var text = await file.text();
    var resource = JSON.parse(text);
    var result = await api.importJson({
      collectionKey: library.activeCollection.value,
      resource: resource as ExportResource
    });

    library.currentPage.value = 1;
    await library.refreshVideos();
    setStatus(
      i18n.t('status.imported', { count: result.imported, collection: collectionName(library.activeCollection.value) }),
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

async function selectCollection(collectionKey: string) {
  await library.selectCollection(collectionKey);
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
  browserTabsCompact.value = loadBrowserTabsCompact();
  browserTabsWidth.value = loadBrowserTabsWidth();
  appInfo.value = await api.getAppInfo();
  i18n.initializeLocale(appInfo.value.systemLocale || appInfo.value.locale);
  await syncMainLocale(i18n.locale.value);
  mainLocaleSynced = true;
  api.onBrowserMessage(handleBrowserMessage);
  setActiveView('browser');
  browser.scheduleResize();
  await browser.refreshTabs();
  await library.refreshVideos();
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
        <span class="min-w-0 flex-1">{{ toast.text }}</span>
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
        :busy="libraryBusy"
        :full-sync-label="library.fullSyncButtonLabel.value"
        :search="library.search.value"
        :search-mode="library.searchMode.value"
        :sort="library.sort.value"
        :direction="library.direction.value"
        :count-label="library.countLabel.value"
        :page-label="library.pageLabel.value"
        :rows="pageRows"
        :current-page="library.currentPage.value"
        :total-pages="library.totalPages.value"
        @select-collection="selectCollection"
        @quick-sync="syncCollection('quick')"
        @full-sync="syncCollection('full')"
        @import-file="importJsonFile"
        @export-json="exportActiveCollection"
        @update:search="library.search.value = $event"
        @update:search-mode="library.searchMode.value = $event"
        @update:sort="library.sort.value = $event"
        @update:direction="library.direction.value = $event"
        @prev-page="library.goToPage(library.currentPage.value - 1)"
        @next-page="library.goToPage(library.currentPage.value + 1)"
        @open-video="openInBrowser"
        @open-video-new-tab="openInNewBrowserTab"
        @video-context-menu="showLibraryVideoMenu"
      />
    </main>
  </div>
</template>
