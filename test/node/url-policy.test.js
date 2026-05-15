'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const urlPolicy = require('../../app/runtime-dist/url-policy');

test('allows only expected GitHub release URLs for external opening', function () {
  assert.equal(
    urlPolicy.isAllowedExternalReleaseUrl(
      'https://github.com/shane-zeng/jable-favourites-exporter/releases/tag/v0.7.3'
    ),
    true
  );
  assert.equal(
    urlPolicy.isAllowedExternalReleaseUrl('https://github.com/shane-zeng/jable-favourites-exporter/releases'),
    true
  );
  assert.equal(urlPolicy.isAllowedExternalReleaseUrl('https://github.com/other/repo/releases/tag/v1.0.0'), false);
  assert.equal(
    urlPolicy.isAllowedExternalReleaseUrl('http://github.com/shane-zeng/jable-favourites-exporter/releases/tag/v1.0.0'),
    false
  );
  assert.equal(urlPolicy.isAllowedExternalReleaseUrl('javascript:alert(1)'), false);
});

test('trusts only the primary and fallback Jable origins', function () {
  assert.equal(urlPolicy.isTrustedJableUrl('https://jable.tv/videos/sample/'), true);
  assert.equal(urlPolicy.isTrustedJableUrl('https://fs1.app/videos/sample/'), true);
  assert.equal(urlPolicy.isTrustedJableUrl('https://www.jable.tv/videos/sample/'), false);
  assert.equal(urlPolicy.isTrustedJableUrl('https://example.test/videos/sample/'), false);
  assert.equal(urlPolicy.isTrustedJableUrl('http://jable.tv/videos/sample/'), false);
});

test('classifies safe browser protocols', function () {
  assert.equal(urlPolicy.isSafeBrowserUrl('https://jable.tv/'), true);
  assert.equal(urlPolicy.isSafeBrowserUrl('http://example.test/'), true);
  assert.equal(urlPolicy.isSafeBrowserUrl('file:///etc/passwd'), false);
  assert.equal(urlPolicy.isSafeBrowserUrl('data:text/html,hello'), false);
  assert.equal(urlPolicy.isSafeBrowserUrl('javascript:alert(1)'), false);
});

test('recognizes trusted collection URLs on both Jable origins', function () {
  assert.equal(urlPolicy.isJableCollectionUrl('favourites', 'https://jable.tv/my/favourites/videos/'), true);
  assert.equal(urlPolicy.isJableCollectionUrl('favourites', 'https://fs1.app/my/favourites/videos'), true);
  assert.equal(
    urlPolicy.isJableCollectionUrl('watch_later', 'https://fs1.app/my/favourites/videos-watch-later/'),
    true
  );
  assert.equal(urlPolicy.isJableCollectionUrl('favourites', 'https://example.test/my/favourites/videos/'), false);
  assert.equal(
    urlPolicy.isJableCollectionUrl('favourites', 'https://fs1.app/my/favourites/videos-watch-later/'),
    false
  );
});

test('rewrites Jable URLs for canonical storage and fallback browsing', function () {
  assert.equal(
    urlPolicy.canonicalJableUrl('https://fs1.app/videos/sample/?from=test#hash'),
    'https://jable.tv/videos/sample/?from=test#hash'
  );
  assert.equal(
    urlPolicy.fallbackJableUrl('https://jable.tv/videos/sample/?from=test#hash'),
    'https://fs1.app/videos/sample/?from=test#hash'
  );
  assert.equal(urlPolicy.fallbackJableUrl('https://fs1.app/videos/sample/'), null);
  assert.equal(
    urlPolicy.rewriteJableUrlOrigin('https://jable.tv/videos/sample/', 'https://fs1.app'),
    'https://fs1.app/videos/sample/'
  );
});
