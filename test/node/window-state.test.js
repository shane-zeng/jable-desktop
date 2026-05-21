'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const windowState = require('../../app/runtime-dist/main-process/window-state.js');

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jable-window-state-')), 'main-window-state.json');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

test('main window state store returns null for missing or invalid state', function () {
  const filePath = tempStatePath();
  const store = new windowState.MainWindowStateStore(filePath);

  assert.equal(store.readState(), null);

  writeJson(filePath, { version: 1, width: 0, height: 860 });
  assert.equal(store.readState(), null);

  writeJson(filePath, { version: 1, width: 1360, height: 'invalid' });
  assert.equal(store.readState(), null);
});

test('main window state store restores persisted state', function () {
  const filePath = tempStatePath();
  const store = new windowState.MainWindowStateStore(filePath);

  writeJson(filePath, {
    version: 1,
    updatedAt: '2026-05-21T00:00:00.000Z',
    x: -120.4,
    y: 45.5,
    width: 1440.4,
    height: 900.5,
    maximized: true
  });

  assert.deepEqual(store.readState(), {
    x: -120,
    y: 46,
    width: 1440,
    height: 901,
    maximized: true
  });
});

test('main window state store restores legacy size-only state', function () {
  const filePath = tempStatePath();
  const store = new windowState.MainWindowStateStore(filePath);

  writeJson(filePath, {
    version: 1,
    updatedAt: '2026-05-21T00:00:00.000Z',
    width: 1440,
    height: 900
  });

  assert.deepEqual(store.readState(), {
    x: null,
    y: null,
    width: 1440,
    height: 900,
    maximized: false
  });
});

test('main window state store writes normalized state snapshots', function () {
  const filePath = tempStatePath();
  const store = new windowState.MainWindowStateStore(filePath);

  store.writeState({ x: -10.4, y: 22.5, width: 1536.2, height: 936.7, maximized: true });

  const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(snapshot.version, 1);
  assert.equal(typeof snapshot.updatedAt, 'string');
  assert.equal(snapshot.x, -10);
  assert.equal(snapshot.y, 23);
  assert.equal(snapshot.width, 1536);
  assert.equal(snapshot.height, 937);
  assert.equal(snapshot.maximized, true);
  assert.deepEqual(store.readState(), {
    x: -10,
    y: 23,
    width: 1536,
    height: 937,
    maximized: true
  });
});
