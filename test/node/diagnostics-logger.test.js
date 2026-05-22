'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const diagnostics = require('../../app/runtime-dist/main-process/diagnostics/logger.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jable-diagnostics-'));
}

function readJsonLines(directoryPath) {
  return fs
    .readdirSync(directoryPath)
    .filter(function (name) {
      return /^app-.*\.jsonl$/.test(name);
    })
    .sort()
    .flatMap(function (name) {
      return fs
        .readFileSync(path.join(directoryPath, name), 'utf8')
        .trim()
        .split(/\n/)
        .filter(Boolean)
        .map(function (line) {
          return JSON.parse(line);
        });
    });
}

function writeFileWithMtime(filePath, text, mtime) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
  fs.utimesSync(filePath, mtime, mtime);
}

test('diagnostics logger writes JSONL and redacts sensitive values', function () {
  const directory = tempDir();
  const userData = path.join(directory, 'user-data');
  const logger = diagnostics.createDiagnosticsLogger(path.join(userData, 'logs'), {
    now: function () {
      return new Date('2026-05-22T01:02:03.000Z');
    },
    pathTokens: function () {
      return [{ label: 'userData', value: userData }];
    }
  });
  const circular = { name: 'root' };
  circular.self = circular;

  logger.event('error', 'test', 'redaction', {
    url: 'https://jable.tv/videos/example-id/',
    cookie: 'secret-cookie',
    localPath: path.join(userData, 'downloads', 'video.mp4'),
    localBackslashPath: path.join(userData, 'downloads', 'video.mp4').replace(/\//g, '\\'),
    windowsPath: 'C:\\Users\\alice\\AppData\\Roaming\\Jable Desktop\\logs\\app.log',
    windowsForwardPath: 'C:/Users/alice/AppData/Roaming/Jable Desktop/logs/app.log',
    circular
  });

  const entries = readJsonLines(path.join(userData, 'logs'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, 'error');
  assert.equal(entries[0].process, 'main');
  assert.equal(entries[0].details.cookie, '[redacted]');
  assert.match(entries[0].details.url, /^\[remote URL host=jable\.tv hash=[a-f0-9]{16}\]$/);
  assert.equal(entries[0].details.localPath, '[userData]/downloads/video.mp4');
  assert.equal(entries[0].details.localBackslashPath, '[userData]\\downloads\\video.mp4');
  assert.equal(entries[0].details.windowsPath, '[local path]');
  assert.equal(entries[0].details.windowsForwardPath, '[local path]');
  assert.equal(entries[0].details.circular.self, '[Circular]');
});

test('diagnostics logger rotates app JSONL files when the file limit is reached', function () {
  const logDirectory = path.join(tempDir(), 'logs');
  const logger = diagnostics.createDiagnosticsLogger(logDirectory, {
    fileMaxBytes: 1,
    now: function () {
      return new Date('2026-05-22T00:00:00.000Z');
    }
  });

  logger.event('info', 'test', 'one', { message: 'one' });
  logger.event('info', 'test', 'two', { message: 'two' });
  logger.event('info', 'test', 'three', { message: 'three' });

  assert.deepEqual(
    fs
      .readdirSync(logDirectory)
      .filter(function (name) {
        return /^app-.*\.jsonl$/.test(name);
      })
      .sort(),
    ['app-2026-05-22-2.jsonl', 'app-2026-05-22-3.jsonl', 'app-2026-05-22.jsonl']
  );
});

test('diagnostics logger prunes old logs and enforces total size', function () {
  const logDirectory = path.join(tempDir(), 'logs');
  const now = new Date('2026-05-22T00:00:00.000Z');
  const old = new Date('2026-05-01T00:00:00.000Z');
  const newer = new Date('2026-05-21T00:00:00.000Z');
  const newest = new Date('2026-05-22T00:00:00.000Z');
  const logger = diagnostics.createDiagnosticsLogger(logDirectory, {
    retentionDays: 14,
    totalMaxBytes: 15,
    now: function () {
      return now;
    }
  });

  writeFileWithMtime(path.join(logDirectory, 'app-2026-05-01.jsonl'), 'old', old);
  writeFileWithMtime(path.join(logDirectory, 'app-2026-05-21.jsonl'), '1234567890', newer);
  writeFileWithMtime(path.join(logDirectory, 'app-2026-05-22.jsonl'), '1234567890', newest);
  logger.prune();

  const files = fs
    .readdirSync(logDirectory)
    .filter(function (name) {
      return /^app-.*\.jsonl$/.test(name);
    })
    .sort();
  assert.deepEqual(files, ['app-2026-05-22.jsonl']);
});

test('diagnostics logger keeps only the newest crash dumps and clears diagnostics files', function () {
  const logDirectory = path.join(tempDir(), 'logs');
  const crashDirectory = path.join(logDirectory, 'crashes');
  const logger = diagnostics.createDiagnosticsLogger(logDirectory, {
    crashDumpMaxFiles: 10
  });

  for (let i = 0; i < 12; i++) {
    writeFileWithMtime(
      path.join(crashDirectory, 'crash-' + i + '.dmp'),
      'dump',
      new Date('2026-05-22T00:00:' + String(i).padStart(2, '0') + '.000Z')
    );
  }
  writeFileWithMtime(path.join(logDirectory, 'app-2026-05-22.jsonl'), '{}\n', new Date());
  logger.prune();

  assert.equal(fs.readdirSync(crashDirectory).length, 10);

  const result = logger.clearDiagnostics();
  assert.equal(result.canceled, false);
  assert.equal(result.failedFiles, 0);
  assert.equal(result.deletedFiles, 11);
  assert.deepEqual(fs.readdirSync(crashDirectory), []);
});
