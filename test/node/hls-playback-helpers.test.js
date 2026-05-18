'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const helpers = require('../../app/runtime-dist/main-process/hls-playback-helpers.js');

const PROXY_HOST = '127.0.0.1';

test('hls playback helper parses proxy request targets and playlist URLs', function () {
  assert.deepEqual(
    helpers.hlsPlaylistProxyRequestTargetFromUrl('http://127.0.0.1:4567/playlist/token_1-2.m3u8', PROXY_HOST),
    {
      type: 'playlist',
      token: 'token_1-2'
    }
  );
  assert.deepEqual(
    helpers.hlsPlaylistProxyRequestTargetFromUrl('http://127.0.0.1:4567/asset/token_1-2/asset_3.ts', PROXY_HOST),
    {
      assetId: 'asset_3',
      type: 'asset',
      token: 'token_1-2'
    }
  );
  assert.equal(helpers.hlsPlaylistProxyRequestTargetFromUrl('https://127.0.0.1/playlist/token.m3u8', PROXY_HOST), null);
  assert.equal(helpers.isHlsPlaylistProxyLoopbackUrl('http://127.0.0.1:4567/playlist/token.m3u8', PROXY_HOST), true);
  assert.equal(helpers.isHlsPlaylistProxyLoopbackUrl('http://localhost:4567/playlist/token.m3u8', PROXY_HOST), false);
  assert.equal(
    helpers.hlsPlaylistProxyRemotePlaylistUrl('https://cdn.example.test/path/master.M3U8?token=1', PROXY_HOST),
    'https://cdn.example.test/path/master.M3U8?token=1'
  );
  assert.equal(
    helpers.hlsPlaylistProxyRemotePlaylistUrl('http://127.0.0.1:4567/playlist/token.m3u8', PROXY_HOST),
    null
  );
  assert.equal(helpers.hlsPlaylistProxyAssetExtension('https://cdn.example.test/path/segment.TS?token=1'), '.ts');
});

test('hls playback helper maps capture files to repeated segment URLs in order', function () {
  const state = {
    captureIndexes: {},
    capturePlan: {
      videoUrl: 'https://jable.tv/videos/example/',
      playlistUrl: 'https://cdn.example.test/master.m3u8',
      segmentCount: 3,
      segments: [
        { url: 'https://cdn.example.test/seg.ts', filePath: '/tmp/seg-1.ts' },
        { url: 'https://cdn.example.test/other.ts', filePath: '/tmp/other.ts' },
        { url: 'https://cdn.example.test/seg.ts', filePath: '/tmp/seg-2.ts' }
      ]
    }
  };

  assert.equal(
    helpers.hlsPlaylistProxyCaptureFileForSourceUrl(state, 'https://cdn.example.test/seg.ts'),
    '/tmp/seg-1.ts'
  );
  assert.equal(
    helpers.hlsPlaylistProxyCaptureFileForSourceUrl(state, 'https://cdn.example.test/seg.ts'),
    '/tmp/seg-2.ts'
  );
  assert.equal(helpers.hlsPlaylistProxyCaptureFileForSourceUrl(state, 'https://cdn.example.test/seg.ts'), null);
  assert.equal(
    helpers.hlsPlaylistProxyCaptureFileForSourceUrl(state, 'https://cdn.example.test/other.ts'),
    '/tmp/other.ts'
  );
});

test('hls playback helper rewrites playlist URI references through one callback', function () {
  const seen = [];
  const playlist = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.key"',
    ' segment-1.ts ',
    '',
    '#EXTINF:4.0,',
    'https://cdn.example.test/segment-2.ts'
  ].join('\n');

  const rewritten = helpers.hlsPlaylistProxyRewritePlaylistContent(playlist, function (value) {
    seen.push(value);
    return 'proxy://' + value;
  });

  assert.deepEqual(seen, ['key.key', 'segment-1.ts', 'https://cdn.example.test/segment-2.ts']);
  assert.equal(
    rewritten,
    [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="proxy://key.key"',
      'proxy://segment-1.ts',
      '',
      '#EXTINF:4.0,',
      'proxy://https://cdn.example.test/segment-2.ts'
    ].join('\n')
  );
  assert.equal(
    helpers.hlsPlaylistProxyAbsoluteUri(' segment.ts?x=1&amp;y=2 ', 'https://cdn.example.test/path/master.m3u8'),
    'https://cdn.example.test/path/segment.ts?x=1&y=2'
  );
});
