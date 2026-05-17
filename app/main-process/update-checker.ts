'use strict';

import { GITHUB_RELEASE_REPO } from '../browser/url-policy';

const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/' + GITHUB_RELEASE_REPO + '/releases/latest';
const USER_AGENT = 'Jable-Desktop';

type ParsedVersion = [number, number, number];

type GitHubRelease = {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
};

type ReleaseResponse = {
  ok?: boolean;
  status?: number;
  json(): Promise<unknown>;
};

type CheckLatestReleaseOptions = {
  currentVersion?: string;
  fetch?: (url: string, init: { headers: Record<string, string> }) => Promise<ReleaseResponse>;
};

function parseVersion(value: unknown): ParsedVersion | null {
  const match = String(value || '')
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)$/i);

  if (!match) return null;

  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

function compareParsedVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }

  return 0;
}

function versionLabel(parsed: ParsedVersion): string {
  return parsed.join('.');
}

function releaseVersion(release: GitHubRelease | null | undefined): ParsedVersion | null {
  const candidates = [release && release.tag_name, release && release.name];

  for (let i = 0; i < candidates.length; i++) {
    const parsed = parseVersion(candidates[i]);
    if (parsed) return parsed;
  }

  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function evaluateReleaseUpdate(currentVersion: unknown, release: unknown) {
  const current = parseVersion(currentVersion);

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

  const releaseInfo = release as GitHubRelease;

  if (releaseInfo.draft || releaseInfo.prerelease) {
    return {
      available: false,
      currentVersion: versionLabel(current),
      reason: 'non-final-release'
    };
  }

  const latest = releaseVersion(releaseInfo);

  if (!latest) {
    return {
      available: false,
      currentVersion: versionLabel(current),
      reason: 'invalid-release-version'
    };
  }

  if (!releaseInfo.html_url) {
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
    releaseUrl: String(releaseInfo.html_url),
    reason: 'newer-release'
  };
}

async function checkLatestRelease(options?: CheckLatestReleaseOptions | null) {
  options = options || {};

  try {
    const fetchImpl = (options.fetch || globalThis.fetch) as CheckLatestReleaseOptions['fetch'];
    if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');

    const response = await fetchImpl(LATEST_RELEASE_API_URL, {
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
