'use strict';

var electron = require('electron');
var path = require('node:path');
var JableDatabase = require('./database').JableDatabase;

var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var WebContentsView = electron.WebContentsView;
var ipcMain = electron.ipcMain;
var Menu = electron.Menu;
var clipboard = electron.clipboard;

var JABLE_HOME_URL = 'https://jable.tv/';
var JABLE_SESSION_PARTITION = 'persist:jable-session';
var MAX_BROWSER_TABS = 14;

var mainWindow = null;
var browserTabs = [];
var browserTabsById = {};
var webContentsTabIds = {};
var activeBrowserTabId = null;
var nextBrowserTabId = 1;
var browserBounds = { visible: true, x: 0, y: 52, width: 900, height: 600 };
var database = null;
var databasePath = null;

function getDatabase() {
  if (!database) {
    databasePath = path.join(app.getPath('userData'), 'jable-favourites.sqlite');
    database = new JableDatabase(databasePath);
  }

  return database;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 680,
    title: 'Jable Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(function (details) {
    if (details.url) {
      try {
        createBrowserTab({
          url: details.url,
          active: true
        });
      } catch (error) {
        forwardBrowserMessage('browser-error', { message: error.message });
      }
    }

    return { action: 'deny' };
  });

  mainWindow.on('swipe', function (_event, direction) {
    if (direction === 'right') goBrowserBack();
    else if (direction === 'left') goBrowserForward();
  });

  loadRenderer();
  createBrowserTab({ url: JABLE_HOME_URL, active: true });
}

function loadRenderer() {
  if (process.env.JABLE_RENDERER_DEV_URL) {
    mainWindow.loadURL(process.env.JABLE_RENDERER_DEV_URL);
    return;
  }

  mainWindow.loadFile(path.join(__dirname, 'renderer-dist', 'index.html'));
}

function createBrowserTab(options) {
  options = options || {};

  if (browserTabs.length >= MAX_BROWSER_TABS) {
    throw new Error('最多只能開啟 ' + MAX_BROWSER_TABS + ' 個瀏覽器分頁');
  }

  var kind = options.kind === 'sync' ? 'sync' : 'normal';
  var id = 'tab-' + nextBrowserTabId++;
  var tab = {
    id: id,
    kind: kind,
    view: new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'webview-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        partition: JABLE_SESSION_PARTITION,
        backgroundThrottling: false
      }
    }),
    attached: false,
    locked: !!options.locked,
    title: options.title || (kind === 'sync' ? '同步' : 'Jable'),
    url: options.url || '',
    favicon: options.favicon || '',
    loading: false,
    canGoBack: false,
    canGoForward: false
  };

  browserTabs.push(tab);
  browserTabsById[id] = tab;
  webContentsTabIds[String(tab.view.webContents.id)] = id;
  wireBrowserTab(tab);

  if (!activeBrowserTabId || options.active !== false) {
    activeBrowserTabId = id;
  }

  if (options.url) loadTabUrl(tab, options.url, !!options.forceReload);
  attachActiveBrowserTab();
  notifyBrowserTabsChanged();
  return browserTabsState();
}

