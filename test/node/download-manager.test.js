'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const downloadManager = require('../../app/runtime-dist/main-process/download-manager.js');

test('download manager maps speed modes to segment concurrency limits', function () {
  assert.deepEqual(downloadManager.downloadSegmentConcurrencyForSpeedMode('stable'), { min: 4, max: 8 });
  assert.deepEqual(downloadManager.downloadSegmentConcurrencyForSpeedMode('balanced'), { min: 8, max: 32 });
  assert.deepEqual(downloadManager.downloadSegmentConcurrencyForSpeedMode('fast'), { min: 16, max: 32 });
  assert.deepEqual(downloadManager.downloadSegmentConcurrencyForSpeedMode('custom'), { min: 8, max: 32 });
});

test('download manager classifies and sanitizes failure metadata details', function () {
  const rootPath = '/Volumes/workspace/Downloads';
  const detail = downloadManager.sanitizeDownloadErrorDetail(
    'HTTP 403 from https://cdn.example.test/segment.ts?token=secret while writing ' + rootPath + '/movie.mp4',
    rootPath
  );

  assert.equal(downloadManager.downloadHttpStatusFromMessage(new Error('segment HTTP 403')), 403);
  assert.equal(downloadManager.downloadHttpStatusFromMessage('http_504'), 504);
  assert.equal(downloadManager.downloadFailureCode(new TypeError('fetch failed ECONNRESET')), 'network');
  assert.equal(downloadManager.downloadFailureCode(new Error('plain failure')), 'unknown');
  assert.match(detail, /\[remote URL\]/);
  assert.match(detail, /\[download root\]/);
  assert.equal(detail.includes('token=secret'), false);
  assert.equal(detail.includes(rootPath), false);
});
