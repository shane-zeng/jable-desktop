'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const helpers = require('../../app/runtime-dist/download-helpers.js');

test('extracts absolute HLS playlist URLs from escaped Jable page HTML', function () {
  const html = String.raw`<script>window.player = { source: "https:\/\/cdn.example.test\/hls\/master.m3u8?token=a&amp;expires=1" };</script>`;

  assert.equal(
    helpers.extractHlsPlaylistUrl(html, 'https://jable.tv/videos/sample/'),
    'https://cdn.example.test/hls/master.m3u8?token=a&expires=1'
  );
});

test('extracts relative quoted HLS playlist URLs against the video page URL', function () {
  const html = `<script>const playlist = '/videos/sample/playlist.m3u8?cdn=1&amp;sid=abc';</script>`;

  assert.equal(
    helpers.extractHlsPlaylistUrl(html, 'https://jable.tv/videos/sample/'),
    'https://jable.tv/videos/sample/playlist.m3u8?cdn=1&sid=abc'
  );
});

test('returns null when no HLS playlist URL is present', function () {
  assert.equal(helpers.extractHlsPlaylistUrl('<html></html>', 'https://jable.tv/videos/sample/'), null);
});

test('builds video page fetch headers with optional cookies', function () {
  assert.deepEqual(helpers.videoPageRequestHeaders('https://jable.tv/videos/sample/', 'session=abc'), {
    accept: 'text/html,application/xhtml+xml',
    referer: 'https://jable.tv/',
    'user-agent': helpers.DOWNLOAD_USER_AGENT,
    cookie: 'session=abc'
  });

  assert.deepEqual(helpers.videoPageRequestHeaders('https://fs1.app/videos/sample/', ''), {
    accept: 'text/html,application/xhtml+xml',
    referer: 'https://fs1.app/',
    'user-agent': helpers.DOWNLOAD_USER_AGENT
  });
});

test('builds FFmpeg header blocks with optional cookies', function () {
  assert.equal(
    helpers.ffmpegHeaderBlock('https://jable.tv/videos/sample/', 'session=abc'),
    'Referer: https://jable.tv/videos/sample/\r\n' +
      'User-Agent: ' +
      helpers.DOWNLOAD_USER_AGENT +
      '\r\n' +
      'Cookie: session=abc\r\n'
  );

  assert.equal(
    helpers.ffmpegHeaderBlock('https://jable.tv/videos/sample/', ''),
    'Referer: https://jable.tv/videos/sample/\r\n' + 'User-Agent: ' + helpers.DOWNLOAD_USER_AGENT + '\r\n'
  );
});
