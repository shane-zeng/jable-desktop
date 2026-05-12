'use strict';

var PAGE_SIZE = 24;
var FULL_SYNC_BATCH_LIMIT = 100;
var DEFAULT_BROWSER_URL = 'https://jable.tv/';
var THEME_STORAGE_KEY = 'jable-desktop:theme';

var COLLECTIONS = {
  favourites: {
    name: '影片收藏',
    url: 'https://jable.tv/my/favourites/videos/',
    filename: 'favourites_list.json'
  },
  watch_later: {
    name: '稍後觀看',
    url: 'https://jable.tv/my/favourites/videos-watch-later/',
    filename: 'watch_later_list.json'
  }
};

var state = {
  activeView: 'browser',
  activeCollection: 'favourites',
  currentPage: 1,
  totalPages: 1,
  currentRows: [],
  busy: false,
  appInfo: null,
  pendingSaves: [],
  saveFailure: null,
  fullSyncContinuation: null,
  browserNavigation: {
    canGoBack: false,
    canGoForward: false
  }
};

var elements = {};

function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  elements.status.textContent = text;
}

function applyTheme(theme) {
  var value = theme === 'dark' || theme === 'light' ? theme : 'system';
  document.documentElement.setAttribute('data-theme', value);
  localStorage.setItem(THEME_STORAGE_KEY, value);

  if (elements.themeSelect) elements.themeSelect.value = value;
}

function loadTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) || 'system';
}

