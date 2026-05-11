'use strict';

var electron = require('electron');
var path = require('node:path');
var JableDatabase = require('./database').JableDatabase;

var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var BrowserView = electron.BrowserView;
var ipcMain = electron.ipcMain;
var session = electron.session;

var JABLE_SESSION_PARTITION = 'persist:jable-session';

var mainWindow = null;
var jableView = null;
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
      if (!browserViewAttached()) mainWindow.addBrowserView(jableView);
      capturePlaybackState().finally(function () {
        jableView.webContents.loadURL(details.url);
      });
    }

    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  createBrowserView();
}

function createBrowserView() {
  jableView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'webview-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: JABLE_SESSION_PARTITION
    }
  });

  jableView.webContents.setWindowOpenHandler(function (details) {
    capturePlaybackState().finally(function () {
      jableView.webContents.loadURL(details.url);
    });
    return { action: 'deny' };
  });

  jableView.webContents.on('dom-ready', function () {
    restoreCurrentPlaybackState();
  });

  jableView.webContents.on('did-finish-load', function () {
    restoreCurrentPlaybackState();
    notifyBrowserNavigationState();
  });

  jableView.webContents.on('did-navigate', notifyBrowserNavigationState);
  jableView.webContents.on('did-navigate-in-page', notifyBrowserNavigationState);

  mainWindow.addBrowserView(jableView);
  jableView.setBounds({ x: 0, y: 52, width: 900, height: 600 });
  jableView.setAutoResize({ width: false, height: false });
}

function browserViewAttached() {
  return mainWindow && mainWindow.getBrowserViews().indexOf(jableView) !== -1;
}

