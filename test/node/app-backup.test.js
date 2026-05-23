'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAppBackupActions } = require('../../app/runtime-dist/main-process/app-backup');

function foreignAbsolutePath() {
  return process.platform === 'win32' ? '/Users/example/bin/ffmpeg' : 'C:\\Users\\example\\ffmpeg.exe';
}

test('app backup import drops settings paths that do not match the current platform', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jable-app-backup-'));
  const filePath = path.join(dir, 'settings-backup.json');
  const importedPath = foreignAbsolutePath();
  let updatedSettings = null;

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      kind: 'jable-desktop-settings-backup',
      format_version: 1,
      app_version: '0.12.10',
      exported_at: '2026-05-24T00:00:00.000Z',
      settings: {
        ffmpegPath: importedPath,
        downloadRoot: importedPath
      },
      renderer_preferences: {
        locale: 'zh-TW',
        browserTabsWidth: 280,
        downloadSidebarCollapsed: true,
        downloadSidebarWidth: 320
      }
    })
  );

  t.after(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const actions = createAppBackupActions({
    app: {
      getPath: function () {
        return dir;
      }
    },
    dialog: {
      showOpenDialog: async function () {
        return { canceled: false, filePaths: [filePath] };
      }
    },
    fs: fs,
    getAppSettings: function () {
      return {};
    },
    getAppVersion: function () {
      return '0.12.10';
    },
    getDatabase: function () {
      throw new Error('settings backup should not open the database');
    },
    getMainWindow: function () {
      return null;
    },
    hasActiveSyncRuns: function () {
      return false;
    },
    hasQueuedOrActiveDownloads: function () {
      return false;
    },
    path: path,
    t: function (key, params) {
      if (key === 'status.appBackupPathSkipped') return params.setting + ':' + params.path;
      return key;
    },
    updateAppSettings: function (settings) {
      updatedSettings = settings;
      return settings;
    }
  });

  const result = await actions.importAppBackup();

  assert.equal(result.canceled, false);
  assert.equal(result.kind, 'settings');
  assert.equal(updatedSettings.ffmpegPath, null);
  assert.equal(updatedSettings.downloadRoot, null);
  assert.deepEqual(result.warnings, ['ffmpegPath:' + importedPath, 'downloadRoot:' + importedPath]);
});
