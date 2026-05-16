'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const helpers = require('../../app/runtime-dist/webview-preload-helpers.js');

test('webview helper constants stay aligned with app contract limits', function () {
  assert.equal(helpers.SITE_PAGE_SIZE, 24);
  assert.equal(helpers.DEFAULT_FULL_SYNC_AJAX_WINDOW_SIZE, 3);
  assert.equal(helpers.MAX_FULL_SYNC_AJAX_WINDOW_SIZE, 5);
  assert.equal(helpers.normalizeAjaxWindowSize(undefined), 3);
  assert.equal(helpers.normalizeAjaxWindowSize(99), 5);
  assert.equal(helpers.normalizeAjaxWindowSize(-10), 1);
});

test('webview helper parses metrics, pages, and video path keys', function () {
  assert.equal(helpers.parseMetricNumber('1,234 views'), 1234);
  assert.equal(helpers.parseMetricNumber('0'), null);
  assert.equal(helpers.normalizePageNumber('page 12'), 12);
  assert.equal(helpers.normalizePageNumber('unknown'), 1);
  assert.equal(helpers.readPageNumber('第 9 頁'), 9);
  assert.equal(helpers.readPageNumber('next'), null);
  assert.equal(helpers.videoPathKey('https://fs1.app/videos/sample', 'https://jable.tv/'), '/videos/sample/');
  assert.equal(helpers.videoPathKey('https://jable.tv/categories/', 'https://jable.tv/'), '');
});

test('webview helper builds ajax URLs from pager parameters', function () {
  const ajaxUrl = helpers.ajaxUrlForPagerLink(
    'list_videos_my_favourite_videos',
    'from:0024;sort_by:post_date;path:%2Fmy%2Ffavourites%2Fvideos%2F',
    'https://jable.tv/my/favourites/videos/#pager'
  );

  assert.equal(
    ajaxUrl,
    'https://jable.tv/my/favourites/videos/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos&from=0024&sort_by=post_date&path=%2Fmy%2Ffavourites%2Fvideos%2F'
  );
  assert.equal(
    helpers.ajaxUrlForPage(
      {
        ajaxUrl: ajaxUrl,
        pageParamName: 'from',
        pageParamWidth: 4
      },
      3
    ),
    'https://jable.tv/my/favourites/videos/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos&from=0003&sort_by=post_date&path=%2Fmy%2Ffavourites%2Fvideos%2F'
  );
});

test('webview helper calculates retry and failure details', function () {
  assert.equal(helpers.isRetryableAjaxStatus(403), true);
  assert.equal(helpers.isRetryableAjaxStatus(429), true);
  assert.equal(helpers.isRetryableAjaxStatus(500), true);
  assert.equal(helpers.isRetryableAjaxStatus(404), false);
  assert.equal(helpers.fetchFailureDetail('http-500', 500, 'Server Error'), 'HTTP 500 Server Error');
  assert.equal(helpers.fetchFailureDetail('timeout'), 'request timeout');
  assert.equal(helpers.parseRetryAfterMs('2', 1000), 2000);
  assert.equal(helpers.parseRetryAfterMs('Thu, 01 Jan 1970 00:00:03 GMT', 1000), 2000);
  assert.equal(
    helpers.ajaxRetryDelayMs(2, null, function () {
      return 0;
    }),
    2250
  );
  assert.equal(
    helpers.ajaxRetryDelayMs(2, 3000, function () {
      return 0;
    }),
    3250
  );
});
