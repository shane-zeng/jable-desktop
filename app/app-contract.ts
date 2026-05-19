'use strict';

import type { AppSettings } from './types/jable';

export const PAGE_SIZE = 24;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  maxBrowserTabs: 14,
  browserTabsMode: 'standard',
  compactBrowserTabs: false,
  restoreBrowserTabsOnStartup: false,
  webViewEnhancementMode: false,
  fullSyncAjaxWindowSize: 3,
  autoReplayDeferredSyncOperations: false,
  ffmpegPath: null,
  autoDownloadOnPlayback: false,
  downloadRoot: null,
  downloadStateFilters: ['all'],
  downloadSpeedMode: 'balanced',
  maxConcurrentDownloads: 1
};

export const MAX_BROWSER_TABS_LIMITS = {
  min: 4,
  max: 30
} as const;

export const FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS = {
  min: 1,
  max: 5
} as const;

export const MAX_CONCURRENT_DOWNLOADS_LIMITS = {
  min: 1,
  max: 3
} as const;

export const MAX_BROWSER_TABS_WARNING_THRESHOLD = 20;
