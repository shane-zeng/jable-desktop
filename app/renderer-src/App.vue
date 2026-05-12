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
  FULL_SYNC_BATCH_LIMIT,
  THEME_STORAGE_KEY
} from './constants';
import { useBrowserBounds } from './composables/useBrowserBounds';
import { useJableApi } from './composables/useJableApi';
import { useLibraryState } from './composables/useLibraryState';

var api = useJableApi();
var activeView = ref('browser');
var status = ref('準備中');
var busy = ref(false);
var syncing = ref(false);
var theme = ref('system');
var browserTabsCompact = ref(false);
var browserTabsWidth = ref(BROWSER_TABS_DEFAULT_WIDTH);
var appInfo = ref(null);
var browser = useBrowserBounds(api, activeView);
var library = useLibraryState(api);
var pendingSaves = [];
var saveFailure = null;
var activeSyncRunId = null;

var pageRows = computed(function () {
  return library.pageRows.value;
});

var libraryBusy = computed(function () {
  return busy.value || syncing.value;
});

function setStatus(text) {
  status.value = text;
}

function loadTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) || 'system';
}

function applyTheme(nextTheme) {
  var value = nextTheme === 'dark' || nextTheme === 'light' ? nextTheme : 'system';
  theme.value = value;
  document.documentElement.setAttribute('data-theme', value);
  localStorage.setItem(THEME_STORAGE_KEY, value);
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
  return [
    mode,
    collectionKey,
    Date.now(),
    Math.random().toString(36).slice(2)
  ].join(':');
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
    setStatus('開啟影片中…');
    await browser.loadBrowser(url, false);
    setStatus('就緒');
  } catch (error) {
    console.error(error);
    setStatus('開啟影片失敗：' + error.message);
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
}

function resultStatus(collection, mode, result, finishState) {
  var name = syncModeName(mode);

  if (result.completed === false) {
    if (result.incompleteReason === 'batch-limit') {
      return collection.name + ' ' + name + '已暫停：本批 ' + result.totalPages +
        ' 頁、' + result.totalRows + ' 筆，可繼續完整同步';
    }

    return collection.name + ' ' + name + '未完整完成：' + (result.incompleteReason || '未知原因');
  }

  if (mode === 'full') {
    return collection.name + ' 完整同步完成：' + result.totalRows + ' 筆，隱藏 ' +
      ((finishState && finishState.hidden) || 0) + ' 筆缺漏資料';
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
    var continuation = mode === 'full' &&
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

    var knownUrls = await api.getCollectionUrls(collectionKey);
    var options = {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      siteOrderOffset: siteOrderOffset,
      startPage: startPage,
      knownUrls: knownUrls,
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

function downloadJson(filename, data) {
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

async function exportActiveCollection() {
  if (busy.value) return;

  try {
    var resource = await api.exportJson(library.activeCollection.value);
    downloadJson(currentCollection().filename, resource);
    setStatus('已匯出 ' + currentCollection().filename);
  } catch (error) {
    console.error(error);
    setStatus('匯出失敗：' + error.message);
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
    setStatus('已新增分頁');
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

async function showBrowserTabMenu(payload) {
  try {
    await api.showBrowserTabMenu(Object.assign({}, payload, {
      compactMode: browserTabsCompact.value
    }));
  } catch (error) {
    console.error(error);
    setStatus('開啟分頁選單失敗：' + error.message);
  }
}

onMounted(async function () {
  applyTheme(loadTheme());
  browserTabsCompact.value = loadBrowserTabsCompact();
  browserTabsWidth.value = loadBrowserTabsWidth();
  appInfo.value = await api.getAppInfo();
  api.onBrowserMessage(handleBrowserMessage);
  setActiveView('browser');
  browser.scheduleResize();
  await browser.refreshTabs();
  await library.refreshVideos();
  browser.scheduleResize();
  setStatus('就緒');
});
</script>

<template>
  <div class="app-shell">
    <TopBar
      :active-view="activeView"
      :busy="busy"
      :navigation="browser.navigation.value"
      :status="status"
      :theme="theme"
      @set-view="setActiveView"
      @update:theme="applyTheme"
      @back="browser.goBack"
      @forward="browser.goForward"
      @reload="browser.reload"
      @diagnose="diagnoseLayout"
    />

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
      />
    </main>
  </div>
</template>
