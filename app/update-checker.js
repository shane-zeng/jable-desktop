// @ts-check
'use strict';

var LATEST_RELEASE_API_URL = 'https://api.github.com/repos/shane-zeng/jable-favourites-exporter/releases/latest';
var USER_AGENT = 'Jable-Desktop';

function parseVersion(value) {
  var match = String(value || '')
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)$/i);

  if (!match) return null;

  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

function compareParsedVersions(left, right) {
  for (var i = 0; i < 3; i++) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }

  return 0;
}

function versionLabel(parsed) {
  return parsed.join('.');
}

function releaseVersion(release) {
  var candidates = [release && release.tag_name, release && release.name];

  for (var i = 0; i < candidates.length; i++) {
    var parsed = parseVersion(candidates[i]);
    if (parsed) return parsed;
  }

  return null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function evaluateReleaseUpdate(currentVersion, release) {
  var current = parseVersion(currentVersion);

  if (!current) {
    return {
      available: false,
      currentVersion: String(currentVersion || ''),
      reason: 'invalid-current-version'
    };
  }

  if (!release || typeof release !== 'object') {
    return {
      available: false,
      currentVersion: versionLabel(current),
      reason: 'missing-release'
    };
  }

  if (release.draft || release.prerelease) {
    return {
      available: false,
      currentVersion: versionLabel(current),
      reason: 'non-final-release'
    };
  }

  var latest = releaseVersion(release);

  if (!latest) {
    return {
      available: false,
      currentVersion: versionLabel(current),
      reason: 'invalid-release-version'
    };
  }

  if (!release.html_url) {
    return {
      available: false,
      currentVersion: versionLabel(current),
      latestVersion: versionLabel(latest),
      reason: 'missing-release-url'
    };
  }

  if (compareParsedVersions(latest, current) <= 0) {
    return {
      available: false,
      currentVersion: versionLabel(current),
      latestVersion: versionLabel(latest),
      reason: 'not-newer'
    };
  }

  return {
    available: true,
    currentVersion: versionLabel(current),
    latestVersion: versionLabel(latest),
    releaseUrl: String(release.html_url),
    reason: 'newer-release'
  };
}

async function checkLatestRelease(options) {
  options = options || {};

  try {
    var fetchImpl = options.fetch || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');

    var response = await fetchImpl(LATEST_RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT
      }
    });

    if (!response || !response.ok) {
      throw new Error('GitHub release check failed: HTTP ' + (response && response.status ? response.status : 0));
    }

    return evaluateReleaseUpdate(options.currentVersion, await response.json());
  } catch (error) {
    return {
      available: false,
      currentVersion: String(options.currentVersion || ''),
      error: errorMessage(error),
      reason: 'request-failed'
    };
  }
}

module.exports = {
  LATEST_RELEASE_API_URL: LATEST_RELEASE_API_URL,
  checkLatestRelease: checkLatestRelease,
  evaluateReleaseUpdate: evaluateReleaseUpdate,
  parseVersion: parseVersion
};
