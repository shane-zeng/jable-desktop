'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var updateChecker = require('../../app/update-checker');

test('detects newer release versions with or without v prefix', function () {
  assert.deepEqual(updateChecker.evaluateReleaseUpdate('0.7.3', release('v0.7.4')), {
    available: true,
    currentVersion: '0.7.3',
    latestVersion: '0.7.4',
    releaseUrl: 'https://github.com/shane-zeng/jable-favourites-exporter/releases/tag/v0.7.4',
    reason: 'newer-release'
  });

  assert.equal(updateChecker.evaluateReleaseUpdate('0.7.3', release('0.7.4')).available, true);
});

test('ignores equal and older release versions', function () {
  assert.deepEqual(updateChecker.evaluateReleaseUpdate('0.7.3', release('v0.7.3')), {
    available: false,
    currentVersion: '0.7.3',
    latestVersion: '0.7.3',
    reason: 'not-newer'
  });

  assert.deepEqual(updateChecker.evaluateReleaseUpdate('0.7.3', release('v0.7.2')), {
    available: false,
    currentVersion: '0.7.3',
    latestVersion: '0.7.2',
    reason: 'not-newer'
  });
});

test('falls back to release name when tag is not a version', function () {
  assert.equal(
    updateChecker.evaluateReleaseUpdate('0.7.3', {
      tag_name: 'desktop-release',
      name: 'v0.7.4',
      html_url: 'https://github.com/shane-zeng/jable-favourites-exporter/releases/tag/desktop-release'
    }).available,
    true
  );
});

test('returns stable no-update results for invalid releases', function () {
  assert.deepEqual(updateChecker.evaluateReleaseUpdate('0.7.3', release('latest')), {
    available: false,
    currentVersion: '0.7.3',
    reason: 'invalid-release-version'
  });

  assert.deepEqual(
    updateChecker.evaluateReleaseUpdate('0.7.3', {
      tag_name: 'v0.7.4'
    }),
    {
      available: false,
      currentVersion: '0.7.3',
      latestVersion: '0.7.4',
      reason: 'missing-release-url'
    }
  );
});

test('returns a stable failure result for GitHub API errors', async function () {
  var httpResult = await updateChecker.checkLatestRelease({
    currentVersion: '0.7.3',
    fetch: async function () {
      return {
        ok: false,
        status: 500
      };
    }
  });

  assert.equal(httpResult.available, false);
  assert.equal(httpResult.reason, 'request-failed');
  assert.match(httpResult.error, /HTTP 500/);

  var rejectionResult = await updateChecker.checkLatestRelease({
    currentVersion: '0.7.3',
    fetch: async function () {
      throw new Error('network down');
    }
  });

  assert.equal(rejectionResult.available, false);
  assert.equal(rejectionResult.reason, 'request-failed');
  assert.equal(rejectionResult.error, 'network down');
});

function release(version) {
  return {
    tag_name: version,
    html_url: 'https://github.com/shane-zeng/jable-favourites-exporter/releases/tag/' + version
  };
}
