'use strict';

var fs = require('node:fs');
var path = require('node:path');
var test = require('node:test');
var assert = require('node:assert/strict');

var USERSCRIPT_PATH = path.join(__dirname, '..', 'jable-favourites-exporter.user.js');

function readUserscript() {
  return fs.readFileSync(USERSCRIPT_PATH, 'utf8');
}

test('userscript exposes a persisted locale selector for the floating exporter UI', function () {
  var source = readUserscript();

  assert.match(source, /LOCALE_STORAGE_KEY = STORAGE_PREFIX \+ 'locale'/);
  assert.match(source, /LOCALE_SELECT_ID = 'fav-export-locale-select'/);
  assert.match(source, /<option value="zh-TW">繁中<\/option>/);
  assert.match(source, /<option value="en-US">EN<\/option>/);
  assert.match(source, /localStorage\.setItem\(LOCALE_STORAGE_KEY, locale\)/);
});

test('userscript keeps busy-state labels separate from normal localized button labels', function () {
  var source = readUserscript();

  assert.match(source, /data-busy/);
  assert.match(source, /refreshExportUiText/);
  assert.match(source, /btn\.setAttribute\('data-label', t\('exportButton'\)\)/);
});
