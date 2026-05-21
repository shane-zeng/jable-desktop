'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron, expect, test } = require('@playwright/test');
const electronPath = require('electron');

function createTempUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jable-electron-smoke-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function startSmokeServer() {
  const server = http.createServer(function (_request, response) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Smoke Jable Host</title><main>Smoke Jable Host</main>');
  });

  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      server.removeListener('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Smoke server did not expose a TCP port.'));
        return;
      }

      resolve({
        close: function () {
          return new Promise(function (closeResolve, closeReject) {
            server.close(function (error) {
              if (error) closeReject(error);
              else closeResolve();
            });
          });
        },
        url: 'http://127.0.0.1:' + address.port + '/'
      });
    });
  });
}

async function findPreloadBridgeWindow(electronApp) {
  const startedAt = Date.now();
  const timeoutMs = 30000;

  while (Date.now() - startedAt < timeoutMs) {
    const windows = electronApp.windows();
    for (const window of windows) {
      const hasBridge = await window
        .evaluate(function () {
          return Boolean(globalThis.jableApp);
        })
        .catch(function () {
          return false;
        });

      if (hasBridge) return window;
    }

    await new Promise(function (resolve) {
      setTimeout(resolve, 100);
    });
  }

  throw new Error('Timed out waiting for the renderer window preload IPC bridge.');
}

async function waitForWindowCount(electronApp, count) {
  const startedAt = Date.now();
  const timeoutMs = 10000;

  while (Date.now() - startedAt < timeoutMs) {
    const actual = await electronApp.evaluate(function ({ BrowserWindow }) {
      return BrowserWindow.getAllWindows().length;
    });

    if (actual === count) return;

    await new Promise(function (resolve) {
      setTimeout(resolve, 100);
    });
  }

  throw new Error('Timed out waiting for Electron window count: ' + count);
}

