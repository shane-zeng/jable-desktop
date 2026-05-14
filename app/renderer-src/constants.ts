import type {
  CollectionDefinition,
  CollectionKey,
  SearchMode,
  SortDirection,
  SortKey
} from '../types/jable';

interface ValueOption<T extends string> {
  value: T;
}

export const PAGE_SIZE = 24;
export const FULL_SYNC_BATCH_LIMIT = 100;
export const DEFAULT_BROWSER_URL = 'https://jable.tv/';
export const BROWSER_TABS_COMPACT_STORAGE_KEY = 'jable-desktop:browser-tabs-compact';
export const BROWSER_TABS_WIDTH_STORAGE_KEY = 'jable-desktop:browser-tabs-width';
export const BROWSER_TABS_DEFAULT_WIDTH = 280;
export const BROWSER_TABS_MIN_WIDTH = 180;
export const BROWSER_TABS_MAX_WIDTH = 420;

export const COLLECTIONS: Record<CollectionKey, CollectionDefinition> = {
  favourites: {
    url: 'https://jable.tv/my/favourites/videos/',
    filename: 'favourites_list.json'
  },
  watch_later: {
    url: 'https://jable.tv/my/favourites/videos-watch-later/',
    filename: 'watch_later_list.json'
  }
};

export const SORT_OPTIONS: ValueOption<SortKey>[] = [
  { value: 'site_order' },
  { value: 'title' },
  { value: 'views' },
  { value: 'likes' }
];

export const SEARCH_MODE_OPTIONS: ValueOption<SearchMode>[] = [
  { value: 'any' },
  { value: 'all' },
  { value: 'phrase' }
];

export const DIRECTION_OPTIONS: ValueOption<SortDirection>[] = [
  { value: 'asc' },
  { value: 'desc' }
];
