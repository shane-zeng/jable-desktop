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

test('mainWindowDimensions restores a saved size when it fits the current work area', function () {
  assert.deepEqual(
    windowOptions.mainWindowDimensions('darwin', { width: 2560, height: 1440 }, { width: 1720, height: 980 }),
    {
      width: 1720,
      height: 980,
      minWidth: 1100,
      minHeight: 680
    }
  );
});

test('mainWindowDimensions clamps restored size to minimums and current work area', function () {
  assert.deepEqual(
    windowOptions.mainWindowDimensions('darwin', { width: 1280, height: 800 }, { width: 5000, height: 320 }),
    {
      width: 1232,
      height: 680,
      minWidth: 1100,
      minHeight: 680
    }
  );
});

test('mainWindowDimensions falls back to platform defaults for invalid saved size', function () {
  assert.deepEqual(
    windowOptions.mainWindowDimensions('darwin', { width: 1920, height: 1080 }, { width: NaN, height: -1 }),
    {
      width: 1360,
      height: 860,
      minWidth: 1100,
      minHeight: 680
    }
  );
});

test('mainWindowPlacement restores visible saved bounds and maximized state', function () {
  assert.deepEqual(
    windowOptions.mainWindowPlacement('darwin', [{ x: 0, y: 25, width: 2560, height: 1415 }], {
      x: 240,
      y: 120,
      width: 1720,
      height: 980,
      maximized: true
    }),
    {
      x: 240,
      y: 120,
      width: 1720,
      height: 980,
      minWidth: 1100,
      minHeight: 680,
      maximized: true
    }
  );
});

test('mainWindowPlacement moves off-screen saved bounds back into a visible work area', function () {
  assert.deepEqual(
    windowOptions.mainWindowPlacement('darwin', [{ x: 0, y: 25, width: 1440, height: 875 }], {
      x: 3000,
      y: 100,
      width: 1360,
      height: 860,
      maximized: false
    }),
    {
      x: 80,
      y: 73,
      width: 1360,
      height: 827,
      minWidth: 1100,
      minHeight: 680,
      maximized: false
    }
  );
});

test('mainWindowPlacement keeps saved bounds on the matching display', function () {
  assert.deepEqual(
    windowOptions.mainWindowPlacement(
      'darwin',
      [
        { x: 0, y: 25, width: 1440, height: 875 },
        { x: -1920, y: 0, width: 1920, height: 1080 }
      ],
      { x: -1600, y: 120, width: 1280, height: 780, maximized: false }
    ),
    {
      x: -1600,
      y: 120,
      width: 1280,
      height: 780,
      minWidth: 1100,
      minHeight: 680,
      maximized: false
    }
  );
});
