<script setup>
import { computed, onMounted, ref } from 'vue';
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

var api = useJableApi();
var activeView = ref('browser');
var toast = ref(null);
var busy = ref(false);
var syncing = ref(false);
var browserTabsCompact = ref(false);
var browserTabsWidth = ref(BROWSER_TABS_DEFAULT_WIDTH);
var appInfo = ref(null);
var browser = useBrowserBounds(api, activeView);
var library = useLibraryState(api);
var pendingSaves = [];
var saveFailure = null;
var activeSyncRunId = null;
var toastTimer = null;

var pageRows = computed(function () {
  return library.pageRows.value;
});

var libraryBusy = computed(function () {
  return busy.value || syncing.value;
});

function shouldSkipStatus(text) {
  return !text || text === '準備中' || text === '就緒' || text === '已新增分頁' || text === '開啟影片中…';
}

function statusTone(text) {
  if (/失敗|錯誤|未知/.test(text)) return 'error';
  if (/暫停|未完整|請先/.test(text)) return 'warning';
  if (/完成|已匯出|已匯入/.test(text)) return 'success';
  return 'info';
}

function hideToast() {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  toast.value = null;
}

function setStatus(text) {
  if (shouldSkipStatus(text)) return;

  if (toastTimer) clearTimeout(toastTimer);
  toast.value = {
    text: text,
    tone: statusTone(text)
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

function setBrowserTabsCompact(value) {
  browserTabsCompact.value = !!value;
  localStorage.setItem(BROWSER_TABS_COMPACT_STORAGE_KEY, browserTabsCompact.value ? 'true' : 'false');
  browser.scheduleResize();
}

function clampBrowserTabsWidth(value) {
  var width = Number(value) || BROWSER_TABS_DEFAULT_WIDTH;
  return Math.max(BROWSER_TABS_MIN_WIDTH, Math.min(BROWSER_TABS_MAX_WIDTH, Math.round(width)));
}

function loadBrowserTabsWidth() {
  return clampBrowserTabsWidth(localStorage.getItem(BROWSER_TABS_WIDTH_STORAGE_KEY));
}

function setBrowserTabsWidth(value) {
  browserTabsWidth.value = clampBrowserTabsWidth(value);
  localStorage.setItem(BROWSER_TABS_WIDTH_STORAGE_KEY, String(browserTabsWidth.value));
  browser.scheduleResize();
}

function setActiveView(view) {
  activeView.value = view;
  if (view !== 'browser') browser.hide();
  browser.scheduleResize();
  if (view === 'library') library.refreshVideos();
}

function syncModeName(mode) {
  return mode === 'full' ? '完整同步' : '快速同步';
}

function createSyncRunId(mode, collectionKey) {
  return [mode, collectionKey, Date.now(), Math.random().toString(36).slice(2)].join(':');
}

function currentCollection() {
  return COLLECTIONS[library.activeCollection.value];
}

function collectionUrlPattern(collectionKey) {
  if (collectionKey === 'watch_later') return /\/my\/favourites\/videos-watch-later\/?$/;
  return /\/my\/favourites\/videos\/?$/;
}

function pathFromUrl(value) {
  try {
    return new URL(value).pathname;
  } catch (error) {
    return '';
  }
}

async function openInBrowser(url) {
  if (!url || busy.value || syncing.value) return;

  try {
    setActiveView('browser');
    await browser.loadBrowser(url, false);
  } catch (error) {
    console.error(error);
    setStatus('開啟影片失敗：' + error.message);
  }
}

async function openInNewBrowserTab(url) {
  if (!url || busy.value || syncing.value) return;

  try {
    setActiveView('browser');
    await browser.createTab(url, { active: true });
  } catch (error) {
    console.error(error);
    setStatus('開啟新分頁失敗：' + error.message);
  }
}

function handleLibraryVideoMenuAction(payload) {
  payload = payload || {};

  if (payload.action === 'open-current') {
    openInBrowser(payload.url);
  } else if (payload.action === 'open-new') {
    openInNewBrowserTab(payload.url);
  }
}

function handleBrowserMessage(message) {
  if (message.channel === 'browser-tabs-changed') {
    browser.applyTabsState(message.args[0]);
  }

  if (message.channel === 'browser-error') {
    var errorPayload = message.args[0] || {};
    setStatus('瀏覽器分頁錯誤：' + (errorPayload.message || '未知錯誤'));
  }

  if (message.channel === 'library-video-menu-action') {
    handleLibraryVideoMenuAction(message.args[0]);
  }

  if (message.channel === 'sync-page') {
    var payload = message.args[0];
    if (activeSyncRunId && payload.syncRunId !== activeSyncRunId) return;
    setStatus('同步第 ' + payload.page + ' 頁，' + payload.rows.length + ' 筆');

    var save = api.saveSyncPage(payload).catch(function (error) {
      saveFailure = error;
      throw error;
    });
    pendingSaves.push(save);
  }

  if (message.channel === 'sync-progress') {
    var progress = message.args[0];
    if (activeSyncRunId && progress.syncRunId && progress.syncRunId !== activeSyncRunId) return;
    setStatus('已載入第 ' + progress.page + ' 頁');
  }

  if (message.channel === 'browser-navigation-state') {
    browser.setNavigationState(message.args[0]);
  }

  if (message.channel === 'browser-tabs-compact-mode') {
    var compactPayload = message.args[0] || {};
    setBrowserTabsCompact(!!compactPayload.compact);
  }

  if (message.channel === 'browser-tab-shortcut') {
    setActiveView('browser');
  }
}

function resultStatus(collection, mode, result, finishState) {
  var name = syncModeName(mode);

  if (result.completed === false) {
    if (result.incompleteReason === 'batch-limit') {
      return (
        collection.name +
        ' ' +
        name +
        '已暫停：本批 ' +
        result.totalPages +
        ' 頁、' +
        result.totalRows +
        ' 筆，可繼續完整同步'
      );
    }

    return collection.name + ' ' + name + '未完整完成：' + (result.incompleteReason || '未知原因');
  }

  if (mode === 'full') {
    return (
      collection.name +
      ' 完整同步完成：' +
      result.totalRows +
      ' 筆，隱藏 ' +
      ((finishState && finishState.hidden) || 0) +
      ' 筆缺漏資料'
    );
  }

  var reason = result.stoppedByKnownPage ? '遇到已知頁面後停止' : '已跑完可見分頁';
  return collection.name + ' 快速同步完成：' + result.totalRows + ' 筆，' + reason;
}

async function syncCollection(mode) {
  if (busy.value || syncing.value) return;

  syncing.value = true;
  pendingSaves = [];
  saveFailure = null;
  activeSyncRunId = null;
  var syncTabId = null;

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
    var syncRunId = usedContinuation ? continuation.syncRunId : createSyncRunId(mode, collectionKey);
    var siteOrderOffset = usedContinuation ? continuation.siteOrderOffset : 0;
    var startPage = usedContinuation ? continuation.lastScrapedPage : null;
    var browserUrl = await browser.currentBrowserUrl(syncTabId);

    if (!collectionUrlPattern(collectionKey).test(pathFromUrl(browserUrl))) {
      await browser.setTabLocked(syncTabId, false);
      setStatus('請先在瀏覽器登入 Jable，並確認可開啟「' + collection.name + '」頁面');
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

    setStatus('開始' + syncModeName(mode) + ' ' + collection.name);
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

    setStatus(resultStatus(collection, mode, result, finishState));
  } catch (error) {
    console.error(error);
    setStatus(syncModeName(mode) + '失敗：' + error.message);
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

async function prepareSyncTab(collectionKey, collection, mode, continuation) {
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
    title: '同步：' + collection.name
  });
  var tabId = browser.activeTabId.value;
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
      setStatus('已取消匯出');
      return;
    }

    setStatus('已匯出 ' + ((result && result.filename) || currentCollection().filename));
  } catch (error) {
    console.error(error);
    setStatus('匯出失敗：' + error.message);
  } finally {
    busy.value = false;
  }
}

