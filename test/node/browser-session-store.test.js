'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const browserSessionStore = require('../../app/runtime-dist/main-process/browser/session-store.js');

function tempSessionPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jable-browser-session-')), 'browser-session.json');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function normalizeHttpUrl(value) {
  const url = String(value || '').trim();
  if (!/^https?:\/\//.test(url)) throw new Error('Unsupported URL');
  return url;
}

test('browser session store restores valid normal tab snapshot fields', function () {
  const filePath = tempSessionPath();
  const store = new browserSessionStore.BrowserSessionStore(filePath);

  writeJson(filePath, {
    version: 1,
    updatedAt: '2026-05-19T00:00:00.000Z',
    activeTabIndex: 1,
    tabs: [
      { url: 'https://jable.tv/', locked: true, muted: false },
      { url: 'https://jable.tv/videos/restored/', locked: false, muted: true }
    ]
  });

  assert.deepEqual(
    store.readForRestore({
      maxTabs: 10,
      normalizeUrl: normalizeHttpUrl
    }),
    {
      version: 1,
      updatedAt: '2026-05-19T00:00:00.000Z',
      activeTabIndex: 1,
      tabs: [
        { url: 'https://jable.tv/', locked: true, muted: false },
        { url: 'https://jable.tv/videos/restored/', locked: false, muted: true }
      ]
    }
  );
});

test('browser session store skips unsafe URLs and keeps the active tab aligned', function () {
  const filePath = tempSessionPath();
  const store = new browserSessionStore.BrowserSessionStore(filePath);

  writeJson(filePath, {
    version: 1,
    activeTabIndex: 2,
    tabs: [
      { url: 'javascript:alert(1)', locked: true, muted: true },
      { url: 'https://jable.tv/a/', locked: false, muted: false },
      { url: 'https://jable.tv/b/', locked: true, muted: true }
    ]
  });

  assert.deepEqual(
    store.readForRestore({
      maxTabs: 10,
      normalizeUrl: normalizeHttpUrl
    }),
    {
      version: 1,
      updatedAt: '1970-01-01T00:00:00.000Z',
      activeTabIndex: 1,
      tabs: [
        { url: 'https://jable.tv/a/', locked: false, muted: false },
        { url: 'https://jable.tv/b/', locked: true, muted: true }
      ]
    }
  );
});

test('browser session store trims restored tabs to the configured max', function () {
  const filePath = tempSessionPath();
  const store = new browserSessionStore.BrowserSessionStore(filePath);

  writeJson(filePath, {
    version: 1,
    activeTabIndex: 4,
    tabs: [
      { url: 'https://jable.tv/1/' },
      { url: 'https://jable.tv/2/' },
      { url: 'https://jable.tv/3/' },
      { url: 'https://jable.tv/4/' },
      { url: 'https://jable.tv/5/' }
    ]
  });

  const restored = store.readForRestore({
    maxTabs: 3,
    normalizeUrl: normalizeHttpUrl
  });

  assert.equal(restored.tabs.length, 3);
  assert.equal(restored.activeTabIndex, 2);
  assert.deepEqual(
    restored.tabs.map(function (tab) {
      return tab.url;
    }),
    ['https://jable.tv/1/', 'https://jable.tv/2/', 'https://jable.tv/3/']
  );
});

test('browser session store returns null for empty or unreadable snapshots', function () {
  const filePath = tempSessionPath();
  const store = new browserSessionStore.BrowserSessionStore(filePath);

  assert.equal(
    store.readForRestore({
      maxTabs: 10,
      normalizeUrl: normalizeHttpUrl
    }),
    null
  );

  writeJson(filePath, { version: 1, tabs: [{ url: 'ftp://example.test/video' }] });
  assert.equal(
    store.readForRestore({
      maxTabs: 10,
      normalizeUrl: normalizeHttpUrl
    }),
    null
  );
});
