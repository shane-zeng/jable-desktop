'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const removal = require('../../app/runtime-dist/main-process/safe-directory-removal.js');

function withPlatform(value, run) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value });
  try {
    return run();
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
}

test('Windows busy quarantine rename falls back without error diagnostics', function () {
  const originalRenameSync = fs.renameSync;
  const originalRm = fs.rm;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-removal-busy-'));
  const directory = path.join(root, 'locked');
  fs.mkdirSync(directory);
  const errors = [];
  const events = [];

  try {
    fs.renameSync = function () {
      const error = new Error('busy');
      error.code = 'EPERM';
      throw error;
    };
    fs.rm = function (_target, _options, callback) {
      callback(null);
    };

    withPlatform('win32', function () {
      removal.removeDirectoryAfterRename(
        directory,
        function (event, error, details) {
          errors.push({ event, error, details });
        },
        function (level, event, details) {
          events.push({ level, event, details });
        }
      );
    });

    assert.equal(errors.length, 0);
    assert.equal(
      events.some(function (event) {
        return event.level === 'info' && event.event === 'directory-quarantine-busy';
      }),
      true
    );
    assert.equal(
      events.some(function (event) {
        return event.level === 'info' && event.event === 'directory-removal-started';
      }),
      true
    );
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rm = originalRm;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Windows background removal defers locked directories without error diagnostics', function () {
  const originalSpawn = childProcess.spawn;
  const originalRenameSync = fs.renameSync;
  const originalRm = fs.rm;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-removal-deferred-'));
  const directory = path.join(root, 'locked');
  fs.mkdirSync(directory);
  const errors = [];
  const events = [];

  try {
    fs.renameSync = function (_from, to) {
      fs.mkdirSync(to, { recursive: true });
    };
    fs.rm = function (_target, _options, callback) {
      const error = new Error('busy');
      error.code = 'EBUSY';
      callback(error);
    };
    childProcess.spawn = function () {
      return {
        pid: 123,
        unref: function () {}
      };
    };

    withPlatform('win32', function () {
      removal.removeDirectoryAfterRename(
        directory,
        function (event, error, details) {
          errors.push({ event, error, details });
        },
        function (level, event, details) {
          events.push({ level, event, details });
        }
      );
    });

    assert.equal(errors.length, 0);
    assert.equal(
      events.some(function (event) {
        return event.level === 'info' && event.event === 'directory-removal-deferred';
      }),
      true
    );
  } finally {
    childProcess.spawn = originalSpawn;
    fs.renameSync = originalRenameSync;
    fs.rm = originalRm;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
