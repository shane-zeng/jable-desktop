'use strict';

import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import { DEFAULT_APP_SETTINGS, FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS, MAX_BROWSER_TABS_LIMITS } from './app-contract';
import type { AppSettings, AppSettingsPatch } from './types/jable';

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

export const SETTINGS_FILE_NAME = 'settings.json';
export { DEFAULT_APP_SETTINGS };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};

  return {
    maxBrowserTabs: clampInteger(
      record.maxBrowserTabs,
      DEFAULT_APP_SETTINGS.maxBrowserTabs,
      MAX_BROWSER_TABS_LIMITS.min,
      MAX_BROWSER_TABS_LIMITS.max
    ),
    compactBrowserTabs: Boolean(record.compactBrowserTabs),
    fullSyncAjaxWindowSize: clampInteger(
      record.fullSyncAjaxWindowSize,
      DEFAULT_APP_SETTINGS.fullSyncAjaxWindowSize,
      FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS.min,
      FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS.max
    ),
    autoReplayDeferredSyncOperations: Boolean(record.autoReplayDeferredSyncOperations),
    ffmpegPath: normalizeNullableString(record.ffmpegPath)
  };
}

export function normalizeAppSettingsPatch(value: unknown): AppSettingsPatch {
  if (!isRecord(value)) return {};

  const patch: AppSettingsPatch = {};

  if (Object.prototype.hasOwnProperty.call(value, 'maxBrowserTabs')) {
    patch.maxBrowserTabs = clampInteger(
      value.maxBrowserTabs,
      DEFAULT_APP_SETTINGS.maxBrowserTabs,
      MAX_BROWSER_TABS_LIMITS.min,
      MAX_BROWSER_TABS_LIMITS.max
    );
  }
  if (Object.prototype.hasOwnProperty.call(value, 'compactBrowserTabs')) {
    patch.compactBrowserTabs = Boolean(value.compactBrowserTabs);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'fullSyncAjaxWindowSize')) {
    patch.fullSyncAjaxWindowSize = clampInteger(
      value.fullSyncAjaxWindowSize,
      DEFAULT_APP_SETTINGS.fullSyncAjaxWindowSize,
      FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS.min,
      FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS.max
    );
  }
  if (Object.prototype.hasOwnProperty.call(value, 'autoReplayDeferredSyncOperations')) {
    patch.autoReplayDeferredSyncOperations = Boolean(value.autoReplayDeferredSyncOperations);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'ffmpegPath')) {
    patch.ffmpegPath = normalizeNullableString(value.ffmpegPath);
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
