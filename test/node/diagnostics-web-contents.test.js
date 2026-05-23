'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const diagnostics = require('../../app/runtime-dist/main-process/diagnostics/web-contents.js');

test('web contents diagnostics ignores aborted main-frame loads', function () {
  assert.equal(
    diagnostics.classifyWebContentsLoadFailure({
      errorCode: -3,
      errorDescription: 'ERR_ABORTED',
      url: 'https://jable.tv/'
    }),
    null
  );
});

test('web contents diagnostics keeps actionable main-frame load failures', function () {
  assert.deepEqual(
    diagnostics.classifyWebContentsLoadFailure({
      errorCode: -105,
      errorDescription: 'ERR_NAME_NOT_RESOLVED',
      url: 'https://jable.tv/'
    }),
    {
      level: 'warn',
      event: 'web-contents-main-frame-load-failed'
    }
  );
});

test('web contents diagnostics suppresses known embedded browser console noise', function () {
  assert.equal(
    diagnostics.classifyWebContentsConsoleMessage({
      level: 'error',
      message: 'Google IMA SDK failed to load',
      sourceId: 'https://imasdk.googleapis.com/js/sdkloader/ima3.js',
      context: { kind: 'browser-tab' }
    }),
    null
  );

  assert.equal(
    diagnostics.classifyWebContentsConsoleMessage({
      level: 'error',
      message: 'Uncaught (in promise) AbortError: The play() request was interrupted by a call to pause().',
      sourceId: 'https://jable.tv/videos/example/',
      context: { kind: 'sync-worker' }
    }),
    null
  );
});

test('web contents diagnostics keeps main-window and unknown console errors', function () {
  assert.deepEqual(
    diagnostics.classifyWebContentsConsoleMessage({
      level: 'error',
      message: 'Google IMA SDK failed to load',
      sourceId: 'https://imasdk.googleapis.com/js/sdkloader/ima3.js',
      context: { kind: 'main-window' }
    }),
    {
      level: 'error',
      event: 'console-message'
    }
  );

  assert.deepEqual(
    diagnostics.classifyWebContentsConsoleMessage({
      level: 'warning',
      message: 'Unexpected renderer warning',
      sourceId: 'file:///app/renderer.js',
      context: { kind: 'browser-tab' }
    }),
    {
      level: 'warn',
      event: 'console-message'
    }
  );
});
