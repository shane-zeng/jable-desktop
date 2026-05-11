'use strict';

var PAGE_SIZE = 25;
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
  saveFailure: null
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
  elements.importButton.disabled = busy;
  elements.exportButton.disabled = busy;
  elements.clearSyncButton.disabled = busy;
  elements.prevPageButton.disabled = busy || state.currentPage <= 1;
  elements.nextPageButton.disabled = busy || state.currentPage >= state.totalPages;
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

function formatDuration(value) {
  var seconds = Math.floor(Number(value) || 0);
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  var rest = seconds % 60;

  if (hours > 0) {
    return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
  }

  return minutes + ':' + String(rest).padStart(2, '0');
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

  elements.countLabel.textContent = videos.length + ' 筆 · 每頁 25 筆';
  elements.pageLabel.textContent = '第 ' + state.currentPage + ' / ' + state.totalPages + ' 頁';
  elements.prevPageButton.disabled = state.busy || state.currentPage <= 1;
  elements.nextPageButton.disabled = state.busy || state.currentPage >= state.totalPages;

  if (!videos.length) {
    elements.videoList.innerHTML = '<div class="empty-state">目前沒有本機資料</div>';
    return;
  }

  elements.videoList.innerHTML = pageRows.map(function (video) {
    var img = video.img ? '<img class="thumb" src="' + attr(video.img) + '" alt="">' : '<div class="thumb"></div>';
    var preview = video.preview
      ? '<a href="' + attr(video.preview) + '" target="_blank" rel="noreferrer">Preview</a>'
      : '<span>Preview -</span>';
    var videoUrl = attr(video.url);
    var playback = video.playback_current_time
      ? '<div class="video-time">播放 ' + escapeHtml(formatDuration(video.playback_current_time)) + (video.playback_duration ? ' / ' + escapeHtml(formatDuration(video.playback_duration)) : '') + '</div>'
      : '';

    return [
      '<article class="video-card">',
      img,
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
      playback,
      '<div class="video-time">同步 ' + escapeHtml(formatDate(video.last_seen_at)) + '</div>',
      '</div>',
      '</article>'
    ].join('');
  }).join('');
}

function selectCollection(collectionKey) {
  state.activeCollection = collectionKey;
  state.currentPage = 1;

  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-collection') === collectionKey);
  }

  refreshVideos();
}

function setActiveView(view) {
  state.activeView = view;

  elements.browserPanel.classList.toggle('active', view === 'browser');
  elements.libraryPanel.classList.toggle('active', view === 'library');
  elements.showBrowserButton.classList.toggle('active', view === 'browser');
  elements.showLibraryButton.classList.toggle('active', view === 'library');
  elements.backButton.disabled = view !== 'browser';
  elements.reloadButton.disabled = view !== 'browser';

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
}

async function syncActiveCollection() {
  if (state.busy) return;

  setBusy(true);
  state.pendingSaves = [];
  state.saveFailure = null;

  try {
    var collectionKey = state.activeCollection;
    var collection = currentCollection();
    var browserUrl = await currentBrowserUrl();

    if (!collectionUrlPattern(collectionKey).test(pathFromUrl(browserUrl))) {
      setStatus('請先在瀏覽器開啟 Jable 的「' + collection.name + '」頁面，再同步');
      setActiveView('browser');
      return;
    }

    var knownUrls = await window.jableApp.getCollectionUrls(collectionKey);
    var options = {
      collectionKey: collectionKey,
      knownUrls: knownUrls,
      stopOnKnownPage: true
    };

    setStatus('開始同步 ' + collection.name);
    setActiveView('browser');
    var result = await window.jableApp.syncBrowserCollection(options);
    await Promise.all(state.pendingSaves);

    if (state.saveFailure) throw state.saveFailure;

    await window.jableApp.finishSync({
      collectionKey: collectionKey,
      result: result
    });
    state.currentPage = 1;
    setActiveView('library');
    await refreshVideos();

    var reason = result.stoppedByKnownPage ? '遇到已知頁面後停止' : '已跑完可見分頁';
    setStatus(collection.name + ' 同步完成：' + result.totalRows + ' 筆，' + reason);
  } catch (error) {
    console.error(error);
    setStatus('同步失敗：' + error.message);
  } finally {
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
    window.jableApp.goBackBrowser();
  });
  elements.reloadButton.addEventListener('click', function () {
    window.jableApp.reloadBrowser();
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
  elements.importButton.addEventListener('click', function () {
    elements.importFile.click();
  });
  elements.importFile.addEventListener('change', function () {
    importJsonFile(elements.importFile.files[0]);
  });
  elements.exportButton.addEventListener('click', exportActiveCollection);
  elements.clearSyncButton.addEventListener('click', async function () {
    await window.jableApp.clearSyncState(state.activeCollection);
    setStatus('已重置 ' + currentCollection().name + ' 同步狀態');
  });
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
    importButton: $('import-button'),
    exportButton: $('export-button'),
    clearSyncButton: $('clear-sync-button'),
    importFile: $('import-file'),
    searchInput: $('search-input'),
    sortSelect: $('sort-select'),
    directionSelect: $('direction-select'),
    countLabel: $('count-label'),
    videoList: $('video-list'),
    backButton: $('back-button'),
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
  setActiveView('browser');
  scheduleBrowserResize();
  await refreshVideos();
  await loadBrowser(DEFAULT_BROWSER_URL, false);
  scheduleBrowserResize();
  setStatus('就緒');
}

window.addEventListener('DOMContentLoaded', init);
