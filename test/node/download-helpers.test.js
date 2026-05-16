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

test('parses HLS master playlist variants', function () {
  const playlist = helpers.parseHlsPlaylist(
    [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480',
      '480p/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
      'https://cdn.example.test/hls/720p/index.m3u8?token=abc'
    ].join('\n'),
    'https://cdn.example.test/hls/master.m3u8'
  );

  assert.deepEqual(playlist.variants, [
    {
      url: 'https://cdn.example.test/hls/480p/index.m3u8',
      bandwidth: 1200000
    },
    {
      url: 'https://cdn.example.test/hls/720p/index.m3u8?token=abc',
      bandwidth: 2800000
    }
  ]);
  assert.deepEqual(playlist.segments, []);
});

test('parses HLS media playlist segments and AES-128 key metadata', function () {
  const playlist = helpers.parseHlsPlaylist(
    [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1234',
      '#EXTINF:5.5,',
      'seg-0001.ts',
      '#EXTINF:6,',
      'https://cdn.example.test/hls/seg-0002.ts?token=abc',
      '#EXT-X-ENDLIST'
    ].join('\n'),
    'https://cdn.example.test/hls/index.m3u8'
  );

  assert.equal(playlist.targetDuration, 6);
  assert.deepEqual(playlist.segments, [
    {
      url: 'https://cdn.example.test/hls/seg-0001.ts',
      duration: 5.5,
      key: {
        method: 'AES-128',
        uri: 'https://cdn.example.test/hls/key.bin',
        iv: '0x1234'
      }
    },
    {
      url: 'https://cdn.example.test/hls/seg-0002.ts?token=abc',
      duration: 6,
      key: {
        method: 'AES-128',
        uri: 'https://cdn.example.test/hls/key.bin',
        iv: '0x1234'
      }
    }
  ]);
});

test('builds local HLS playlist with local key and segment files', function () {
  assert.equal(
    helpers.buildLocalHlsPlaylist(
      [
        {
          fileName: 'segment-000001.ts',
          duration: 5.5,
          keyFileName: 'key-000001.key',
          keyMethod: 'AES-128',
          keyIv: '0x1234'
        },
        {
          fileName: 'segment-000002.ts',
          duration: 6,
          keyFileName: 'key-000001.key',
          keyMethod: 'AES-128',
          keyIv: '0x1234'
        },
        {
          fileName: 'segment-000003.ts',
          duration: 6,
          keyFileName: null,
          keyMethod: null,
          keyIv: null
        }
      ],
      6
    ),
    [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-KEY:METHOD=AES-128,URI="key-000001.key",IV=0x1234',
      '#EXTINF:5.5,',
      'segment-000001.ts',
      '#EXTINF:6,',
      'segment-000002.ts',
      '#EXT-X-KEY:METHOD=NONE',
      '#EXTINF:6,',
      'segment-000003.ts',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n')
  );
});

test('builds HLS fetch headers with playback context', function () {
  assert.deepEqual(helpers.hlsRequestHeaders('https://jable.tv/videos/sample/', 'session=abc'), {
    accept: '*/*',
    referer: 'https://jable.tv/videos/sample/',
    'user-agent': helpers.DOWNLOAD_USER_AGENT,
    cookie: 'session=abc'
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
