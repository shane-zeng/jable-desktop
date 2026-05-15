'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const MAIN_SOURCE_PATH = path.join(__dirname, '..', '..', 'app', 'main.ts');
const WEBVIEW_PRELOAD_SOURCE_PATH = path.join(__dirname, '..', '..', 'app', 'webview-preload.ts');

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('main process uses preload IPC for browser page requests', function () {
  const source = readSource(MAIN_SOURCE_PATH);
  const forbiddenMethod = 'execute' + 'JavaScript';
  const removedGlobal = 'jableDesktop' + 'Scraper';

  assert.equal(source.includes('.' + forbiddenMethod + '('), false);
  assert.equal(source.includes(removedGlobal), false);
  assert.match(source, /browser:sync-collection-request/);
  assert.match(source, /browser:diagnose-request/);
});

test('webview preload owns browser sync and diagnosis request handlers', function () {
  const source = readSource(WEBVIEW_PRELOAD_SOURCE_PATH);
  const removedGlobal = 'jableDesktop' + 'Scraper';

  assert.equal(source.includes(removedGlobal), false);
  assert.match(source, /browser:sync-collection-request/);
  assert.match(source, /browser:diagnose-request/);
  assert.match(source, /browser:preload-response/);
  assert.match(source, /function syncCollection/);
  assert.match(source, /function diagnosePage/);
});
