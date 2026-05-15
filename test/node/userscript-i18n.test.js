'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const USERSCRIPT_PATH = path.join(__dirname, '..', '..', 'jable-favourites-exporter.user.js');

function readUserscript() {
  return fs.readFileSync(USERSCRIPT_PATH, 'utf8');
}

test('userscript exposes a persisted locale selector for the floating exporter UI', function () {
  const source = readUserscript();

  assert.match(source, /@match\s+https:\/\/fs1\.app\/\*/);
  assert.match(source, /LOCALE_STORAGE_KEY = STORAGE_PREFIX \+ 'locale'/);
  assert.match(source, /LOCALE_SELECT_ID = 'fav-export-locale-select'/);
  assert.match(source, /<option value="zh-TW">繁中<\/option>/);
  assert.match(source, /<option value="en-US">EN<\/option>/);
  assert.match(source, /<option value="ja-JP">日本語<\/option>/);
  assert.match(source, /localStorage\.setItem\(LOCALE_STORAGE_KEY, locale\)/);
});

test('userscript includes Japanese locale detection and messages', function () {
  const source = readUserscript();

  assert.match(source, /'ja-JP': \{/);
  assert.match(source, /locale === 'ja'/);
  assert.match(source, /locale\.indexOf\('ja-'\) === 0/);
  assert.match(source, /Export ツールの言語/);
});

test('userscript keeps busy-state labels separate from normal localized button labels', function () {
  const source = readUserscript();

  assert.match(source, /data-busy/);
  assert.match(source, /refreshExportUiText/);
  assert.match(source, /btn\.setAttribute\('data-label', t\('exportButton'\)\)/);
});
