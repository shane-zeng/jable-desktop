import type {
  CollectionDefinition,
  CollectionKey,
  DownloadSortKey,
  SearchMode,
  SortDirection,
  SortKey
} from '../types/jable';
import { DEFAULT_APP_SETTINGS, MAX_BROWSER_TABS_WARNING_THRESHOLD, PAGE_SIZE } from '../app-contract';
import { JABLE_PRIMARY_ORIGIN, jableCollectionUrl } from '../url-policy';

interface ValueOption<T extends string> {
  value: T;
}

export const DEFAULT_BROWSER_URL = JABLE_PRIMARY_ORIGIN + '/';
export const BROWSER_TABS_COMPACT_STORAGE_KEY = 'jable-desktop:browser-tabs-compact';
export const BROWSER_TABS_WIDTH_STORAGE_KEY = 'jable-desktop:browser-tabs-width';
export const BROWSER_TABS_DEFAULT_WIDTH = 280;
export const BROWSER_TABS_MIN_WIDTH = 180;
export const BROWSER_TABS_MAX_WIDTH = 420;
export { DEFAULT_APP_SETTINGS, MAX_BROWSER_TABS_WARNING_THRESHOLD, PAGE_SIZE };

export const COLLECTIONS: Record<CollectionKey, CollectionDefinition> = {
  favourites: {
    url: jableCollectionUrl('favourites'),
    filename: 'favourites_list.json'
  },
  watch_later: {
    url: jableCollectionUrl('watch_later'),
    filename: 'watch_later_list.json'
  }
};

export const SORT_OPTIONS: ValueOption<SortKey>[] = [
  { value: 'site_order' },
  { value: 'title' },
  { value: 'views' },
  { value: 'likes' }
];

export const SEARCH_MODE_OPTIONS: ValueOption<SearchMode>[] = [{ value: 'any' }, { value: 'all' }, { value: 'phrase' }];

export const DIRECTION_OPTIONS: ValueOption<SortDirection>[] = [{ value: 'asc' }, { value: 'desc' }];

export const DOWNLOAD_SORT_OPTIONS: ValueOption<DownloadSortKey>[] = [
  { value: 'updated_at' },
  { value: 'title' },
  { value: 'state' },
  { value: 'file_size' }
];
