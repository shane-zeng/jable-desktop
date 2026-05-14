'use strict';

var childProcess = require('node:child_process');
var fs = require('node:fs');
var path = require('node:path');

var CHANGELOG_PATH = path.resolve(process.cwd(), 'CHANGELOG.md');
var releaseTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || process.argv[2];

if (!releaseTag) {
  console.error('Missing release tag. Set RELEASE_TAG or pass the tag as the first argument.');
  process.exit(1);
}

function runGit(args) {
  return childProcess.execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readRepositoryUrl() {
  if (process.env.GITHUB_REPOSITORY) {
    var serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
    return serverUrl.replace(/\/$/, '') + '/' + process.env.GITHUB_REPOSITORY;
  }

  try {
    var remote = runGit(['config', '--get', 'remote.origin.url']).trim();
    var sshMatch = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);

    if (sshMatch) {
      return 'https://' + sshMatch[1] + '/' + sshMatch[2];
    }

    return remote.replace(/\.git$/, '');
  } catch (_error) {
    return 'https://github.com/shane-zeng/jable-desktop';
  }
}

function readVersionTags() {
  return runGit(['tag', '--list', 'v*', '--sort=-v:refname'])
    .split('\n')
    .map(function (tag) {
      return tag.trim();
    })
    .filter(Boolean);
}

function readReleaseDate(tag) {
  var date = runGit(['for-each-ref', '--format=%(creatordate:short)', 'refs/tags/' + tag]).trim();
  return date || new Date().toISOString().slice(0, 10);
}

function findPreviousTag(tags, tag) {
  var index = tags.indexOf(tag);

  if (index === -1) {
    throw new Error('Tag not found in local git tags: ' + tag);
  }

  return tags[index + 1] || '';
}

function readCommitSubjects(previousTag, tag) {
  var range = previousTag ? previousTag + '..' + tag : tag;

  return runGit(['log', '--first-parent', '--reverse', '--pretty=format:%s', range])
    .split('\n')
    .map(function (subject) {
      return subject.trim();
    })
    .filter(Boolean)
    .filter(function (subject) {
      return !/^Update changelog for v[0-9]/.test(subject);
    });
}

function readUnreleasedBody(markdown) {
  var match = markdown.match(/## \[Unreleased\]\n\n[\s\S]*?(?=^## \[|$)/m);

  if (!match) {
    throw new Error('CHANGELOG.md must contain a "## [Unreleased]" section.');
  }

  return {
    body: match[0].replace(/^## \[Unreleased\]\n\n/, '').trim(),
    end: match.index + match[0].length,
    index: match.index
  };
}

function hasReleaseSection(markdown, tag) {
  return new RegExp('^## \\[' + escapeRegExp(tag) + '\\] - ', 'm').test(markdown);
}

function buildReleaseBody(unreleasedBody, previousTag, tag) {
  if (unreleasedBody) {
    return unreleasedBody;
  }

  var subjects = readCommitSubjects(previousTag, tag);

  if (subjects.length === 0) {
    return '### Changed\n\n- Release ' + tag + '.';
  }

  return (
    '### Changed\n\n' +
    subjects
      .map(function (subject) {
        return '- ' + subject;
      })
      .join('\n')
  );
}

function insertReleaseSection(markdown, tag, releaseDate, releaseBody) {
  if (hasReleaseSection(markdown, tag)) {
    return markdown;
  }

  var unreleased = readUnreleasedBody(markdown);
  var releaseSection = '## [' + tag + '] - ' + releaseDate + '\n\n' + releaseBody + '\n\n';

  return markdown.slice(0, unreleased.index) + '## [Unreleased]\n\n' + releaseSection + markdown.slice(unreleased.end);
}

function updateCompareLinks(markdown, tag, previousTag, repositoryUrl) {
  var lines = markdown.trimEnd().split('\n');
  var firstLinkIndex = lines.findIndex(function (line) {
    return /^\[(?:Unreleased|v[^\]]+)\]: /.test(line);
  });
  var bodyLines = firstLinkIndex === -1 ? lines : lines.slice(0, firstLinkIndex);
  var existingLinks = firstLinkIndex === -1 ? [] : lines.slice(firstLinkIndex);
  var tagLink = previousTag
    ? '[' + tag + ']: ' + repositoryUrl + '/compare/' + previousTag + '...' + tag
    : '[' + tag + ']: ' + repositoryUrl + '/releases/tag/' + tag;
  var newLinks = ['[Unreleased]: ' + repositoryUrl + '/compare/' + tag + '...HEAD', tagLink].concat(
    existingLinks.filter(function (line) {
      return (
        line && line !== '[Unreleased]: ' && !line.startsWith('[Unreleased]:') && !line.startsWith('[' + tag + ']:')
      );
    })
  );

  return bodyLines.join('\n').trimEnd() + '\n\n' + newLinks.join('\n') + '\n';
}

var changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
var tags = readVersionTags();
var previousTag = findPreviousTag(tags, releaseTag);
var releaseDate = readReleaseDate(releaseTag);
var unreleasedBody = hasReleaseSection(changelog, releaseTag) ? '' : readUnreleasedBody(changelog).body;
var releaseBody = buildReleaseBody(unreleasedBody, previousTag, releaseTag);
var repositoryUrl = readRepositoryUrl();
var nextChangelog = insertReleaseSection(changelog, releaseTag, releaseDate, releaseBody);

nextChangelog = updateCompareLinks(nextChangelog, releaseTag, previousTag, repositoryUrl);

if (nextChangelog === changelog) {
  console.log('CHANGELOG.md is already up to date for ' + releaseTag + '.');
  process.exit(0);
}

fs.writeFileSync(CHANGELOG_PATH, nextChangelog);
console.log('Updated CHANGELOG.md for ' + releaseTag + '.');
