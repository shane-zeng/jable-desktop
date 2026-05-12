export const PAGE_SIZE = 24;
export const FULL_SYNC_BATCH_LIMIT = 100;
export const DEFAULT_BROWSER_URL = 'https://jable.tv/';
export const THEME_STORAGE_KEY = 'jable-desktop:theme';

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

export const DIRECTION_OPTIONS = [
  { value: 'asc', label: '遞增' },
  { value: 'desc', label: '遞減' }
];