function setBusy(busy) {
  state.busy = busy;
  elements.syncButton.disabled = busy;
  elements.fullSyncButton.disabled = busy;
  elements.importButton.disabled = busy;
  elements.exportButton.disabled = busy;
  elements.prevPageButton.disabled = busy || state.currentPage <= 1;
  elements.nextPageButton.disabled = busy || state.currentPage >= state.totalPages;
  updateBrowserControls();
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

function updateFullSyncButton() {
  if (!elements.fullSyncButton) return;

  var pending = state.fullSyncContinuation &&
    state.fullSyncContinuation.collectionKey === state.activeCollection;
  elements.fullSyncButton.textContent = pending ? '繼續完整同步' : '完整同步';
}

function updateBrowserControls() {
  if (!elements.backButton) return;

  var browserActive = state.activeView === 'browser';
  elements.backButton.disabled = state.busy || !browserActive || !state.browserNavigation.canGoBack;
  elements.forwardButton.disabled = state.busy || !browserActive || !state.browserNavigation.canGoForward;
  elements.reloadButton.disabled = state.busy || !browserActive;
}

function setBrowserNavigationState(navigation) {
  navigation = navigation || {};
  state.browserNavigation = {
    canGoBack: !!navigation.canGoBack,
    canGoForward: !!navigation.canGoForward
  };
  updateBrowserControls();
}

async function refreshBrowserNavigationState() {
  setBrowserNavigationState(await window.jableApp.getBrowserNavigationState());
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attr(value) {
  return escapeHtml(value);
}

function formatNumber(value) {
  if (value === null || typeof value === 'undefined') return '-';
  return Number(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return '-';

  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
}

function renderThumb(video) {
  var previewAttr = video.preview ? ' data-preview-src="' + attr(video.preview) + '"' : '';
  var image = video.img
    ? '<img class="thumb-image" src="' + attr(video.img) + '" alt="">'
    : '<div class="thumb-image thumb-placeholder"></div>';
  var preview = video.preview
    ? '<video class="thumb-preview" muted loop playsinline preload="none" aria-hidden="true"></video>'
    : '';

  return '<div class="thumb-frame"' + previewAttr + '>' + image + preview + '</div>';
}

function currentCollection() {
  return COLLECTIONS[state.activeCollection];
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

async function currentBrowserUrl() {
  try {
    return await window.jableApp.getBrowserUrl();
  } catch (error) {
    return '';
  }
}

function browserBounds() {
  var rect = elements.browserHost.getBoundingClientRect();

  return {
    visible: state.activeView === 'browser',
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function resizeBrowser() {
  if (!elements.browserHost) return;
  if (state.activeView !== 'browser') {
    window.jableApp.setBrowserBounds({ visible: false });
    return;
  }

  window.jableApp.setBrowserBounds(browserBounds());
}

function scheduleBrowserResize() {
  resizeBrowser();
  setTimeout(resizeBrowser, 50);
  setTimeout(resizeBrowser, 250);
  setTimeout(resizeBrowser, 1000);
}

async function diagnoseLayout() {
  resizeBrowser();

  var hostRect = elements.browserHost.getBoundingClientRect();
  var guest = null;

  try {
    guest = await window.jableApp.diagnoseBrowser();
  } catch (error) {
    guest = { error: error.message };
  }

  var message = [
    'app=' + window.innerWidth + 'x' + window.innerHeight,
    'host=' + Math.round(hostRect.width) + 'x' + Math.round(hostRect.height),
    'guest=' + (guest.error ? guest.error : guest.innerWidth + 'x' + guest.innerHeight + '/scroll' + guest.scrollHeight),
    'url=' + (guest.url || await currentBrowserUrl())
  ].join(' | ');

  console.log('[JableDesktopDiagnostics]', message, guest);
  setStatus(message);
}

async function loadBrowser(url, forceReload) {
  scheduleBrowserResize();
  await window.jableApp.navigateBrowser({ url: url, forceReload: forceReload });
  await refreshBrowserNavigationState();
  scheduleBrowserResize();
}

async function openInBrowser(url) {
  if (!url || state.busy) return;

  try {
    setActiveView('browser');
    setStatus('開啟影片中…');
    await loadBrowser(url, false);
    setStatus('就緒');
  } catch (error) {
    console.error(error);
    setStatus('開啟影片失敗：' + error.message);
  }
}

async function refreshVideos() {
  var videos = await window.jableApp.listVideos({
    collectionKey: state.activeCollection,
    search: elements.searchInput.value,
    sort: elements.sortSelect.value,
    direction: elements.directionSelect.value
  });

  state.currentRows = videos;
  state.totalPages = Math.max(1, Math.ceil(videos.length / PAGE_SIZE));
  if (state.currentPage > state.totalPages) state.currentPage = state.totalPages;

  var start = (state.currentPage - 1) * PAGE_SIZE;
  var pageRows = videos.slice(start, start + PAGE_SIZE);

  elements.countLabel.textContent = videos.length + ' 筆 · 每頁 ' + PAGE_SIZE + ' 筆';
  elements.pageLabel.textContent = '第 ' + state.currentPage + ' / ' + state.totalPages + ' 頁';
  elements.prevPageButton.disabled = state.busy || state.currentPage <= 1;
  elements.nextPageButton.disabled = state.busy || state.currentPage >= state.totalPages;

  if (!videos.length) {
    elements.videoList.innerHTML = '<div class="empty-state">目前沒有本機資料</div>';
    return;
  }

  elements.videoList.innerHTML = pageRows.map(function (video) {
    var preview = video.preview
      ? '<a href="' + attr(video.preview) + '" target="_blank" rel="noreferrer">Preview</a>'
      : '<span>Preview -</span>';
    var videoUrl = attr(video.url);

    return [
      '<article class="video-card">',
      renderThumb(video),
      '<div class="video-body">',
      '<a class="video-title" href="' + videoUrl + '" data-browser-url="' + videoUrl + '">' + escapeHtml(video.title || video.url) + '</a>',
      '<div class="video-stats">',
      '<span>Views ' + formatNumber(video.views) + '</span>',
      '<span>Likes ' + formatNumber(video.likes) + '</span>',
      '</div>',
      '<div class="video-links">',
      preview,
      '<a href="' + videoUrl + '" data-browser-url="' + videoUrl + '">Open</a>',
      '</div>',
      '<div class="video-time">同步 ' + escapeHtml(formatDate(video.last_seen_at)) + '</div>',
      '</div>',
      '</article>'
    ].join('');
  }).join('');
}

function startThumbPreview(frame) {
  var src = frame.getAttribute('data-preview-src');
  var video = frame.querySelector('.thumb-preview');
  if (!src || !video) return;

  if (!video.getAttribute('src')) video.setAttribute('src', src);
  video.classList.add('active');

  var play = video.play();
  if (play && typeof play.catch === 'function') {
    play.catch(function () {});
  }
}

function stopThumbPreview(frame) {
  var video = frame.querySelector('.thumb-preview');
  if (!video) return;

  video.classList.remove('active');
  video.pause();
  try {
    video.currentTime = 0;
  } catch (error) {}
}

function selectCollection(collectionKey) {
  state.activeCollection = collectionKey;
  state.currentPage = 1;

  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-collection') === collectionKey);
  }

  updateFullSyncButton();
  refreshVideos();
}

function setActiveView(view) {
  state.activeView = view;

  elements.browserPanel.classList.toggle('active', view === 'browser');
  elements.libraryPanel.classList.toggle('active', view === 'library');
  elements.showBrowserButton.classList.toggle('active', view === 'browser');
  elements.showLibraryButton.classList.toggle('active', view === 'library');
  updateBrowserControls();

  scheduleBrowserResize();
  if (view === 'library') refreshVideos();
}

function goToPage(page) {
  var nextPage = Math.max(1, Math.min(state.totalPages, page));
  if (nextPage === state.currentPage) return;

  state.currentPage = nextPage;
  refreshVideos();
}

function handleBrowserMessage(message) {
  if (message.channel === 'sync-page') {
    var payload = message.args[0];
    setStatus('同步第 ' + payload.page + ' 頁，' + payload.rows.length + ' 筆');

    var save = window.jableApp.saveSyncPage(payload).catch(function (error) {
      state.saveFailure = error;
      throw error;
    });
    state.pendingSaves.push(save);
  }

  if (message.channel === 'sync-progress') {
    var progress = message.args[0];
    setStatus('已載入第 ' + progress.page + ' 頁');
  }

  if (message.channel === 'browser-navigation-state') {
    setBrowserNavigationState(message.args[0]);
  }
}

async function syncActiveCollection() {
  return syncCollection('quick');
}

async function fullSyncActiveCollection() {
  return syncCollection('full');
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
    var currentUrl = await currentBrowserUrl();
    if (collectionUrlPattern(collectionKey).test(pathFromUrl(currentUrl))) {
      setActiveView('browser');
      return true;
    }
  }

  setActiveView('browser');
  await loadBrowser(collection.url, true);
  return false;
}

async function syncCollection(mode) {
  if (state.busy) return;

  setBusy(true);
  state.pendingSaves = [];
  state.saveFailure = null;

  try {
    var collectionKey = state.activeCollection;
    var collection = currentCollection();
    var continuation = mode === 'full' &&
      state.fullSyncContinuation &&
      state.fullSyncContinuation.collectionKey === collectionKey
      ? state.fullSyncContinuation
      : null;
    var usedContinuation = await ensureCollectionStartPage(collectionKey, collection, mode, continuation);
    var syncRunId = usedContinuation ? continuation.syncRunId : createSyncRunId(mode, collectionKey);
    var siteOrderOffset = usedContinuation ? continuation.siteOrderOffset : 0;
    var startPage = usedContinuation ? continuation.lastScrapedPage : null;
    var browserUrl = await currentBrowserUrl();

    if (!collectionUrlPattern(collectionKey).test(pathFromUrl(browserUrl))) {
      setStatus('請先在瀏覽器登入 Jable，並確認可開啟「' + collection.name + '」頁面');
      return;
    }

    var knownUrls = await window.jableApp.getCollectionUrls(collectionKey);
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
    var result = await window.jableApp.syncBrowserCollection(options);
    await Promise.all(state.pendingSaves);

    if (state.saveFailure) throw state.saveFailure;

    var finishState = await window.jableApp.finishSync({
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      result: result
    });

    if (mode === 'full' && result.completed === false && result.incompleteReason === 'batch-limit') {
      state.fullSyncContinuation = {
        collectionKey: collectionKey,
        syncRunId: syncRunId,
        siteOrderOffset: siteOrderOffset + result.totalRows,
        lastScrapedPage: result.lastScrapedPage
      };
    } else if (mode === 'full') {
      state.fullSyncContinuation = null;
    }

    state.currentPage = 1;
    setActiveView('library');
    await refreshVideos();

    setStatus(resultStatus(collection, mode, result, finishState));
  } catch (error) {
    console.error(error);
    setStatus(syncModeName(mode) + '失敗：' + error.message);
  } finally {
    updateFullSyncButton();
    setBusy(false);
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
  var resource = await window.jableApp.exportJson(state.activeCollection);
  downloadJson(currentCollection().filename, resource);
  setStatus('已匯出 ' + currentCollection().filename);
}

async function importJsonFile(file) {
  if (!file) return;

  setBusy(true);

  try {
    var text = await file.text();
    var resource = JSON.parse(text);
    var result = await window.jableApp.importJson({
      collectionKey: state.activeCollection,
      resource: resource
    });

    state.currentPage = 1;
    await refreshVideos();
    setStatus('已匯入 ' + result.imported + ' 筆到 ' + currentCollection().name);
  } catch (error) {
    console.error(error);
    setStatus('匯入失敗：' + error.message);
  } finally {
    elements.importFile.value = '';
    setBusy(false);
  }
}

function wireEvents() {
  window.jableApp.onBrowserMessage(handleBrowserMessage);
  window.addEventListener('resize', scheduleBrowserResize);

  elements.showBrowserButton.addEventListener('click', function () {
    setActiveView('browser');
  });
  elements.showLibraryButton.addEventListener('click', function () {
    setActiveView('library');
  });
  elements.themeSelect.addEventListener('change', function () {
    applyTheme(elements.themeSelect.value);
  });
  elements.backButton.addEventListener('click', function () {
    window.jableApp.goBackBrowser().then(setBrowserNavigationState);
  });
  elements.forwardButton.addEventListener('click', function () {
    window.jableApp.goForwardBrowser().then(setBrowserNavigationState);
  });
  elements.reloadButton.addEventListener('click', function () {
    window.jableApp.reloadBrowser().then(setBrowserNavigationState);
  });
  elements.diagnoseButton.addEventListener('click', diagnoseLayout);
  elements.clearSessionButton.addEventListener('click', async function () {
    if (state.busy) return;
    setBusy(true);
    await window.jableApp.clearJableSession();
    await loadBrowser(DEFAULT_BROWSER_URL, true);
    setBusy(false);
    setStatus('已清除 Jable session');
  });

  elements.syncButton.addEventListener('click', syncActiveCollection);
  elements.fullSyncButton.addEventListener('click', fullSyncActiveCollection);
  elements.importButton.addEventListener('click', function () {
    elements.importFile.click();
  });
  elements.importFile.addEventListener('change', function () {
    importJsonFile(elements.importFile.files[0]);
  });
  elements.exportButton.addEventListener('click', exportActiveCollection);
  elements.prevPageButton.addEventListener('click', function () {
    goToPage(state.currentPage - 1);
  });
  elements.nextPageButton.addEventListener('click', function () {
    goToPage(state.currentPage + 1);
  });
  elements.videoList.addEventListener('click', function (event) {
    var link = event.target.closest('a[data-browser-url]');
    if (!link) return;

    event.preventDefault();
    openInBrowser(link.getAttribute('data-browser-url'));
  });
  elements.videoList.addEventListener('pointerover', function (event) {
    var frame = event.target.closest('.thumb-frame[data-preview-src]');
    if (!frame || !elements.videoList.contains(frame)) return;
    if (event.relatedTarget && frame.contains(event.relatedTarget)) return;

    startThumbPreview(frame);
  });
  elements.videoList.addEventListener('pointerout', function (event) {
    var frame = event.target.closest('.thumb-frame[data-preview-src]');
    if (!frame || !elements.videoList.contains(frame)) return;
    if (event.relatedTarget && frame.contains(event.relatedTarget)) return;

    stopThumbPreview(frame);
  });

  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function (event) {
      selectCollection(event.currentTarget.getAttribute('data-collection'));
    });
  }

  elements.searchInput.addEventListener('input', function () {
    state.currentPage = 1;
    refreshVideos();
  });
  elements.sortSelect.addEventListener('change', function () {
    state.currentPage = 1;
    refreshVideos();
  });
  elements.directionSelect.addEventListener('change', function () {
    state.currentPage = 1;
    refreshVideos();
  });
}

async function init() {
  elements = {
    status: $('status'),
    browserHost: $('browser-host'),
    browserPanel: $('browser-view-panel'),
    libraryPanel: $('library-view-panel'),
    showBrowserButton: $('show-browser-button'),
    showLibraryButton: $('show-library-button'),
    themeSelect: $('theme-select'),
    syncButton: $('sync-button'),
    fullSyncButton: $('full-sync-button'),
    importButton: $('import-button'),
    exportButton: $('export-button'),
    importFile: $('import-file'),
    searchInput: $('search-input'),
    sortSelect: $('sort-select'),
    directionSelect: $('direction-select'),
    countLabel: $('count-label'),
    videoList: $('video-list'),
    backButton: $('back-button'),
    forwardButton: $('forward-button'),
    reloadButton: $('reload-button'),
    diagnoseButton: $('diagnose-button'),
    clearSessionButton: $('clear-session-button'),
    prevPageButton: $('prev-page-button'),
    nextPageButton: $('next-page-button'),
    pageLabel: $('page-label')
  };

  applyTheme(loadTheme());
  state.appInfo = await window.jableApp.getAppInfo();
  wireEvents();
  updateFullSyncButton();
  setActiveView('browser');
  scheduleBrowserResize();
  await refreshVideos();
  await loadBrowser(DEFAULT_BROWSER_URL, false);
  scheduleBrowserResize();
  setStatus('就緒');
}

window.addEventListener('DOMContentLoaded', init);