test('desktop app starts and exposes the preload IPC bridge', async function () {
  const userDataDir = createTempUserDataDir();
  const smokeServer = await startSmokeServer();
  let electronApp = null;

  try {
    writeJson(path.join(userDataDir, 'browser-session.json'), {
      version: 1,
      updatedAt: '2026-05-19T00:00:00.000Z',
      activeTabIndex: 1,
      tabs: [
        { url: smokeServer.url + '?ignored=1', locked: false, muted: false },
        { url: smokeServer.url + '?ignored=2', locked: false, muted: false }
      ]
    });
    writeJson(path.join(userDataDir, 'main-window-state.json'), {
      version: 1,
      updatedAt: '2026-05-21T00:00:00.000Z',
      width: 1200,
      height: 700
    });

    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [process.cwd()],
      cwd: process.cwd(),
      env: Object.assign({}, process.env, {
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        JABLE_DESKTOP_TEST_BYPASS_SHELL_OPEN: '1',
        JABLE_DESKTOP_TEST_HOME_URL: smokeServer.url,
        JABLE_DESKTOP_TEST_USER_DATA_DIR: userDataDir
      })
    });

    const window = await findPreloadBridgeWindow(electronApp);

    await expect(window).toHaveTitle(/Jable/i);

    const restoredWindowBounds = await electronApp.evaluate(function ({ BrowserWindow }) {
      const windows = BrowserWindow.getAllWindows();
      return windows[0] ? windows[0].getBounds() : null;
    });
    expect(restoredWindowBounds.width).toBe(1200);
    expect(restoredWindowBounds.height).toBe(700);

    const appInfo = await window.evaluate(function () {
      return globalThis.jableApp.getAppInfo();
    });
    expect(appInfo.databasePath).toContain(userDataDir);

    const defaultSettings = await window.evaluate(function () {
      return globalThis.jableApp.getSettings();
    });
    expect(typeof defaultSettings.maxBrowserTabs).toBe('number');
    expect(typeof defaultSettings.browserTabsMode).toBe('string');

    const initialTabs = await window.evaluate(function () {
      return globalThis.jableApp.listBrowserTabs();
    });
    expect(initialTabs.tabs.length).toBe(1);
    expect(initialTabs.activeTabId).toBe(initialTabs.tabs[0].id);
  } finally {
    if (electronApp) await electronApp.close();
    await smokeServer.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('desktop app restores previous browser tabs when enabled', async function () {
  const userDataDir = createTempUserDataDir();
  const smokeServer = await startSmokeServer();
  const firstUrl = smokeServer.url + '?tab=one';
  const secondUrl = smokeServer.url + '?tab=two';
  const thirdUrl = smokeServer.url + '?tab=three';
  const fourthUrl = smokeServer.url + '?tab=four';
  let electronApp = null;

  try {
    writeJson(path.join(userDataDir, 'settings.json'), {
      restoreBrowserTabsOnStartup: true
    });
    writeJson(path.join(userDataDir, 'browser-session.json'), {
      version: 1,
      updatedAt: '2026-05-19T00:00:00.000Z',
      activeTabIndex: 2,
      tabs: [
        { url: firstUrl, locked: false, muted: false },
        { url: secondUrl, locked: true, muted: true },
        { url: thirdUrl, locked: false, muted: false },
        { url: fourthUrl, locked: false, muted: false }
      ]
    });

    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [process.cwd()],
      cwd: process.cwd(),
      env: Object.assign({}, process.env, {
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        JABLE_DESKTOP_TEST_BYPASS_SHELL_OPEN: '1',
        JABLE_DESKTOP_TEST_HOME_URL: smokeServer.url,
        JABLE_DESKTOP_TEST_USER_DATA_DIR: userDataDir
      })
    });

    const window = await findPreloadBridgeWindow(electronApp);
    const restoredTabs = await window.evaluate(function () {
      return globalThis.jableApp.listBrowserTabs();
    });

    expect(restoredTabs.tabs.length).toBe(4);
    expect(restoredTabs.tabs[0].url).toBe(firstUrl);
    expect(restoredTabs.tabs[1].url).toBe(secondUrl);
    expect(restoredTabs.tabs[2].url).toBe(thirdUrl);
    expect(restoredTabs.tabs[3].url).toBe(fourthUrl);
    expect(restoredTabs.activeTabId).toBe(restoredTabs.tabs[2].id);
    expect(restoredTabs.tabs[1].locked).toBe(true);
    expect(restoredTabs.tabs[1].muted).toBe(true);

    await electronApp.evaluate(function ({ BrowserWindow }) {
      const windows = BrowserWindow.getAllWindows();
      if (windows[0]) windows[0].setSize(1210, 710);
    });
    await electronApp.evaluate(function ({ BrowserWindow }) {
      const windows = BrowserWindow.getAllWindows();
      if (windows[0]) windows[0].close();
    });
    await waitForWindowCount(electronApp, 0);

    const savedWindowState = JSON.parse(fs.readFileSync(path.join(userDataDir, 'main-window-state.json'), 'utf8'));
    expect(savedWindowState.width).toBe(1210);
    expect(savedWindowState.height).toBe(710);

    await electronApp.evaluate(function ({ app }) {
      app.emit('activate');
    });

    const reopenedWindow = await findPreloadBridgeWindow(electronApp);
    const reopenedTabs = await reopenedWindow.evaluate(function () {
      return globalThis.jableApp.listBrowserTabs();
    });

    expect(reopenedTabs.tabs.length).toBe(4);
    expect(reopenedTabs.tabs[0].url).toBe(firstUrl);
    expect(reopenedTabs.tabs[1].url).toBe(secondUrl);
    expect(reopenedTabs.tabs[2].url).toBe(thirdUrl);
    expect(reopenedTabs.tabs[3].url).toBe(fourthUrl);
    expect(reopenedTabs.activeTabId).toBe(reopenedTabs.tabs[2].id);
  } finally {
    if (electronApp) await electronApp.close();
    await smokeServer.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
