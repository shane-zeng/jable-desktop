<script setup>
import { computed, onMounted, ref } from 'vue';
import BrowserPanel from './components/BrowserPanel.vue';
import LibraryPanel from './components/LibraryPanel.vue';
import TopBar from './components/TopBar.vue';
import {
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
var theme = ref('system');
var appInfo = ref(null);
var browser = useBrowserBounds(api, activeView);
var library = useLibraryState(api);
var pendingSaves = [];
var saveFailure = null;

var pageRows = computed(function () {
  return library.pageRows.value;
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

function setActiveView(view) {
  activeView.value = view;
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
  if (!url || busy.value) return;

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
  if (message.channel === 'sync-page') {
    var payload = message.args[0];
    setStatus('同步第 ' + payload.page + ' 頁，' + payload.rows.length + ' 筆');

    var save = api.saveSyncPage(payload).catch(function (error) {
      saveFailure = error;
      throw error;
    });
    pendingSaves.push(save);
  }

  if (message.channel === 'sync-progress') {
    var progress = message.args[0];
    setStatus('已載入第 ' + progress.page + ' 頁');
  }

  if (message.channel === 'browser-navigation-state') {
    browser.setNavigationState(message.args[0]);
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

async function ensureCollectionStartPage(collectionKey, collection, mode, continuation) {
  if (mode === 'full' && continuation) {
    var currentUrl = await browser.currentBrowserUrl();
    if (collectionUrlPattern(collectionKey).test(pathFromUrl(currentUrl))) {
      setActiveView('browser');
      return true;
    }
  }

  setActiveView('browser');
  await browser.loadBrowser(collection.url, true);
  return false;
}

async function syncCollection(mode) {
  if (busy.value) return;

  busy.value = true;
  pendingSaves = [];
  saveFailure = null;

  try {
    var collectionKey = library.activeCollection.value;
    var collection = currentCollection();
    var continuation = mode === 'full' &&
      library.fullSyncContinuation.value &&
      library.fullSyncContinuation.value.collectionKey === collectionKey
      ? library.fullSyncContinuation.value
      : null;
    var usedContinuation = await ensureCollectionStartPage(collectionKey, collection, mode, continuation);
    var syncRunId = usedContinuation ? continuation.syncRunId : createSyncRunId(mode, collectionKey);
    var siteOrderOffset = usedContinuation ? continuation.siteOrderOffset : 0;
    var startPage = usedContinuation ? continuation.lastScrapedPage : null;
    var browserUrl = await browser.currentBrowserUrl();

    if (!collectionUrlPattern(collectionKey).test(pathFromUrl(browserUrl))) {
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
    setActiveView('browser');
    var result = await api.syncBrowserCollection(options);
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
        siteOrderOffset: siteOrderOffset + result.totalRows,
        lastScrapedPage: result.lastScrapedPage
      };
    } else if (mode === 'full') {
      library.fullSyncContinuation.value = null;
    }

    library.currentPage.value = 1;
    setActiveView('library');
    await library.refreshVideos();

    setStatus(resultStatus(collection, mode, result, finishState));
  } catch (error) {
    console.error(error);
    setStatus(syncModeName(mode) + '失敗：' + error.message);
  } finally {
    busy.value = false;
  }
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

async function clearSession() {
  if (busy.value) return;

  busy.value = true;

  try {
    await api.clearJableSession();
    await browser.loadBrowser(DEFAULT_BROWSER_URL, true);
    setStatus('已清除 Jable session');
  } catch (error) {
    console.error(error);
    setStatus('清除登入狀態失敗：' + error.message);
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

onMounted(async function () {
  applyTheme(loadTheme());
  appInfo.value = await api.getAppInfo();
  api.onBrowserMessage(handleBrowserMessage);
  setActiveView('browser');
  browser.scheduleResize();
  await library.refreshVideos();
  await browser.loadBrowser(DEFAULT_BROWSER_URL, false);
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
      @clear-session="clearSession"
    />

    <main class="relative block h-full min-h-0 overflow-hidden">
      <BrowserPanel
        :active="activeView === 'browser'"
        @host="browser.setHost"
      />

      <LibraryPanel
        :active="activeView === 'library'"
        :active-collection="library.activeCollection.value"
        :busy="busy"
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
