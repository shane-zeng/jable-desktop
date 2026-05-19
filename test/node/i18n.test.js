'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../../app/runtime-dist/i18n');
const zhTW = require('../../app/runtime-dist/i18n/locales/zh-TW.json');
const enUS = require('../../app/runtime-dist/i18n/locales/en-US.json');
const jaJP = require('../../app/runtime-dist/i18n/locales/ja-JP.json');

function flattenKeys(value, prefix, out) {
  out = out || [];
  prefix = prefix || '';

  Object.keys(value).forEach(function (key) {
    const path = prefix ? prefix + '.' + key : key;
    const child = value[key];

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
  assert.equal(i18n.normalizeLocale('ja-JP'), 'ja-JP');
  assert.equal(i18n.normalizeLocale('ja'), 'ja-JP');
  assert.equal(i18n.normalizeLocale('ja-JP-u-ca-japanese'), 'ja-JP');
  assert.equal(i18n.normalizeLocale(''), 'zh-TW');
});

test('translates native menu and dialog labels by locale', function () {
  assert.equal(i18n.t('zh-TW', 'menu.file'), '檔案');
  assert.equal(i18n.t('en-US', 'menu.file'), 'File');
  assert.equal(i18n.t('ja-JP', 'menu.file'), 'ファイル');
  assert.equal(i18n.t('zh-TW', 'dialog.exportJson'), '匯出 JSON');
  assert.equal(i18n.t('en-US', 'dialog.exportJson'), 'Export JSON');
  assert.equal(i18n.t('ja-JP', 'dialog.exportJson'), 'Export JSON');
  assert.equal(i18n.t('en-US', 'context.openLinkInBackground'), 'Open Link in Background Tab');
  assert.equal(i18n.t('zh-TW', 'context.searchSelectionWithGoogle'), '用 Google 搜尋選取文字');
  assert.equal(i18n.t('ja-JP', 'context.openLinkInBackground'), 'リンクをバックグラウンドタブで開く');
  assert.equal(i18n.t('zh-TW', 'context.theaterMode'), '劇院模式');
  assert.equal(i18n.t('en-US', 'context.theaterMode'), 'Theater Mode');
  assert.equal(i18n.t('ja-JP', 'context.theaterMode'), 'シアターモード');
});

test('interpolates translated messages', function () {
  assert.equal(i18n.t('zh-TW', 'errors.maxTabs', { count: 14 }), '最多只能開啟 14 個瀏覽器分頁');
  assert.equal(i18n.t('en-US', 'errors.maxTabs', { count: 14 }), 'You can open at most 14 browser tabs');
});

test('keeps locale dictionaries in key parity', function () {
  assert.deepEqual(flattenKeys(enUS), flattenKeys(zhTW));
  assert.deepEqual(flattenKeys(jaJP), flattenKeys(zhTW));
});

test('exposes missing keys in test and development environments', function () {
  const originalNodeEnv = process.env.NODE_ENV;

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
