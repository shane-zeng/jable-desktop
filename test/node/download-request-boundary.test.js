'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createDownloadRequestBoundary,
  fileRelativePathIsWindowsSafe,
  sanitizeWindowsSafeFileName
} = require('../../app/runtime-dist/main-process/download/request-boundary.js');

function createBoundary(t, records) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-download-boundary-'));
  t.after(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  return {
    boundary: createDownloadRequestBoundary({
      canonicalVideoUrl: function (value) {
        return typeof value === 'string' && value ? value : null;
      },
      downloadRootPath: function () {
        return root;
      },
      listPersistedDownloads: function () {
        return records || [];
      },
      t: function (key) {
        return key;
      }
    }),
    root: root
  };
}

test('download filename sanitizer avoids Windows reserved and trailing names', function () {
  assert.equal(sanitizeWindowsSafeFileName('CON'), 'CON video');
  assert.equal(sanitizeWindowsSafeFileName('CON.mp4'), 'CON video.mp4');
  assert.equal(sanitizeWindowsSafeFileName('COM1.txt'), 'COM1 video.txt');
  assert.equal(sanitizeWindowsSafeFileName('bad .mp4'), 'bad.mp4');
  assert.equal(sanitizeWindowsSafeFileName('nul.'), 'nul video');
  assert.equal(sanitizeWindowsSafeFileName('bad. '), 'bad');
  assert.equal(sanitizeWindowsSafeFileName('???'), 'video');
  assert.equal(sanitizeWindowsSafeFileName('a'.repeat(200)).length, 116);
});

test('download relative path validation rejects Windows-unsafe persisted paths', function () {
  assert.equal(fileRelativePathIsWindowsSafe('Jable Downloads/download-me.mp4'), true);
  assert.equal(fileRelativePathIsWindowsSafe('/tmp/download-me.mp4'), false);
  assert.equal(fileRelativePathIsWindowsSafe('\\server\\share\\download-me.mp4'), false);
  assert.equal(fileRelativePathIsWindowsSafe('C:download-me.mp4'), false);
  assert.equal(fileRelativePathIsWindowsSafe('Jable Downloads/CON.mp4'), false);
  assert.equal(fileRelativePathIsWindowsSafe('Jable Downloads/name .mp4'), false);
  assert.equal(fileRelativePathIsWindowsSafe('Jable Downloads/name.'), false);
  assert.equal(fileRelativePathIsWindowsSafe('Jable Downloads/name '), false);
  assert.equal(fileRelativePathIsWindowsSafe('Jable Downloads/name:.mp4'), false);
  assert.equal(fileRelativePathIsWindowsSafe('../download-me.mp4'), false);
});

test('download output names stay Windows-safe while preserving suffix collision behavior', function (t) {
  const videoUrl = 'https://jable.tv/videos/video/';
  const { boundary, root } = createBoundary(t, [
    { videoUrl: 'https://jable.tv/videos/other/', localPath: 'Video.mp4' }
  ]);
  fs.writeFileSync(path.join(root, 'Video (2).mp4'), 'existing');

  assert.equal(
    boundary.downloadOutputRelativePath({
      video: { url: videoUrl, title: 'Video' }
    }),
    'Video (3).mp4'
  );
  assert.equal(
    boundary.downloadOutputRelativePath({
      video: { url: videoUrl, title: 'CON.mp4' }
    }),
    'CON video.mp4.mp4'
  );

  const longName = boundary.downloadOutputRelativePath({
    video: { url: videoUrl, title: 'a'.repeat(200) }
  });
  assert.equal(longName.endsWith('.mp4'), true);
  assert.equal(longName.length <= 120, true);
});