function setBrowserBounds(bounds) {
  if (!jableView || !bounds) return null;

  if (bounds.visible === false) {
    if (browserViewAttached()) mainWindow.removeBrowserView(jableView);
    return { visible: false };
  }

  if (!browserViewAttached()) mainWindow.addBrowserView(jableView);

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

function playbackTargetForUrl(url) {
  var state = getDatabase().getPlaybackState(url);
  if (!state || !state.current_time || state.current_time <= 0) return null;

  var currentTime = state.current_time;
  if (state.duration && state.duration > 10) {
    currentTime = Math.min(currentTime, state.duration - 5);
  }

  return {
    currentTime: Math.max(0, currentTime),
    duration: state.duration,
    updatedAt: state.updated_at
  };
}

function restoreCurrentPlaybackState() {
  if (!jableView || jableView.webContents.isDestroyed()) return;

  restorePlaybackState(jableView.webContents.getURL()).catch(function () {});
}

async function capturePlaybackState() {
  if (!jableView || jableView.webContents.isDestroyed()) return { saved: false };

  try {
    var state = await jableView.webContents.executeJavaScript([
      '(function () {',
      '  function numeric(value) {',
      '    if (value === null || typeof value === "undefined") return null;',
      '    var number = parseFloat(String(value).replace(/,/g, ""));',
      '    return Number.isFinite(number) ? number : null;',
      '  }',
      '  function clockToSeconds(value) {',
      '    var text = String(value || "").trim();',
      '    if (!text) return null;',
      '    var parts = text.split(":").map(function (part) { return parseInt(part, 10); });',
      '    if (parts.some(function (part) { return !Number.isFinite(part); })) return null;',
      '    if (parts.length === 2) return parts[0] * 60 + parts[1];',
      '    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];',
      '    return null;',
      '  }',
      '  var video = document.querySelector("video");',
      '  if (video && Number.isFinite(video.currentTime) && video.currentTime > 0) {',
      '    return {',
      '      url: location.href,',
      '      currentTime: video.currentTime,',
      '      duration: Number.isFinite(video.duration) ? video.duration : null',
      '    };',
      '  }',
      '  var seek = document.querySelector("input[data-plyr=\\"seek\\"], .plyr__progress input[type=\\"range\\"]");',
      '  var currentTime = seek ? numeric(seek.getAttribute("aria-valuenow") || seek.value) : null;',
      '  var duration = seek ? numeric(seek.getAttribute("aria-valuemax") || seek.max) : null;',
      '  var currentLabel = document.querySelector(".plyr__time--current");',
      '  if (!currentTime && currentLabel) currentTime = clockToSeconds(currentLabel.textContent);',
      '  if (!duration) {',
      '    var durationLabel = document.querySelector(".plyr__time--duration");',
      '    if (durationLabel) duration = clockToSeconds(durationLabel.textContent);',
      '  }',
      '  if (!currentTime || currentTime <= 0) return null;',
      '  return {',
      '    url: location.href,',
      '    currentTime: currentTime,',
      '    duration: duration',
      '  };',
      '})()'
    ].join('\n'), true);

    if (!state) return { saved: false };
    return getDatabase().savePlaybackState(state);
  } catch (error) {
    return { saved: false, error: error.message };
  }
}

async function restorePlaybackState(url) {
  if (!jableView || jableView.webContents.isDestroyed()) return { restored: false };

  var target = playbackTargetForUrl(url);
  if (!target) return { restored: false };

  try {
    return await jableView.webContents.executeJavaScript([
      '(function (target) {',
      '  function closeEnough(value) {',
      '    return Number.isFinite(value) && Math.abs(value - target.currentTime) < 1;',
      '  }',
      '  function applyToPlayerObject(player) {',
      '    if (!player) return false;',
      '    try {',
      '      if (typeof player.currentTime === "number") {',
      '        player.currentTime = target.currentTime;',
      '        return closeEnough(player.currentTime);',
      '      }',
      '      if (typeof player.seek === "function") {',
      '        player.seek(target.currentTime);',
      '        return true;',
      '      }',
      '    } catch (error) {}',
      '    return false;',
      '  }',
      '  function applyToPlyrInstance() {',
      '    var nodes = document.querySelectorAll("video, #player, .plyr");',
      '    for (var i = 0; i < nodes.length; i++) {',
      '      if (applyToPlayerObject(nodes[i].plyr)) return true;',
      '    }',
      '    if (applyToPlayerObject(window.player)) return true;',
      '    if (applyToPlayerObject(window.plyr)) return true;',
      '    return false;',
      '  }',
      '  function applyToVideo() {',
      '    var video = document.querySelector("video");',
      '    if (!video) return false;',
      '    if (video.readyState < 1) {',
      '      video.addEventListener("loadedmetadata", function () {',
      '        try { video.currentTime = target.currentTime; } catch (error) {}',
      '      }, { once: true });',
      '      return false;',
      '    }',
      '    try {',
      '      video.currentTime = target.currentTime;',
      '      return closeEnough(video.currentTime);',
      '    } catch (error) { return false; }',
      '  }',
      '  function applyToPlyrControl() {',
      '    var seek = document.querySelector("input[data-plyr=\\"seek\\"], .plyr__progress input[type=\\"range\\"]");',
      '    if (!seek) return false;',
      '    seek.value = String(target.currentTime);',
      '    seek.setAttribute("aria-valuenow", String(target.currentTime));',
      '    seek.dispatchEvent(new Event("input", { bubbles: true }));',
      '    seek.dispatchEvent(new Event("change", { bubbles: true }));',
      '    return true;',
      '  }',
      '  function attempt(resolve, count) {',
      '    var restored = applyToPlyrInstance() || applyToVideo();',
      '    var controlUpdated = !restored && applyToPlyrControl();',
      '    if (restored) return resolve({ restored: true, currentTime: target.currentTime });',
      '    if (count >= 60) return resolve({ restored: controlUpdated, currentTime: controlUpdated ? target.currentTime : null });',
      '    setTimeout(function () { attempt(resolve, count + 1); }, 80);',
      '  }',
      '  return new Promise(function (resolve) { attempt(resolve, 0); });',
      '})(' + JSON.stringify(target) + ')'
    ].join('\n'), true);
  } catch (error) {
    return { restored: false, error: error.message };
  }
}

async function navigateBrowser(payload) {
  var targetUrl = payload.url;
  var currentUrl = jableView.webContents.getURL();

  if (currentUrl && currentUrl !== targetUrl) await capturePlaybackState();

  var wait = waitForBrowserStop();
  if (payload.forceReload && currentUrl === targetUrl) jableView.webContents.reload();
  else jableView.webContents.loadURL(targetUrl);

  var loadedUrl = await wait;
  await restorePlaybackState(loadedUrl);
  notifyBrowserNavigationState();
  return loadedUrl;
}

function browserNavigationState() {
  if (!jableView || jableView.webContents.isDestroyed()) {
    return { canGoBack: false, canGoForward: false };
  }

  return {
    canGoBack: jableView.webContents.canGoBack(),
    canGoForward: jableView.webContents.canGoForward()
  };
}

function notifyBrowserNavigationState() {
  forwardBrowserMessage('browser-navigation-state', browserNavigationState());
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
    await capturePlaybackState();
    jableView.webContents.reload();
    return Object.assign({ reloaded: true }, browserNavigationState());
  });

  ipcMain.handle('browser:go-back', async function () {
    await capturePlaybackState();
    if (jableView.webContents.canGoBack()) {
      var wait = waitForBrowserStop();
      jableView.webContents.goBack();
      var url = await wait;
      await restorePlaybackState(url);
    }
    notifyBrowserNavigationState();
    return browserNavigationState();
  });

  ipcMain.handle('browser:go-forward', async function () {
    await capturePlaybackState();
    if (jableView.webContents.canGoForward()) {
      var wait = waitForBrowserStop();
      jableView.webContents.goForward();
      var url = await wait;
      await restorePlaybackState(url);
    }
    notifyBrowserNavigationState();
    return browserNavigationState();
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
