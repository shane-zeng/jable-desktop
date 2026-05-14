'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var i18n = require('../app/i18n');

test('normalizes supported and fallback locales', function () {
  assert.equal(i18n.normalizeLocale('zh-HK'), 'zh-TW');
  assert.equal(i18n.normalizeLocale('zh-Hant'), 'zh-TW');
  assert.equal(i18n.normalizeLocale('en-GB'), 'en-US');
  assert.equal(i18n.normalizeLocale('ja-JP'), 'zh-TW');
  assert.equal(i18n.normalizeLocale(''), 'zh-TW');
});

test('translates native menu and dialog labels by locale', function () {
  assert.equal(i18n.t('zh-TW', 'menu.file'), '檔案');
  assert.equal(i18n.t('en-US', 'menu.file'), 'File');
  assert.equal(i18n.t('zh-TW', 'dialog.exportJson'), '匯出 JSON');
  assert.equal(i18n.t('en-US', 'dialog.exportJson'), 'Export JSON');
  assert.equal(i18n.t('en-US', 'context.openLinkInBackground'), 'Open Link in Background Tab');
});

test('interpolates translated messages', function () {
  assert.equal(i18n.t('zh-TW', 'errors.maxTabs', { count: 14 }), '最多只能開啟 14 個瀏覽器分頁');
  assert.equal(i18n.t('en-US', 'errors.maxTabs', { count: 14 }), 'You can open at most 14 browser tabs');
});
