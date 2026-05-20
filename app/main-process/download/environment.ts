'use strict';

import type * as Electron from 'electron';
import type * as NodeChildProcess from 'node:child_process';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type {
  AppSettings,
  AppSettingsPatch,
  DownloadRootInfo,
  DownloadRootSelectionResult,
  FfmpegPathSelectionResult,
  FfmpegStatus
} from '../../types/jable';
import { mainErrorMessage, sanitizeDownloadErrorDetail } from './errors';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;

export type DownloadEnvironmentController = {
  chooseDownloadRoot(): Promise<DownloadRootSelectionResult>;
  chooseFfmpegPath(): Promise<FfmpegPathSelectionResult>;
  clearDownloadRoot(): DownloadRootInfo;
  clearFfmpegPath(): Promise<FfmpegStatus>;
  ensureDownloadRootReady(): void;
  ffmpegCommandForDownload(): Promise<string>;
  getDownloadRoot(): DownloadRootInfo;
  getFfmpegStatus(): Promise<FfmpegStatus>;
  openDownloadRoot(): Promise<{ opened: boolean; path: string }>;
  openShellPath(filePath: string): Promise<void>;
  revealShellPath(filePath: string): void;
  setDownloadRoot(value: unknown): DownloadRootInfo;
  setFfmpegPath(value: unknown): Promise<FfmpegStatus>;
};

type DownloadEnvironmentControllerOptions = {
  app: Electron.App;
  dialog: typeof Electron.dialog;
  getAppSettings(): AppSettings;
  getMainWindow(): Electron.BrowserWindow | null;
  shell: typeof Electron.shell;
  t(key: string, params?: TranslationParams | null): string;
  updateAppSettings(patch: AppSettingsPatch): AppSettings;
};

const childProcess: typeof NodeChildProcess = require('node:child_process');
const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

const FFMPEG_CHECK_TIMEOUT_MS = 5000;
const FFMPEG_COMMAND = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

function shouldRunCommandThroughShell(command: string): boolean {
  return process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(command);
}

