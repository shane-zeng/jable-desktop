'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const helpers = require('../../app/runtime-dist/browser/webview-preload-helpers.js');

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

test('webview helper retries ajax HTML fetches with reported delay details', async function () {
  const retryEvents = [];
  const sleepDelays = [];
  let calls = 0;
  const html = await helpers.fetchAjaxHtmlWithRetry(
    'https://jable.tv/my/favourites/videos/?mode=async',
    3,
    function (event) {
      retryEvents.push(event);
    },
    {
      fetchText: async function () {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            detail: 'HTTP 500 Server Error',
            reason: 'http-500',
            retryable: true,
            retryAfterMs: 1000,
            status: 500
          };
        }

        return {
          ok: true,
          retryAfterMs: null,
          status: 200,
          text: '<div>ok</div>'
        };
      },
      random: function () {
        return 0;
      },
      sleep: async function (ms) {
        sleepDelays.push(ms);
      }
    }
  );

  assert.equal(html, '<div>ok</div>');
  assert.equal(calls, 2);
  assert.deepEqual(sleepDelays, [1250]);
  assert.deepEqual(retryEvents, [
    {
      attempt: 1,
      delayMs: 1250,
      maxRetries: 3,
      pageNumber: 3,
      reason: 'HTTP 500 Server Error'
    }
  ]);
});

test('webview helper retries ajax sync page parsing without real network fetches', async function () {
  const retryEvents = [];
  const sleepDelays = [];
  const fetchedUrls = [];
  let parseCalls = 0;
  const page = await helpers.fetchAjaxSyncPage({
    expectedLastPage: 3,
    fetchText: async function (url) {
      fetchedUrls.push(url);
      return {
        ok: true,
        retryAfterMs: null,
        status: 200,
        text: '<div>ok</div>'
      };
    },
    isTrustedUrl: function () {
      return true;
    },
    onRetry: function (event) {
      retryEvents.push(event);
    },
    pageNumber: 2,
    parsePage: function (html, url, pageNumber, expectedLastPage) {
      parseCalls += 1;
      if (parseCalls === 1) {
        throw new helpers.AjaxSyncError('ajax-empty-page', 'AJAX page contained no rows', null, true);
      }

      return {
        pageNumber: pageNumber,
        rows: [{ url: 'https://jable.tv/videos/three/' }],
        signature: html,
        lastPage: expectedLastPage,
        url: url
      };
    },
    random: function () {
      return 0;
    },
    sleep: async function (ms) {
      sleepDelays.push(ms);
    },
    template: {
      ajaxUrl: 'https://jable.tv/my/favourites/videos/?mode=async&from=0001',
      pageParamName: 'from',
      pageParamWidth: 4
    }
  });

  assert.equal(parseCalls, 2);
  assert.deepEqual(fetchedUrls, [
    'https://jable.tv/my/favourites/videos/?mode=async&from=0002',
    'https://jable.tv/my/favourites/videos/?mode=async&from=0002'
  ]);
  assert.deepEqual(sleepDelays, [1250]);
  assert.deepEqual(retryEvents, [
    {
      attempt: 1,
      delayMs: 1250,
      maxRetries: 3,
      pageNumber: 2,
      reason: 'AJAX page contained no rows'
    }
  ]);
  assert.deepEqual(page, {
    pageNumber: 2,
    rows: [{ url: 'https://jable.tv/videos/three/' }],
    signature: '<div>ok</div>',
    lastPage: 3,
    url: 'https://jable.tv/my/favourites/videos/?mode=async&from=0002'
  });
});

test('webview helper runs bounded ajax page fetches concurrently while preserving result order', async function () {
  const started = [];
  const completed = [];
  const pages = await helpers.fetchAjaxPagesWithWindow({
    start: 2,
    end: 5,
    windowSize: 2,
    onPageStart: function (pageNumber) {
      started.push(pageNumber);
    },
    fetchPage: async function (pageNumber) {
      completed.push(pageNumber);
      return { pageNumber: pageNumber };
    },
    pageDelayMs: function () {
      return 0;
    },
    sleep: async function () {}
  });

  assert.deepEqual(started, [2, 3, 4, 5]);
  assert.deepEqual(completed, [2, 3, 4, 5]);
  assert.deepEqual(
    pages.map(function (page) {
      return page.pageNumber;
    }),
    [2, 3, 4, 5]
  );
});

test('webview helper validates ajax page duplicates and first page stability', function () {
  const firstRows = [{ url: 'https://jable.tv/videos/one/' }, { url: 'https://jable.tv/videos/two/' }];
  const page = {
    pageNumber: 2,
    rows: [{ url: 'https://jable.tv/videos/three/' }],
    signature: '2|one|two',
    lastPage: 2,
    url: 'https://jable.tv/my/favourites/videos/?from=0024'
  };

  assert.doesNotThrow(function () {
    helpers.validateAjaxFirstPage(firstRows, '2|one|two', {
      pageNumber: 1,
      rows: firstRows,
      signature: '2|one|two',
      lastPage: 2,
      url: 'https://jable.tv/my/favourites/videos/'
    });
    helpers.validateAjaxPages(firstRows, [page]);
  });

  assert.throws(function () {
    helpers.validateAjaxPages(firstRows, [
      Object.assign({}, page, {
        rows: [{ url: 'https://jable.tv/videos/two/' }]
      })
    ]);
  }, /AJAX page returned a duplicate URL/);

  assert.throws(function () {
    helpers.validateAjaxFirstPage(firstRows, '2|one|two', {
      pageNumber: 1,
      rows: firstRows,
      signature: '2|changed',
      lastPage: 2,
      url: 'https://jable.tv/my/favourites/videos/'
    });
  }, /AJAX first page signature changed during sync/);
});
