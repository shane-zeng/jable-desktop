'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron, expect, test } = require('@playwright/test');
const electronPath = require('electron');
const dataEngine = require('../../app/runtime-dist/data/data-engine.js');

function createTempUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jable-electron-smoke-'));
}

function seedDownloadAsset(userDataDir) {
  const downloadRoot = path.join(userDataDir, 'downloads');
  const relativePath = 'electron-smoke-download.mp4';
  const filePath = path.join(downloadRoot, 'electron-smoke-download.mp4');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'smoke download file');

  const engine = dataEngine.createDataEngine(path.join(userDataDir, 'jable-favourites.sqlite'));
  try {
    engine.upsertDownloadAsset({
      videoUrl: 'https://jable.tv/videos/electron-smoke-download/',
      collectionKey: 'favourites',
      title: 'Electron smoke download',
      localPath: relativePath,
      state: 'ready',
      progress: 1,
      fileSizeBytes: fs.statSync(filePath).size,
      error: null,
      completedAt: '2026-05-17T00:00:00.000Z'
    });
  } finally {
    engine.close();
  }

  return {
    filePath: filePath,
    videoUrl: 'https://jable.tv/videos/electron-smoke-download/'
  };
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
  const seededDownload = seedDownloadAsset(userDataDir);
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

    await window.getByRole('button', { name: /Settings|設定/ }).click();
    await expect(window.locator('[data-test="settings-panel"]')).toBeVisible();

    const defaultSettings = await window.evaluate(function () {
      return globalThis.jableApp.getSettings();
    });
    expect(defaultSettings.autoReplayDeferredSyncOperations).toBe(false);
    expect(defaultSettings.autoDownloadOnPlayback).toBe(false);
    expect(defaultSettings.webViewEnhancementMode).toBe(false);
    expect(defaultSettings.maxBrowserTabs).toBe(14);
    expect(defaultSettings.browserTabsMode).toBe('standard');
    expect(defaultSettings.maxConcurrentDownloads).toBe(1);

    const initialDownloads = await window.evaluate(function () {
      return globalThis.jableApp.listDownloads();
    });
    expect(initialDownloads.length).toBe(1);
    expect(initialDownloads[0].state).toBe('ready');

    const openedDownload = await window.evaluate(function (videoUrl) {
      return globalThis.jableApp.openDownloadFile(videoUrl);
    }, seededDownload.videoUrl);
    expect(openedDownload).toEqual({
      opened: true,
      path: seededDownload.filePath
    });

    const localPlayback = await window.evaluate(function (videoUrl) {
      return globalThis.jableApp.localPlaybackSource(videoUrl);
    }, seededDownload.videoUrl);
    expect(localPlayback.available).toBe(true);
    expect(localPlayback.videoUrl).toBe(seededDownload.videoUrl);
    expect(localPlayback.sourceUrl).toMatch(/^jable-local-video:\/\/play\/[A-Za-z0-9_-]+\.mp4$/);

    const revealedDownload = await window.evaluate(function (videoUrl) {
      return globalThis.jableApp.revealDownloadFile(videoUrl);
    }, seededDownload.videoUrl);
    expect(revealedDownload).toEqual({
      revealed: true,
      path: seededDownload.filePath
    });

    fs.unlinkSync(seededDownload.filePath);
    const missingOpenResult = await window.evaluate(async function (videoUrl) {
      try {
        await globalThis.jableApp.openDownloadFile(videoUrl);
        return { opened: true, message: null };
      } catch (error) {
        return { opened: false, message: error instanceof Error ? error.message : String(error) };
      }
    }, seededDownload.videoUrl);
    expect(missingOpenResult.opened).toBe(false);
    expect(missingOpenResult.message).toMatch(/Downloaded file is unavailable|下載檔案無法使用/);

    const missingDownloads = await window.evaluate(function () {
      return globalThis.jableApp.listDownloads();
    });
    expect(missingDownloads[0].state).toBe('missing');

    const missingLocalPlayback = await window.evaluate(function (videoUrl) {
      return globalThis.jableApp.localPlaybackSource(videoUrl);
    }, seededDownload.videoUrl);
    expect(missingLocalPlayback).toEqual({
      available: false,
      videoUrl: seededDownload.videoUrl,
      reason: 'missing'
    });

    const updatedSettings = await window.evaluate(function () {
      return globalThis.jableApp.updateSettings({
        maxBrowserTabs: 6,
        browserTabsMode: 'shared',
        webViewEnhancementMode: true,
        fullSyncAjaxWindowSize: 5,
        maxConcurrentDownloads: 3
      });
    });
    expect(updatedSettings.maxBrowserTabs).toBe(6);
    expect(updatedSettings.browserTabsMode).toBe('shared');
    expect(updatedSettings.webViewEnhancementMode).toBe(true);
    expect(updatedSettings.fullSyncAjaxWindowSize).toBe(5);
    expect(updatedSettings.maxConcurrentDownloads).toBe(3);

    const initialTabs = await window.evaluate(function () {
      return globalThis.jableApp.listBrowserTabs();
    });
    expect(initialTabs.tabs.length).toBe(1);
    expect(initialTabs.maxTabs).toBe(6);

    const createdTabs = await window.evaluate(function (url) {
      return globalThis.jableApp.createBrowserTab({ url: url + 'tab', active: true });
    }, smokeServer.url);
    const createdTab = createdTabs.tabs.find(function (tab) {
      return tab.url.indexOf('/tab') !== -1;
    });

    expect(createdTab).toBeTruthy();
    expect(createdTabs.activeTabId).toBe(createdTab.id);

    const activatedTabs = await window.evaluate(function (tabId) {
      return globalThis.jableApp.activateBrowserTab(tabId);
    }, initialTabs.tabs[0].id);
    expect(activatedTabs.activeTabId).toBe(initialTabs.tabs[0].id);

    const closedTabs = await window.evaluate(function (tabId) {
      return globalThis.jableApp.closeBrowserTab(tabId);
    }, createdTab.id);
    expect(
      closedTabs.tabs.some(function (tab) {
        return tab.id === createdTab.id;
      })
    ).toBe(false);

    const imported = await window.evaluate(function () {
      return globalThis.jableApp.importJson({
        collectionKey: 'favourites',
        resource: {
          data: [
            {
              data: [
                {
                  title: 'Electron smoke video',
                  url: 'https://jable.tv/videos/electron-smoke/',
                  views: 10,
                  likes: 2
                }
              ],
              meta: {
                current_page: 1,
                per_page: 24,
                count: 1
              }
            }
          ],
          meta: {
            format_version: 2,
            completed: true,
            last_scraped_page: 1
          }
        }
      });
    });
    expect(imported).toEqual({ imported: 1, collectionKey: 'favourites' });

    const exported = await window.evaluate(function () {
      return globalThis.jableApp.exportJson('favourites');
    });
    expect(exported.meta.total).toBe(1);
    expect(exported.data[0].data[0].url).toBe('https://jable.tv/videos/electron-smoke/');
  } finally {
    if (electronApp) await electronApp.close();
    await smokeServer.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
