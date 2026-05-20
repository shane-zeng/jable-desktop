'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const windowOptions = require('../../app/runtime-dist/main-process/window-options.js');

test('mainWindowDimensions keeps the existing default size outside Windows', function () {
  assert.deepEqual(windowOptions.mainWindowDimensions('darwin', { width: 1920, height: 1080 }), {
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 680
  });
});

test('mainWindowDimensions uses a larger default size on Windows', function () {
  assert.deepEqual(windowOptions.mainWindowDimensions('win32', { width: 1920, height: 1040 }), {
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 680
  });
});

test('mainWindowDimensions fits the initial window inside compact work areas when possible', function () {
  assert.deepEqual(windowOptions.mainWindowDimensions('win32', { width: 1366, height: 768 }), {
    width: 1318,
    height: 720,
    minWidth: 1100,
    minHeight: 680
  });
});

test('mainWindowDimensions preserves minimum size on very small work areas', function () {
  assert.deepEqual(windowOptions.mainWindowDimensions('win32', { width: 1024, height: 640 }), {
    width: 1100,
    height: 680,
    minWidth: 1100,
    minHeight: 680
  });
});
