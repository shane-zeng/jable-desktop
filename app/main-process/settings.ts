'use strict';

import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import {
  DEFAULT_APP_SETTINGS,
  FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS,
  MAX_BROWSER_TABS_LIMITS,
  MAX_CONCURRENT_DOWNLOADS_LIMITS
} from '../app-contract';
import type {
  AppSettings,
  AppSettingsPatch,
  BrowserTabsMode,
  DownloadSpeedMode,
  DownloadStateFilter,
  DownloadStateFilters
} from '../types/jable';

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

const DOWNLOAD_STATE_FILTER_VALUES: DownloadStateFilter[] = [
  'all',
  'ready',
  'downloading',
  'queued',
  'paused',
  'failed',
  'missing'
];

function isDownloadStateFilter(value: unknown): value is DownloadStateFilter {
  return typeof value === 'string' && DOWNLOAD_STATE_FILTER_VALUES.indexOf(value as DownloadStateFilter) !== -1;
}

function addDownloadStateFilter(filters: Set<DownloadStateFilter>, value: unknown) {
  if (value === 'active') {
    filters.add('downloading');
    filters.add('queued');
    return;
  }
  if (isDownloadStateFilter(value)) filters.add(value);
}

function normalizeDownloadStateFilters(value: unknown, legacyValue?: unknown): DownloadStateFilters {
  const filters = new Set<DownloadStateFilter>();

  if (!Array.isArray(value)) {
    addDownloadStateFilter(filters, typeof value === 'undefined' ? legacyValue : value);
  } else {
    for (const item of value) {
      addDownloadStateFilter(filters, item);
    }
  }

  if (filters.size === 0 || filters.has('all')) return ['all'];
  return DOWNLOAD_STATE_FILTER_VALUES.filter(function (filter) {
    return filter !== 'all' && filters.has(filter);
  });
}

function normalizeDownloadSpeedMode(value: unknown): DownloadSpeedMode {
  if (value === 'stable' || value === 'fast') return value;
  return DEFAULT_APP_SETTINGS.downloadSpeedMode;
}

function normalizeBrowserTabsMode(value: unknown, compactFallback?: boolean): BrowserTabsMode {
  if (value === 'compact' || value === 'shared') return value;
  return compactFallback ? 'compact' : DEFAULT_APP_SETTINGS.browserTabsMode;
}

function cloneAppSettings(settings: AppSettings): AppSettings {
  return Object.assign({}, settings, {
    downloadStateFilters: settings.downloadStateFilters.slice()
  });
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};
  const browserTabsMode = normalizeBrowserTabsMode(record.browserTabsMode, Boolean(record.compactBrowserTabs));

  return {
    maxBrowserTabs: clampInteger(
      record.maxBrowserTabs,
      DEFAULT_APP_SETTINGS.maxBrowserTabs,
      MAX_BROWSER_TABS_LIMITS.min,
      MAX_BROWSER_TABS_LIMITS.max
    ),
    browserTabsMode: browserTabsMode,
    compactBrowserTabs: browserTabsMode === 'compact',
    restoreBrowserTabsOnStartup: Boolean(record.restoreBrowserTabsOnStartup),
    webViewEnhancementMode: Boolean(record.webViewEnhancementMode),
    fullSyncAjaxWindowSize: clampInteger(
      record.fullSyncAjaxWindowSize,
      DEFAULT_APP_SETTINGS.fullSyncAjaxWindowSize,
      FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS.min,
      FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS.max
    ),
    autoReplayDeferredSyncOperations: Boolean(record.autoReplayDeferredSyncOperations),
    ffmpegPath: normalizeNullableString(record.ffmpegPath),
    autoDownloadOnPlayback: Boolean(record.autoDownloadOnPlayback),
    downloadSidebarEnabled: Boolean(record.downloadSidebarEnabled),
    downloadRoot: normalizeNullableString(record.downloadRoot),
    downloadStateFilters: normalizeDownloadStateFilters(record.downloadStateFilters, record.downloadStateFilter),
    downloadSpeedMode: normalizeDownloadSpeedMode(record.downloadSpeedMode),
    maxConcurrentDownloads: clampInteger(
      record.maxConcurrentDownloads,
      DEFAULT_APP_SETTINGS.maxConcurrentDownloads,
      MAX_CONCURRENT_DOWNLOADS_LIMITS.min,
      MAX_CONCURRENT_DOWNLOADS_LIMITS.max
    )
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
    patch.browserTabsMode = patch.compactBrowserTabs ? 'compact' : 'standard';
  }
  if (Object.prototype.hasOwnProperty.call(value, 'browserTabsMode')) {
    patch.browserTabsMode = normalizeBrowserTabsMode(value.browserTabsMode);
    patch.compactBrowserTabs = patch.browserTabsMode === 'compact';
  }
  if (Object.prototype.hasOwnProperty.call(value, 'restoreBrowserTabsOnStartup')) {
    patch.restoreBrowserTabsOnStartup = Boolean(value.restoreBrowserTabsOnStartup);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'webViewEnhancementMode')) {
    patch.webViewEnhancementMode = Boolean(value.webViewEnhancementMode);
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
  if (Object.prototype.hasOwnProperty.call(value, 'autoDownloadOnPlayback')) {
    patch.autoDownloadOnPlayback = Boolean(value.autoDownloadOnPlayback);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'downloadSidebarEnabled')) {
    patch.downloadSidebarEnabled = Boolean(value.downloadSidebarEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'downloadRoot')) {
    patch.downloadRoot = normalizeNullableString(value.downloadRoot);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'downloadStateFilters')) {
    patch.downloadStateFilters = normalizeDownloadStateFilters(value.downloadStateFilters);
  } else if (Object.prototype.hasOwnProperty.call(value, 'downloadStateFilter')) {
    patch.downloadStateFilters = normalizeDownloadStateFilters(value.downloadStateFilter);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'downloadSpeedMode')) {
    patch.downloadSpeedMode = normalizeDownloadSpeedMode(value.downloadSpeedMode);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'maxConcurrentDownloads')) {
    patch.maxConcurrentDownloads = clampInteger(
      value.maxConcurrentDownloads,
      DEFAULT_APP_SETTINGS.maxConcurrentDownloads,
      MAX_CONCURRENT_DOWNLOADS_LIMITS.min,
      MAX_CONCURRENT_DOWNLOADS_LIMITS.max
    );
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
    return cloneAppSettings(this.settings);
  }

  update(patch: AppSettingsPatch): AppSettings {
    const next = normalizeAppSettings(Object.assign({}, this.get(), normalizeAppSettingsPatch(patch)));
    this.settings = next;
    this.write(next);
    return cloneAppSettings(next);
  }

  private read(): AppSettings {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return normalizeAppSettings(JSON.parse(raw));
    } catch (error) {
      return normalizeAppSettings({});
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
