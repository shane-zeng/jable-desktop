'use strict';

import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type { AppSettings, AppSettingsPatch } from './types/jable';

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

export const SETTINGS_FILE_NAME = 'settings.json';
export const DEFAULT_APP_SETTINGS: AppSettings = {
  maxBrowserTabs: 14,
  compactBrowserTabs: false,
  fullSyncAjaxWindowSize: 3,
  autoReplayDeferredSyncOperations: false
};

const MAX_BROWSER_TABS_MIN = 4;
const MAX_BROWSER_TABS_MAX = 30;
const FULL_SYNC_AJAX_WINDOW_SIZE_MIN = 1;
const FULL_SYNC_AJAX_WINDOW_SIZE_MAX = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};

  return {
    maxBrowserTabs: clampInteger(
      record.maxBrowserTabs,
      DEFAULT_APP_SETTINGS.maxBrowserTabs,
      MAX_BROWSER_TABS_MIN,
      MAX_BROWSER_TABS_MAX
    ),
    compactBrowserTabs: Boolean(record.compactBrowserTabs),
    fullSyncAjaxWindowSize: clampInteger(
      record.fullSyncAjaxWindowSize,
      DEFAULT_APP_SETTINGS.fullSyncAjaxWindowSize,
      FULL_SYNC_AJAX_WINDOW_SIZE_MIN,
      FULL_SYNC_AJAX_WINDOW_SIZE_MAX
    ),
    autoReplayDeferredSyncOperations: Boolean(record.autoReplayDeferredSyncOperations)
  };
}

export function normalizeAppSettingsPatch(value: unknown): AppSettingsPatch {
  if (!isRecord(value)) return {};

  const patch: AppSettingsPatch = {};

  if (Object.prototype.hasOwnProperty.call(value, 'maxBrowserTabs')) {
    patch.maxBrowserTabs = clampInteger(
      value.maxBrowserTabs,
      DEFAULT_APP_SETTINGS.maxBrowserTabs,
      MAX_BROWSER_TABS_MIN,
      MAX_BROWSER_TABS_MAX
    );
  }
  if (Object.prototype.hasOwnProperty.call(value, 'compactBrowserTabs')) {
    patch.compactBrowserTabs = Boolean(value.compactBrowserTabs);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'fullSyncAjaxWindowSize')) {
    patch.fullSyncAjaxWindowSize = clampInteger(
      value.fullSyncAjaxWindowSize,
      DEFAULT_APP_SETTINGS.fullSyncAjaxWindowSize,
      FULL_SYNC_AJAX_WINDOW_SIZE_MIN,
      FULL_SYNC_AJAX_WINDOW_SIZE_MAX
    );
  }
  if (Object.prototype.hasOwnProperty.call(value, 'autoReplayDeferredSyncOperations')) {
    patch.autoReplayDeferredSyncOperations = Boolean(value.autoReplayDeferredSyncOperations);
  }

  return patch;
}

export function settingsFilePath(userDataPath: string) {
  return path.join(userDataPath, SETTINGS_FILE_NAME);
}

export class AppSettingsStore {
  private readonly filePath: string;
  private settings: AppSettings | null;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.settings = null;
  }

  get(): AppSettings {
    if (!this.settings) this.settings = this.read();
    return Object.assign({}, this.settings);
  }

  update(patch: AppSettingsPatch): AppSettings {
    const next = normalizeAppSettings(Object.assign({}, this.get(), normalizeAppSettingsPatch(patch)));
    this.settings = next;
    this.write(next);
    return Object.assign({}, next);
  }

  private read(): AppSettings {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return normalizeAppSettings(JSON.parse(raw));
    } catch (error) {
      return Object.assign({}, DEFAULT_APP_SETTINGS);
    }
  }

  private write(settings: AppSettings) {
    const directory = path.dirname(this.filePath);
    const tempPath = this.filePath + '.tmp';

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tempPath, this.filePath);
  }
}
