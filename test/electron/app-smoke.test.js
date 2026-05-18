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

test('desktop app starts and exposes the preload IPC bridge', async function () {
  const userDataDir = createTempUserDataDir();
  const smokeServer = await startSmokeServer();
  let electronApp = null;

  try {
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