async function importJsonFile(file) {
  if (!file || busy.value) return;

  busy.value = true;

  try {
    var text = await file.text();
    var resource = JSON.parse(text);
    var result = await api.importJson({
      collectionKey: library.activeCollection.value,
      resource: resource
    });

    library.currentPage.value = 1;
    await library.refreshVideos();
    setStatus('已匯入 ' + result.imported + ' 筆到 ' + currentCollection().name);
  } catch (error) {
    console.error(error);
    setStatus('匯入失敗：' + error.message);
  } finally {
    busy.value = false;
  }
}

async function diagnoseLayout() {
  setStatus(await browser.diagnose());
}

async function selectCollection(collectionKey) {
  await library.selectCollection(collectionKey);
}

async function newBrowserTab() {
  try {
    setActiveView('browser');
    await browser.createTab(DEFAULT_BROWSER_URL, { active: true });
  } catch (error) {
    console.error(error);
    setStatus('新增分頁失敗：' + error.message);
  }
}

async function activateBrowserTab(tabId) {
  try {
    setActiveView('browser');
    await browser.activateTab(tabId);
  } catch (error) {
    console.error(error);
    setStatus('切換分頁失敗：' + error.message);
  }
}

async function closeBrowserTab(tabId) {
  try {
    await browser.closeTab(tabId);
  } catch (error) {
    console.error(error);
    setStatus('關閉分頁失敗：' + error.message);
  }
}

async function setBrowserTabMuted(payload) {
  payload = payload || {};

  try {
    await browser.setTabMuted(payload.tabId, payload.muted);
  } catch (error) {
    console.error(error);
    setStatus('切換分頁靜音失敗：' + error.message);
  }
}

async function showBrowserTabMenu(payload) {
  try {
    await api.showBrowserTabMenu(
      Object.assign({}, payload, {
        compactMode: browserTabsCompact.value
      })
    );
  } catch (error) {
    console.error(error);
    setStatus('開啟分頁選單失敗：' + error.message);
  }
}

async function showLibraryVideoMenu(payload) {
  try {
    await api.showLibraryVideoMenu(payload);
  } catch (error) {
    console.error(error);
    setStatus('開啟影片選單失敗：' + error.message);
  }
}

onMounted(async function () {
  browserTabsCompact.value = loadBrowserTabsCompact();
  browserTabsWidth.value = loadBrowserTabsWidth();
  appInfo.value = await api.getAppInfo();
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
        <button class="app-toast-close" type="button" aria-label="關閉通知" @click="hideToast">×</button>
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
