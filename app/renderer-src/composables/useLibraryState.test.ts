import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { PAGE_SIZE } from '../constants';
import { setLocale } from '../i18n';
import { useLibraryState } from './useLibraryState';
import type { JableAppApi, ListVideosOptions, SortKey, VideoRow } from '../../types/jable';

function makeRows(count: number): VideoRow[] {
  return Array.from({ length: count }, function (_, index) {
    return {
      title: 'Video ' + (index + 1),
      url: 'https://example.test/videos/' + (index + 1),
      views: null,
      likes: null,
      img: null,
      preview: null
    };
  });
}

function createPagedApi(rows: VideoRow[]) {
  return {
    countVideos: vi.fn().mockResolvedValue(rows.length),
    listVideos: vi.fn().mockImplementation(function (options: ListVideosOptions) {
      var start = options.offset || 0;
      var end = start + (options.limit || rows.length);
      return Promise.resolve(rows.slice(start, end));
    })
  };
}

function createState(api: Pick<JableAppApi, 'countVideos' | 'listVideos'>) {
  var scope = effectScope();
  var state = scope.run(function () {
    return useLibraryState(api as JableAppApi);
  });

  if (!state) throw new Error('Failed to create library state');

  return {
    state: state,
    stop: function () {
      scope.stop();
    }
  };
}

async function settleWatchers() {
  await nextTick();
  await flushPromises();
  await nextTick();
  await flushPromises();
}

describe('useLibraryState', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  it('refreshes videos with the current list parameters and loads one page at a time', async function () {
    var rows = makeRows(PAGE_SIZE + 1);
    var api = createPagedApi(rows);
    var setup = createState(api);

    try {
      await setup.state.refreshVideos();

      expect(api.countVideos).toHaveBeenCalledWith({
        collectionKey: 'favourites',
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc'
      });
      expect(api.listVideos).toHaveBeenCalledWith({
        collectionKey: 'favourites',
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        limit: PAGE_SIZE,
        offset: 0
      });
      expect(setup.state.rows.value).toHaveLength(PAGE_SIZE);
      expect(setup.state.totalPages.value).toBe(2);
      expect(setup.state.pageRows.value).toHaveLength(PAGE_SIZE);
      expect(setup.state.countLabel.value).toBe(PAGE_SIZE + 1 + ' 筆 · 每頁 ' + PAGE_SIZE + ' 筆');
      expect(setup.state.pageLabel.value).toBe('第 1 / 2 頁');

      await setup.state.goToPage(2);
      expect(setup.state.currentPage.value).toBe(2);
      expect(setup.state.pageRows.value).toHaveLength(1);
      expect(api.listVideos).toHaveBeenLastCalledWith({
        collectionKey: 'favourites',
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        limit: PAGE_SIZE,
        offset: PAGE_SIZE
      });

      await setup.state.goToPage(99);
      expect(setup.state.currentPage.value).toBe(2);

      await setup.state.goToPage(0);
      expect(setup.state.currentPage.value).toBe(1);
      expect(api.listVideos).toHaveBeenLastCalledWith({
        collectionKey: 'favourites',
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        limit: PAGE_SIZE,
        offset: 0
      });
    } finally {
      setup.stop();
    }
  });

  it('normalizes invalid sort values before listing videos', async function () {
    var api = {
      countVideos: vi.fn().mockResolvedValue(0),
      listVideos: vi.fn().mockResolvedValue([])
    };
    var setup = createState(api);

    try {
      setup.state.sort.value = 'unknown' as unknown as SortKey;
      await settleWatchers();

      var lastCall = api.listVideos.mock.calls[api.listVideos.mock.calls.length - 1][0];
      expect(setup.state.sort.value).toBe('site_order');
      expect(lastCall.sort).toBe('site_order');
    } finally {
      setup.stop();
    }
  });

  it('switches collections, resets the current page, and refreshes with the selected key', async function () {
    var api = createPagedApi(makeRows(PAGE_SIZE + 1));
    var setup = createState(api);

    try {
      await setup.state.refreshVideos();
      await setup.state.goToPage(2);

      await setup.state.selectCollection('watch_later');

      expect(setup.state.activeCollection.value).toBe('watch_later');
      expect(setup.state.currentPage.value).toBe(1);
      expect(api.listVideos).toHaveBeenLastCalledWith({
        collectionKey: 'watch_later',
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        limit: PAGE_SIZE,
        offset: 0
      });

      api.listVideos.mockClear();
      await setup.state.selectCollection('missing');

      expect(setup.state.activeCollection.value).toBe('watch_later');
      expect(api.listVideos).not.toHaveBeenCalled();
    } finally {
      setup.stop();
    }
  });

  it('uses updated search and direction values when watched filters change', async function () {
    var api = {
      countVideos: vi.fn().mockResolvedValue(0),
      listVideos: vi.fn().mockResolvedValue([])
    };
    var setup = createState(api);

    try {
      setup.state.search.value = 'keyword';
      setup.state.direction.value = 'desc';
      await settleWatchers();

      expect(api.listVideos).toHaveBeenLastCalledWith({
        collectionKey: 'favourites',
        search: 'keyword',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'desc',
        limit: PAGE_SIZE,
        offset: 0
      });
      expect(setup.state.currentPage.value).toBe(1);
    } finally {
      setup.stop();
    }
  });

  it('uses updated search mode when watched filters change', async function () {
    var api = {
      countVideos: vi.fn().mockResolvedValue(0),
      listVideos: vi.fn().mockResolvedValue([])
    };
    var setup = createState(api);

    try {
      setup.state.search.value = '肉便 老師';
      setup.state.searchMode.value = 'all';
      await settleWatchers();

      expect(api.listVideos).toHaveBeenLastCalledWith({
        collectionKey: 'favourites',
        search: '肉便 老師',
        searchMode: 'all',
        sort: 'site_order',
        direction: 'asc',
        limit: PAGE_SIZE,
        offset: 0
      });
      expect(setup.state.currentPage.value).toBe(1);
    } finally {
      setup.stop();
    }
  });

  it('formats pagination labels in English', async function () {
    setLocale('en-US', false);
    var rows = makeRows(PAGE_SIZE + 1);
    var api = createPagedApi(rows);
    var setup = createState(api);

    try {
      await setup.state.refreshVideos();

      expect(setup.state.countLabel.value).toBe(PAGE_SIZE + 1 + ' items · ' + PAGE_SIZE + ' per page');
      expect(setup.state.pageLabel.value).toBe('Page 1 / 2');
      expect(setup.state.fullSyncButtonLabel.value).toBe('Full Sync');
    } finally {
      setup.stop();
    }
  });
});
