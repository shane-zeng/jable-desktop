'use strict';

import type { CollectionKey } from '../types/jable';

export type DatabaseCollection = { key: CollectionKey; name: string; sourcePath: string };

export const COLLECTIONS: DatabaseCollection[] = [
  { key: 'favourites', name: '影片收藏', sourcePath: '/my/favourites/videos/' },
  { key: 'watch_later', name: '稍後觀看', sourcePath: '/my/favourites/videos-watch-later/' }
];

export function collectionByKey(key: unknown): DatabaseCollection | null {
  for (let i = 0; i < COLLECTIONS.length; i++) {
    if (COLLECTIONS[i].key === key) return COLLECTIONS[i];
  }

  return null;
}
