'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var i18n = require('../app/i18n');
var zhTW = require('../app/i18n/locales/zh-TW.json');
var enUS = require('../app/i18n/locales/en-US.json');

function flattenKeys(value, prefix, out) {
  out = out || [];
  prefix = prefix || '';

  Object.keys(value).forEach(function (key) {
    var path = prefix ? prefix + '.' + key : key;
    var child = value[key];

    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenKeys(child, path, out);
      return;
    }

    out.push(path);
  });

  return out.sort();
}

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

test('keeps Traditional Chinese and English dictionaries in key parity', function () {
  assert.deepEqual(flattenKeys(enUS), flattenKeys(zhTW));
});

test('exposes missing keys in test and development environments', function () {
  var originalNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = 'test';
    assert.equal(i18n.t('en-US', 'missing.example'), '[missing:missing.example]');

    process.env.NODE_ENV = 'production';
    assert.equal(i18n.t('en-US', 'missing.example'), 'missing.example');
  } finally {
    if (typeof originalNodeEnv === 'undefined') delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});
