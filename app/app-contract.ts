'use strict';

import type { AppSettings } from './types/jable';

export const PAGE_SIZE = 24;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  maxBrowserTabs: 14,
  compactBrowserTabs: false,
  fullSyncAjaxWindowSize: 3,
  autoReplayDeferredSyncOperations: false
};

export const MAX_BROWSER_TABS_LIMITS = {
  min: 4,
  max: 30
} as const;

export const FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS = {
  min: 1,
  max: 5
} as const;

export const MAX_BROWSER_TABS_WARNING_THRESHOLD = 20;