export function createDownloadEnvironmentController(
  options: DownloadEnvironmentControllerOptions
): DownloadEnvironmentController {
  function t(key: string, params?: TranslationParams | null): string {
    return options.t(key, params);
  }

  function ffmpegVersion(command: string): Promise<{ version: string; path: string }> {
    return new Promise(function (resolve, reject) {
      childProcess.execFile(
        command,
        ['-version'],
        {
          shell: shouldRunCommandThroughShell(command),
          timeout: FFMPEG_CHECK_TIMEOUT_MS,
          windowsHide: true
        },
        function (error, stdout) {
          if (error) {
            reject(error);
            return;
          }

          const firstLine = String(stdout || '').split(/\r?\n/)[0] || 'ffmpeg';
          resolve({
            version: firstLine,
            path: command
          });
        }
      );
    });
  }

  function ffmpegPathErrorStatus(filePath: string, error: unknown): FfmpegStatus {
    return {
      state: 'invalid_path',
      source: 'manual',
      path: filePath,
      version: null,
      error: mainErrorMessage(error)
    };
  }

  async function getFfmpegStatus(): Promise<FfmpegStatus> {
    const manualPath = options.getAppSettings().ffmpegPath;

    if (manualPath) {
      const resolvedPath = path.resolve(manualPath);

      try {
        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) return ffmpegPathErrorStatus(resolvedPath, new Error('Selected path is not a file'));
      } catch (error) {
        return ffmpegPathErrorStatus(resolvedPath, error);
      }

      try {
        const result = await ffmpegVersion(resolvedPath);
        return {
          state: 'detected',
          source: 'manual',
          path: result.path,
          version: result.version,
          error: null
        };
      } catch (error) {
        return {
          state: 'unsupported',
          source: 'manual',
          path: resolvedPath,
          version: null,
          error: mainErrorMessage(error)
        };
      }
    }

    try {
      const result = await ffmpegVersion(FFMPEG_COMMAND);
      return {
        state: 'detected',
        source: 'path',
        path: result.path,
        version: result.version,
        error: null
      };
    } catch (error) {
      return {
        state: 'missing',
        source: null,
        path: null,
        version: null,
        error: mainErrorMessage(error)
      };
    }
  }

  function setFfmpegPath(value: unknown): Promise<FfmpegStatus> {
    const filePath = typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : null;
    options.updateAppSettings({ ffmpegPath: filePath });
    return getFfmpegStatus();
  }

  function clearFfmpegPath(): Promise<FfmpegStatus> {
    options.updateAppSettings({ ffmpegPath: null });
    return getFfmpegStatus();
  }

  async function chooseFfmpegPath(): Promise<FfmpegPathSelectionResult> {
    const dialogOptions = {
      title: t('dialog.chooseFfmpeg'),
      properties: ['openFile'] as Electron.OpenDialogOptions['properties'],
      filters:
        process.platform === 'win32'
          ? [
              { name: 'FFmpeg', extensions: ['exe'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          : [{ name: 'All Files', extensions: ['*'] }]
    };
    const mainWindow = options.getMainWindow();
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await options.dialog.showOpenDialog(mainWindow, dialogOptions)
        : await options.dialog.showOpenDialog(dialogOptions);

    if (result.canceled || !result.filePaths.length) {
      return Object.assign(await getFfmpegStatus(), { canceled: true });
    }

    return setFfmpegPath(result.filePaths[0]);
  }

  function defaultDownloadRootPath(): string {
    return path.join(options.app.getPath('userData'), 'downloads');
  }

  function getDownloadRoot(): DownloadRootInfo {
    const manualRoot = options.getAppSettings().downloadRoot;
    const rootPath = manualRoot ? path.resolve(manualRoot) : defaultDownloadRootPath();
    let exists = false;

    try {
      exists = fs.statSync(rootPath).isDirectory();
    } catch (error) {
      exists = false;
    }

    return {
      source: manualRoot ? 'manual' : 'default',
      path: rootPath,
      exists: exists
    };
  }

  function ensureDownloadRootReady() {
    const root = getDownloadRoot();

    try {
      fs.mkdirSync(root.path, { recursive: true });
      if (!fs.statSync(root.path).isDirectory()) {
        throw new Error('Download location is not a directory');
      }
      fs.accessSync(root.path, fs.constants.W_OK);
    } catch (error) {
      throw new Error(
        t('status.downloadErrorFileSystem', {
          error: sanitizeDownloadErrorDetail(mainErrorMessage(error), root.path)
        })
      );
    }
  }

  function setDownloadRoot(value: unknown): DownloadRootInfo {
    const rootPath = typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : null;
    options.updateAppSettings({ downloadRoot: rootPath });
    return getDownloadRoot();
  }

  function clearDownloadRoot(): DownloadRootInfo {
    options.updateAppSettings({ downloadRoot: null });
    return getDownloadRoot();
  }

  async function chooseDownloadRoot(): Promise<DownloadRootSelectionResult> {
    const dialogOptions = {
      title: t('dialog.chooseDownloadRoot'),
      defaultPath: getDownloadRoot().path,
      properties: ['openDirectory', 'createDirectory'] as Electron.OpenDialogOptions['properties']
    };
    const mainWindow = options.getMainWindow();
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await options.dialog.showOpenDialog(mainWindow, dialogOptions)
        : await options.dialog.showOpenDialog(dialogOptions);

    if (result.canceled || !result.filePaths.length) {
      return Object.assign(getDownloadRoot(), { canceled: true });
    }

    return setDownloadRoot(result.filePaths[0]);
  }

  function openDownloadRoot(): Promise<{ opened: boolean; path: string }> {
    const root = getDownloadRoot();
    fs.mkdirSync(root.path, { recursive: true });

    return options.shell.openPath(root.path).then(function (errorMessage: string) {
      if (errorMessage) throw new Error(errorMessage);
      return {
        opened: true,
        path: root.path
      };
    });
  }

  function shouldBypassShellOpenForTests(): boolean {
    return process.env.JABLE_DESKTOP_TEST_BYPASS_SHELL_OPEN === '1';
  }

  function openShellPath(filePath: string): Promise<void> {
    if (shouldBypassShellOpenForTests()) return Promise.resolve();

    return options.shell.openPath(filePath).then(function (errorMessage: string) {
      if (errorMessage) throw new Error(errorMessage);
    });
  }

  function revealShellPath(filePath: string) {
    if (shouldBypassShellOpenForTests()) return;
    options.shell.showItemInFolder(filePath);
  }

  async function ffmpegCommandForDownload(): Promise<string> {
    const status = await getFfmpegStatus();
    if (status.state !== 'detected') throw new Error(t('status.ffmpegMissing'));
    return status.path || FFMPEG_COMMAND;
  }

  return {
    chooseDownloadRoot: chooseDownloadRoot,
    chooseFfmpegPath: chooseFfmpegPath,
    clearDownloadRoot: clearDownloadRoot,
    clearFfmpegPath: clearFfmpegPath,
    ensureDownloadRootReady: ensureDownloadRootReady,
    ffmpegCommandForDownload: ffmpegCommandForDownload,
    getDownloadRoot: getDownloadRoot,
    getFfmpegStatus: getFfmpegStatus,
    openDownloadRoot: openDownloadRoot,
    openShellPath: openShellPath,
    revealShellPath: revealShellPath,
    setDownloadRoot: setDownloadRoot,
    setFfmpegPath: setFfmpegPath
  };
}
