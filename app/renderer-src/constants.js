export const PAGE_SIZE = 24;
export const FULL_SYNC_BATCH_LIMIT = 100;
export const DEFAULT_BROWSER_URL = 'https://jable.tv/';
export const BROWSER_TABS_COMPACT_STORAGE_KEY = 'jable-desktop:browser-tabs-compact';
export const BROWSER_TABS_WIDTH_STORAGE_KEY = 'jable-desktop:browser-tabs-width';
export const BROWSER_TABS_DEFAULT_WIDTH = 280;
export const BROWSER_TABS_MIN_WIDTH = 180;
export const BROWSER_TABS_MAX_WIDTH = 420;

export const COLLECTIONS = {
  favourites: {
    name: '影片收藏',
    url: 'https://jable.tv/my/favourites/videos/',
    filename: 'favourites_list.json'
  },
  watch_later: {
    name: '稍後觀看',
    url: 'https://jable.tv/my/favourites/videos-watch-later/',
    filename: 'watch_later_list.json'
  }
};

export const SORT_OPTIONS = [
  { value: 'site_order', label: '網站排序' },
  { value: 'title', label: '標題' },
  { value: 'views', label: '觀看數' },
  { value: 'likes', label: '喜歡數' }
];

export const SEARCH_MODE_OPTIONS = [
  { value: 'any', label: '任一詞' },
  { value: 'all', label: '全部詞' },
  { value: 'phrase', label: '精確片語' }
];

export const DIRECTION_OPTIONS = [
  { value: 'asc', label: '遞增' },
  { value: 'desc', label: '遞減' }
];