function wireBrowserTab(tab) {
  tab.view.webContents.setWindowOpenHandler(function (details) {
    if (details.url) {
      try {
        createBrowserTab({
          url: details.url,
          active: true
        });
      } catch (error) {
        forwardBrowserMessage('browser-error', { message: error.message });
      }
    }

    return { action: 'deny' };
  });

  tab.view.webContents.on('page-title-updated', function (_event, title) {
    tab.title = cleanTitle(title) || tab.title;
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('page-favicon-updated', function (_event, favicons) {
    if (Array.isArray(favicons) && favicons[0]) {
      tab.favicon = favicons[0];
      notifyBrowserTabsChanged();
    }
  });

  tab.view.webContents.on('did-start-loading', function () {
    tab.loading = true;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('did-stop-loading', function () {
    tab.loading = false;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('did-finish-load', function () {
    tab.loading = false;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('did-fail-load', function () {
    tab.loading = false;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('did-navigate', function (_event, url) {
    tab.url = url || tab.view.webContents.getURL() || tab.url;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('did-navigate-in-page', function (_event, url) {
    tab.url = url || tab.view.webContents.getURL() || tab.url;
    updateTabNavigationState(tab);
    notifyBrowserTabsChanged();
  });

  tab.view.webContents.on('context-menu', function (_event, params) {
    showBrowserContextMenu(tab, params);
  });
}

function cleanTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim();
}

function getBrowserTab(tabId) {
  var id = tabId || activeBrowserTabId;
  var tab = id ? browserTabsById[id] : null;

  if (!tab || tab.view.webContents.isDestroyed()) {
    throw new Error('找不到瀏覽器分頁');
  }

  return tab;
}

function getBrowserTabByWebContents(webContents) {
  if (!webContents) return null;
  var tabId = webContentsTabIds[String(webContents.id)];
  return tabId ? browserTabsById[tabId] : null;
}

function serializeBrowserTab(tab) {
  updateTabNavigationState(tab);

  return {
    id: tab.id,
    kind: tab.kind,
    title: tab.title || '新分頁',
    url: tab.url || '',
    favicon: tab.favicon || '',
    loading: !!tab.loading,
    locked: !!tab.locked,
    canGoBack: !!tab.canGoBack,
    canGoForward: !!tab.canGoForward
  };
}

function browserTabsState() {
  return {
    activeTabId: activeBrowserTabId,
    maxTabs: MAX_BROWSER_TABS,
    tabs: browserTabs.map(serializeBrowserTab)
  };
}

function updateTabNavigationState(tab) {
  if (!tab || tab.view.webContents.isDestroyed()) {
    if (tab) {
      tab.canGoBack = false;
      tab.canGoForward = false;
    }
    return;
  }

  var history = tab.view.webContents.navigationHistory;
  tab.url = tab.view.webContents.getURL() || tab.url;
  tab.canGoBack = history.canGoBack();
  tab.canGoForward = history.canGoForward();
}

function notifyBrowserTabsChanged() {
  forwardBrowserMessage('browser-tabs-changed', browserTabsState());
  forwardBrowserMessage('browser-navigation-state', browserNavigationState());
}

function browserNavigationState(tabId) {
  var tab = null;

  try {
    tab = getBrowserTab(tabId);
  } catch (error) {
    return { canGoBack: false, canGoForward: false, locked: false };
  }

  updateTabNavigationState(tab);

  return {
    tabId: tab.id,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    locked: tab.locked
  };
}

function detachBrowserTab(tab) {
  if (!mainWindow || mainWindow.isDestroyed() || !tab || !tab.attached) return;
  mainWindow.contentView.removeChildView(tab.view);
  tab.attached = false;
}

function detachAllBrowserTabs() {
  for (var i = 0; i < browserTabs.length; i++) {
    detachBrowserTab(browserTabs[i]);
  }
}

function attachActiveBrowserTab() {
  var activeTab = null;

  try {
    activeTab = getBrowserTab();
  } catch (error) {
    return;
  }

  for (var i = 0; i < browserTabs.length; i++) {
    if (browserTabs[i] !== activeTab) detachBrowserTab(browserTabs[i]);
  }

  if (!browserBounds.visible || !mainWindow || mainWindow.isDestroyed()) return;

  if (!activeTab.attached) {
    mainWindow.contentView.addChildView(activeTab.view);
    activeTab.attached = true;
  }

  activeTab.view.setBounds({
    x: browserBounds.x,
    y: browserBounds.y,
    width: browserBounds.width,
    height: browserBounds.height
  });
}

function setBrowserBounds(bounds) {
  if (!bounds) return null;

  if (bounds.visible === false) {
    browserBounds.visible = false;
    detachAllBrowserTabs();
    return { visible: false };
  }

  browserBounds = {
    visible: true,
    x: Math.max(0, Math.floor(bounds.x || 0)),
    y: Math.max(0, Math.floor(bounds.y || 0)),
    width: Math.max(320, Math.floor(bounds.width || 0)),
    height: Math.max(320, Math.floor(bounds.height || 0))
  };

  attachActiveBrowserTab();
  return Object.assign({}, browserBounds);
}

function activateBrowserTab(tabId) {
  getBrowserTab(tabId);
  activeBrowserTabId = tabId;
  attachActiveBrowserTab();
  notifyBrowserTabsChanged();
  return browserTabsState();
}

function closeBrowserTab(tabId) {
  var tab = getBrowserTab(tabId);
  if (tab.locked) throw new Error('同步中的分頁不能關閉');

  var index = browserTabs.indexOf(tab);
  detachBrowserTab(tab);
  delete browserTabsById[tab.id];
  delete webContentsTabIds[String(tab.view.webContents.id)];
  browserTabs.splice(index, 1);

  try {
    tab.view.webContents.close({ waitForBeforeUnload: false });
  } catch (error) {}

  if (activeBrowserTabId === tab.id) {
    var next = browserTabs[Math.max(0, index - 1)] || browserTabs[0] || null;
    activeBrowserTabId = next ? next.id : null;
  }

  if (!browserTabs.length) {
    createBrowserTab({ url: JABLE_HOME_URL, active: true });
    return browserTabsState();
  }

  attachActiveBrowserTab();
  notifyBrowserTabsChanged();
  return browserTabsState();
}

function setBrowserTabLocked(payload) {
  payload = payload || {};
  var tab = getBrowserTab(payload.tabId);
  tab.locked = !!payload.locked;
  notifyBrowserTabsChanged();
  return browserTabsState();
}

function waitForBrowserStop(tab, timeoutMs) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(finish, timeoutMs || 25000);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      tab.view.webContents.removeListener('did-stop-loading', finish);
      updateTabNavigationState(tab);
      resolve(tab.view.webContents.getURL());
    }

    tab.view.webContents.once('did-stop-loading', finish);
  });
}

function loadTabUrl(tab, targetUrl, forceReload) {
  var currentUrl = tab.view.webContents.getURL();
  tab.url = targetUrl || tab.url;
  tab.loading = true;

  if (forceReload && currentUrl === targetUrl) tab.view.webContents.reload();
  else tab.view.webContents.loadURL(targetUrl);

  updateTabNavigationState(tab);
  notifyBrowserTabsChanged();
}

async function navigateBrowser(payload) {
  payload = payload || {};
  var tab = getBrowserTab(payload.tabId);
  var targetUrl = payload.url;

  if (!targetUrl) return tab.view.webContents.getURL();
  if (tab.locked) throw new Error('同步中的分頁不能手動導航');

  var wait = waitForBrowserStop(tab);
  loadTabUrl(tab, targetUrl, !!payload.forceReload);
  var loadedUrl = await wait;
  notifyBrowserTabsChanged();
  return loadedUrl;
}

async function reloadBrowser(tabId) {
  var tab = getBrowserTab(tabId);
  if (tab.locked) throw new Error('同步中的分頁不能重新整理');

  tab.view.webContents.reload();
  updateTabNavigationState(tab);
  notifyBrowserTabsChanged();
  return Object.assign({ reloaded: true }, browserNavigationState(tab.id));
}

async function goBrowserBack(tabId) {
  var tab = null;

  try {
    tab = getBrowserTab(tabId);
  } catch (error) {
    notifyBrowserTabsChanged();
    return browserNavigationState(tabId);
  }

  if (tab.locked) {
    notifyBrowserTabsChanged();
    return browserNavigationState(tab.id);
  }

  var history = tab.view.webContents.navigationHistory;

  if (history.canGoBack()) {
    var wait = waitForBrowserStop(tab);
    history.goBack();
    await wait;
  }

  notifyBrowserTabsChanged();
  return browserNavigationState(tab.id);
}

async function goBrowserForward(tabId) {
  var tab = null;

  try {
    tab = getBrowserTab(tabId);
  } catch (error) {
    notifyBrowserTabsChanged();
    return browserNavigationState(tabId);
  }

  if (tab.locked) {
    notifyBrowserTabsChanged();
    return browserNavigationState(tab.id);
  }

  var history = tab.view.webContents.navigationHistory;

  if (history.canGoForward()) {
    var wait = waitForBrowserStop(tab);
    history.goForward();
    await wait;
  }

  notifyBrowserTabsChanged();
  return browserNavigationState(tab.id);
}

function safeCreateBrowserTab(options) {
  try {
    return createBrowserTab(options);
  } catch (error) {
    forwardBrowserMessage('browser-error', { message: error.message });
    return browserTabsState();
  }
}

function copyText(value) {
  if (!value) return;
  clipboard.writeText(String(value));
}

function contextMediaLabel(mediaType) {
  if (mediaType === 'image') return '圖片';
  if (mediaType === 'video') return '影片';
  if (mediaType === 'audio') return '音訊';
  return '媒體';
}

function pushSeparator(items) {
  if (!items.length || items[items.length - 1].type === 'separator') return;
  items.push({ type: 'separator' });
}

function showBrowserContextMenu(tab, params) {
  if (!mainWindow || mainWindow.isDestroyed() || !tab) return;

  params = params || {};

  if (params.isEditable) {
    showEditableContextMenu(tab, params);
    return;
  }

  var items = [];
  var linkUrl = params.linkURL || '';
  var srcUrl = params.srcURL || '';
  var selectionText = String(params.selectionText || '').trim();

  if (linkUrl) {
    items.push({
      label: '在新分頁開啟連結',
      click: function () {
        safeCreateBrowserTab({ url: linkUrl, active: true });
      }
    });
    items.push({
      label: '複製連結網址',
      click: function () {
        copyText(linkUrl);
      }
    });
  }

  if (srcUrl) {
    if (items.length) pushSeparator(items);

    var mediaLabel = contextMediaLabel(params.mediaType);
    items.push({
      label: '在新分頁開啟' + mediaLabel,
      click: function () {
        safeCreateBrowserTab({ url: srcUrl, active: true });
      }
    });
    items.push({
      label: '複製' + mediaLabel + '網址',
      click: function () {
        copyText(srcUrl);
      }
    });
  }

  if (selectionText) {
    if (items.length) pushSeparator(items);
    items.push({
      label: '複製選取文字',
      click: function () {
        copyText(selectionText);
      }
    });
  }

  if (items.length) pushSeparator(items);

  items.push({
    label: '上一頁',
    enabled: tab.canGoBack && !tab.locked,
    click: function () {
      goBrowserBack(tab.id);
    }
  });
  items.push({
    label: '下一頁',
    enabled: tab.canGoForward && !tab.locked,
    click: function () {
      goBrowserForward(tab.id);
    }
  });
  items.push({
    label: '重新整理',
    enabled: !tab.locked,
    click: function () {
      reloadBrowser(tab.id);
    }
  });

  pushSeparator(items);

  items.push({
    label: '新增分頁',
    enabled: browserTabs.length < MAX_BROWSER_TABS,
    click: function () {
      safeCreateBrowserTab({ url: JABLE_HOME_URL, active: true });
    }
  });
  items.push({
    label: '複製目前頁面網址',
    enabled: !!(tab.url || params.pageURL),
    click: function () {
      copyText(tab.url || params.pageURL);
    }
  });

  Menu.buildFromTemplate(items).popup({ window: mainWindow });
}

function showBrowserTabMenu(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return { shown: false };

  payload = payload || {};
  var tab = getBrowserTab(payload.tabId);
  var items = [
    {
      label: '新增分頁',
      enabled: browserTabs.length < MAX_BROWSER_TABS,
      click: function () {
        safeCreateBrowserTab({ url: JABLE_HOME_URL, active: true });
      }
    },
    {
      label: '切換到此分頁',
      enabled: activeBrowserTabId !== tab.id,
      click: function () {
        activateBrowserTab(tab.id);
      }
    },
    {
      label: '重新整理分頁',
      enabled: !tab.locked,
      click: function () {
        reloadBrowser(tab.id);
      }
    },
    {
      label: '複製分頁網址',
      enabled: !!tab.url,
      click: function () {
        copyText(tab.url);
      }
    },
    { type: 'separator' },
    {
      label: '緊湊模式',
      type: 'checkbox',
      checked: !!payload.compactMode,
      click: function (menuItem) {
        forwardBrowserMessage('browser-tabs-compact-mode', { compact: !!menuItem.checked });
      }
    },
    { type: 'separator' },
    {
      label: '關閉分頁',
      enabled: !tab.locked,
      click: function () {
        closeBrowserTab(tab.id);
      }
    }
  ];
  var popupOptions = { window: mainWindow };

  if (typeof payload.x === 'number' && typeof payload.y === 'number') {
    popupOptions.x = Math.round(payload.x);
    popupOptions.y = Math.round(payload.y);
  }

  Menu.buildFromTemplate(items).popup(popupOptions);
  return { shown: true };
}

function showEditableContextMenu(tab, params) {
  params = params || {};
  var editFlags = params.editFlags || {};
  var items = [
    {
      label: '復原',
      enabled: !!editFlags.canUndo,
      click: function () { tab.view.webContents.undo(); }
    },
    {
      label: '重做',
      enabled: !!editFlags.canRedo,
      click: function () { tab.view.webContents.redo(); }
    },
    { type: 'separator' },
    {
      label: '剪下',
      enabled: !!editFlags.canCut,
      click: function () { tab.view.webContents.cut(); }
    },
    {
      label: '複製',
      enabled: !!editFlags.canCopy,
      click: function () { tab.view.webContents.copy(); }
    },
    {
      label: '貼上',
      enabled: !!editFlags.canPaste,
      click: function () { tab.view.webContents.paste(); }
    },
    { type: 'separator' },
    {
      label: '全選',
      enabled: !!editFlags.canSelectAll,
      click: function () { tab.view.webContents.selectAll(); }
    }
  ];

  Menu.buildFromTemplate(items).popup({ window: mainWindow });
}

function forwardBrowserMessage(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('browser-message', {
    channel: channel,
    args: [payload]
  });
}

function syncPayloadForEvent(event, payload) {
  var tab = getBrowserTabByWebContents(event.sender);
  return Object.assign({}, payload || {}, {
    tabId: tab ? tab.id : null
  });
}

function registerIpcHandlers() {
  ipcMain.handle('app:info', function () {
    getDatabase();

    return {
      databasePath: databasePath
    };
  });

  ipcMain.handle('db:list-videos', function (_event, options) {
    return getDatabase().listVideos(options.collectionKey, options);
  });

  ipcMain.handle('db:collection-urls', function (_event, collectionKey) {
    return getDatabase().getCollectionUrls(collectionKey);
  });

  ipcMain.handle('db:save-sync-page', function (_event, payload) {
    return getDatabase().saveSyncPage(payload);
  });

  ipcMain.handle('db:finish-sync', function (_event, payload) {
    return getDatabase().finishSync(payload);
  });

  ipcMain.handle('db:clear-sync-state', function (_event, collectionKey) {
    return getDatabase().clearSyncState(collectionKey);
  });

  ipcMain.handle('db:import-json', function (_event, payload) {
    return getDatabase().importResource(payload.collectionKey, payload.resource);
  });

  ipcMain.handle('db:export-json', function (_event, collectionKey) {
    return getDatabase().exportResource(collectionKey);
  });

  ipcMain.handle('browser:list-tabs', function () {
    return browserTabsState();
  });

  ipcMain.handle('browser:show-tab-menu', function (_event, payload) {
    return showBrowserTabMenu(payload);
  });

  ipcMain.handle('browser:create-tab', function (_event, payload) {
    return createBrowserTab(payload);
  });

  ipcMain.handle('browser:activate-tab', function (_event, tabId) {
    return activateBrowserTab(tabId);
  });

  ipcMain.handle('browser:close-tab', function (_event, tabId) {
    return closeBrowserTab(tabId);
  });

  ipcMain.handle('browser:set-tab-locked', function (_event, payload) {
    return setBrowserTabLocked(payload);
  });

  ipcMain.handle('browser:set-bounds', function (_event, bounds) {
    return setBrowserBounds(bounds);
  });

  ipcMain.handle('browser:navigate', function (_event, payload) {
    return navigateBrowser(payload);
  });

  ipcMain.handle('browser:reload', async function (_event, payload) {
    payload = payload || {};
    return reloadBrowser(payload.tabId);
  });

  ipcMain.handle('browser:go-back', async function (_event, payload) {
    payload = payload || {};
    return goBrowserBack(payload.tabId);
  });

  ipcMain.handle('browser:go-forward', async function (_event, payload) {
    payload = payload || {};
    return goBrowserForward(payload.tabId);
  });

  ipcMain.handle('browser:navigation-state', function (_event, payload) {
    payload = payload || {};
    return browserNavigationState(payload.tabId);
  });

  ipcMain.handle('browser:get-url', function (_event, payload) {
    payload = payload || {};
    return getBrowserTab(payload.tabId).view.webContents.getURL();
  });

  ipcMain.handle('browser:sync-collection', function (_event, payload) {
    payload = payload || {};
    var tab = getBrowserTab(payload.tabId);
    var options = Object.assign({}, payload.options || payload);
    delete options.tabId;
    delete options.options;
    var script = 'window.jableDesktopScraper.syncCollection(' + JSON.stringify(options) + ')';
    return tab.view.webContents.executeJavaScript(script, true);
  });

  ipcMain.handle('browser:diagnose', function (_event, payload) {
    payload = payload || {};
    var tab = getBrowserTab(payload.tabId);
    return tab.view.webContents.executeJavaScript([
      '({',
      'url: location.href,',
      'innerWidth: window.innerWidth,',
      'innerHeight: window.innerHeight,',
      'clientHeight: document.documentElement.clientHeight,',
      'scrollHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
      '})'
    ].join(''), true);
  });

  ipcMain.on('browser:sync-page', function (event, payload) {
    forwardBrowserMessage('sync-page', syncPayloadForEvent(event, payload));
  });

  ipcMain.on('browser:sync-progress', function (event, payload) {
    forwardBrowserMessage('sync-progress', syncPayloadForEvent(event, payload));
  });

  ipcMain.on('browser:trackpad-history', function (event, direction) {
    var tab = getBrowserTabByWebContents(event.sender);
    if (!tab) return;

    if (direction === 'back') goBrowserBack(tab.id);
    else if (direction === 'forward') goBrowserForward(tab.id);
  });
}

registerIpcHandlers();

app.whenReady().then(function () {
  app.setName('Jable Desktop');

  getDatabase();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', function () {
  if (database) database.close();
});
