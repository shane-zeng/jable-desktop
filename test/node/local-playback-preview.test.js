'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createLocalPlaybackPreviewController
} = require('../../app/runtime-dist/main-process/local-playback/preview.js');

function shellQuote(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function createNodeCommand(userDataDir, name, source) {
  const scriptPath = path.join(userDataDir, name + '.js');
  fs.writeFileSync(scriptPath, source);

  if (process.platform === 'win32') {
    const commandPath = path.join(userDataDir, name + '.cmd');
    fs.writeFileSync(commandPath, '@echo off\r\n"' + process.execPath + '" "' + scriptPath + '" %*\r\n');
    return commandPath;
  }

  const commandPath = path.join(userDataDir, name);
  fs.writeFileSync(
    commandPath,
    '#!/bin/sh\nexec ' + shellQuote(process.execPath) + ' ' + shellQuote(scriptPath) + ' "$@"\n'
  );
  fs.chmodSync(commandPath, 0o755);
  return commandPath;
}

function waitForCondition(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('timed out waiting for condition'));
        return;
      }
      setTimeout(poll, 10);
    }
    poll();
  });
}

test('local playback preview cancellation does not poison later generation', async function () {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-local-playback-preview-cancel-'));
  const warnings = [];
  const originalWarn = console.warn;

  try {
    const downloadRoot = path.join(userDataDir, 'downloads');
    const filePath = path.join(downloadRoot, 'local-playback.mp4');
    const videoUrl = 'https://jable.tv/videos/local-playback-preview-cancel/';
    const record = {
      videoUrl: videoUrl,
      localPath: 'local-playback.mp4'
    };
    fs.mkdirSync(downloadRoot, { recursive: true });
    fs.writeFileSync(filePath, Buffer.concat([Buffer.from('0000ftyp'), Buffer.alloc(64)]));

    const hangingFfmpeg = createNodeCommand(
      userDataDir,
      'hanging-preview-ffmpeg',
      [
        "'use strict';",
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const pattern = process.argv[process.argv.length - 1];',
        'fs.mkdirSync(path.dirname(pattern), { recursive: true });',
        'let index = 1;',
        'function outputPath() {',
        "  return pattern.replace('%06d', String(index++).padStart(6, '0'));",
        '}',
        "process.on('SIGTERM', function () { process.exit(143); });",
        "process.on('SIGINT', function () { process.exit(130); });",
        "setInterval(function () { fs.writeFileSync(outputPath(), 'jpeg'); }, 20);",
        ''
      ].join('\n')
    );
    const successfulFfmpeg = createNodeCommand(
      userDataDir,
      'successful-preview-ffmpeg',
      [
        "'use strict';",
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const pattern = process.argv[process.argv.length - 1];',
        'fs.mkdirSync(path.dirname(pattern), { recursive: true });',
        "fs.writeFileSync(pattern.replace('%06d', '000001'), 'jpeg');",
        ''
      ].join('\n')
    );

    let command = hangingFfmpeg;
    let notifyCount = 0;
    const controller = createLocalPlaybackPreviewController({
      ffmpegCommandForDownload: async function () {
        return command;
      },
      localPlaybackReadyFile: function () {
        return {
          record: record,
          filePath: filePath,
          stats: fs.statSync(filePath)
        };
      },
      localPlaybackScheme: 'jable-local-video',
      notifyDownloadsChanged: function () {
        notifyCount += 1;
      },
      resolveManagedDownloadPath: function (fileRelativePath) {
        return fileRelativePath ? path.join(downloadRoot, fileRelativePath) : null;
      }
    });

    console.warn = function (...args) {
      warnings.push(args.join(' '));
    };

    const readyFile = {
      record: record,
      filePath: filePath,
      stats: fs.statSync(filePath)
    };
    const tempDir = filePath + '.preview.tmp';
    const previewDir = filePath + '.preview';

    controller.scheduleGeneration(readyFile);
    await waitForCondition(function () {
      return (
        fs.existsSync(tempDir) &&
        fs.readdirSync(tempDir).some(function (fileName) {
          return /^thumb-\d{6}\.jpg$/.test(fileName);
        })
      );
    });

    controller.removeQueuedGeneration(videoUrl);
    controller.removeFiles(record);
    await waitForCondition(function () {
      return !fs.existsSync(tempDir);
    });

    command = successfulFfmpeg;
    controller.scheduleGeneration(readyFile);
    await waitForCondition(function () {
      return controller.readMetadata(readyFile) !== null;
    });

    assert.equal(fs.existsSync(previewDir), true);
    assert.equal(notifyCount, 1);
    assert.equal(
      warnings.some(function (message) {
        return message.includes('[local-playback-preview]');
      }),
      false
    );
  } finally {
    console.warn = originalWarn;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
