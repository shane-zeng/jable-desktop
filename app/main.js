'use strict';

var electron = require('electron');
var path = require('node:path');
var JableDatabase = require('./database').JableDatabase;

var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var WebContentsView = electron.WebContentsView;
var ipcMain = electron.ipcMain;
var session = electron.session;

var JABLE_SESSION_PARTITION = 'persist:jable-session';

var mainWindow = null;
var jableView = null;
var jableViewAttached = false;
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
    if (jableView && details.url) {
      attachJableView();
      jableView.webContents.loadURL(details.url);
    }

    return { action: 'deny' };
  });

  mainWindow.on('swipe', function (_event, direction) {
    if (direction === 'right') goBrowserBack();
    else if (direction === 'left') goBrowserForward();
  });

  loadRenderer();
  createJableView();
}

function loadRenderer() {
  if (process.env.JABLE_RENDERER_DEV_URL) {
    mainWindow.loadURL(process.env.JABLE_RENDERER_DEV_URL);
    return;
  }

  mainWindow.loadFile(path.join(__dirname, 'renderer-dist', 'index.html'));
}

function createJableView() {
  jableViewAttached = false;
  jableView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'webview-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: JABLE_SESSION_PARTITION
    }
  });

  jableView.webContents.setWindowOpenHandler(function (details) {
    jableView.webContents.loadURL(details.url);
    return { action: 'deny' };
  });

  jableView.webContents.on('did-finish-load', function () {
    notifyBrowserNavigationState();
  });

  jableView.webContents.on('did-navigate', notifyBrowserNavigationState);
  jableView.webContents.on('did-navigate-in-page', notifyBrowserNavigationState);

  attachJableView();
  jableView.setBounds({ x: 0, y: 52, width: 900, height: 600 });
}

function attachJableView() {
  if (!mainWindow || mainWindow.isDestroyed() || !jableView || jableViewAttached) return;
  mainWindow.contentView.addChildView(jableView);
  jableViewAttached = true;
}

function detachJableView() {
  if (!mainWindow || mainWindow.isDestroyed() || !jableView || !jableViewAttached) return;
  mainWindow.contentView.removeChildView(jableView);
  jableViewAttached = false;
}

function setBrowserBounds(bounds) {
  if (!jableView || !bounds) return null;

  if (bounds.visible === false) {
    detachJableView();
    return { visible: false };
  }

  attachJableView();

  var nextBounds = {
    x: Math.max(0, Math.floor(bounds.x || 0)),
    y: Math.max(0, Math.floor(bounds.y || 0)),
    width: Math.max(320, Math.floor(bounds.width || 0)),
    height: Math.max(320, Math.floor(bounds.height || 0))
  };

  jableView.setBounds(nextBounds);
  nextBounds.visible = true;
  return nextBounds;
}

function waitForBrowserStop(timeoutMs) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(finish, timeoutMs || 25000);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      jableView.webContents.removeListener('did-stop-loading', finish);
      resolve(jableView.webContents.getURL());
    }

    jableView.webContents.once('did-stop-loading', finish);
  });
}

async function navigateBrowser(payload) {
  var targetUrl = payload.url;
  var currentUrl = jableView.webContents.getURL();

  var wait = waitForBrowserStop();
  if (payload.forceReload && currentUrl === targetUrl) jableView.webContents.reload();
  else jableView.webContents.loadURL(targetUrl);

  var loadedUrl = await wait;
  notifyBrowserNavigationState();
  return loadedUrl;
}

function browserNavigationState() {
  if (!jableView || jableView.webContents.isDestroyed()) {
    return { canGoBack: false, canGoForward: false };
  }

  var history = jableView.webContents.navigationHistory;

  return {
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward()
  };
}

function notifyBrowserNavigationState() {
  forwardBrowserMessage('browser-navigation-state', browserNavigationState());
}

async function goBrowserBack() {
  if (!jableView || jableView.webContents.isDestroyed()) {
    notifyBrowserNavigationState();
    return browserNavigationState();
  }

  var history = jableView.webContents.navigationHistory;

  if (history.canGoBack()) {
    var wait = waitForBrowserStop();
    history.goBack();
    await wait;
  }

  notifyBrowserNavigationState();
  return browserNavigationState();
}

async function goBrowserForward() {
  if (!jableView || jableView.webContents.isDestroyed()) {
    notifyBrowserNavigationState();
    return browserNavigationState();
  }

  var history = jableView.webContents.navigationHistory;

  if (history.canGoForward()) {
    var wait = waitForBrowserStop();
    history.goForward();
    await wait;
  }

  notifyBrowserNavigationState();
  return browserNavigationState();
}

function forwardBrowserMessage(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('browser-message', {
    channel: channel,
    args: [payload]
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

  ipcMain.handle('session:clear-jable', async function () {
    var jableSession = session.fromPartition(JABLE_SESSION_PARTITION);
    await jableSession.clearStorageData();
    await jableSession.clearCache();
    return { cleared: true };
  });

  ipcMain.handle('browser:set-bounds', function (_event, bounds) {
    return setBrowserBounds(bounds);
  });

  ipcMain.handle('browser:navigate', function (_event, payload) {
    return navigateBrowser(payload);
  });

  ipcMain.handle('browser:reload', async function () {
    jableView.webContents.reload();
    return Object.assign({ reloaded: true }, browserNavigationState());
  });

  ipcMain.handle('browser:go-back', async function () {
    return goBrowserBack();
  });

  ipcMain.handle('browser:go-forward', async function () {
    return goBrowserForward();
  });

  ipcMain.handle('browser:navigation-state', function () {
    return browserNavigationState();
  });

  ipcMain.handle('browser:get-url', function () {
    return jableView.webContents.getURL();
  });

  ipcMain.handle('browser:sync-collection', function (_event, options) {
    var script = 'window.jableDesktopScraper.syncCollection(' + JSON.stringify(options) + ')';
    return jableView.webContents.executeJavaScript(script, true);
  });

  ipcMain.handle('browser:diagnose', function () {
    return jableView.webContents.executeJavaScript([
      '({',
      'url: location.href,',
      'innerWidth: window.innerWidth,',
      'innerHeight: window.innerHeight,',
      'clientHeight: document.documentElement.clientHeight,',
      'scrollHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
      '})'
    ].join(''), true);
  });

  ipcMain.on('browser:sync-page', function (_event, payload) {
    forwardBrowserMessage('sync-page', payload);
  });

  ipcMain.on('browser:sync-progress', function (_event, payload) {
    forwardBrowserMessage('sync-progress', payload);
  });

  ipcMain.on('browser:trackpad-history', function (event, direction) {
    if (!jableView || event.sender !== jableView.webContents) return;

    if (direction === 'back') goBrowserBack();
    else if (direction === 'forward') goBrowserForward();
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
