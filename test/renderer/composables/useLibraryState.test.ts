import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { PAGE_SIZE } from '@/constants';
import { setLocale } from '@/i18n';
import { useLibraryState } from '@/composables/useLibraryState';
import type { DownloadRecord, JableAppApi, ListVideosOptions, SortKey, VideoRow } from '../../../app/types/jable';

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

function makeDownloadRecord(overrides: Partial<DownloadRecord>): DownloadRecord {
  return Object.assign(
    {
      videoUrl: 'https://jable.tv/videos/default/',
      collectionKeys: [],
      title: 'Default Video',
      img: null,
      preview: null,
      localPath: '/tmp/default.mp4',
      state: 'ready',
      progress: null,
      fileSizeBytes: null,
      error: null,
      failurePhase: null,
      failureCode: null,
      attemptCount: 0,
      lastStartedAt: null,
      lastErrorAt: null,
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      completedAt: null
    },
    overrides
  );
}

function createPagedApi(rows: VideoRow[]) {
  return {
    countVideos: vi.fn().mockResolvedValue(rows.length),
    listVideos: vi.fn().mockImplementation(function (options: ListVideosOptions) {
      const start = options.offset || 0;
      const end = start + (options.limit || rows.length);
      return Promise.resolve(rows.slice(start, end));
    }),
    listDownloads: vi.fn().mockResolvedValue([])
  };
}

function createState(api: Pick<JableAppApi, 'countVideos' | 'listVideos'>) {
  const scope = effectScope();
  const state = scope.run(function () {
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
    const rows = makeRows(PAGE_SIZE + 1);
    const api = createPagedApi(rows);
    const setup = createState(api);

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
    const api = {
      countVideos: vi.fn().mockResolvedValue(0),
      listVideos: vi.fn().mockResolvedValue([])
    };
    const setup = createState(api);

    try {
      setup.state.sort.value = 'unknown' as unknown as SortKey;
      await settleWatchers();

      const lastCall = api.listVideos.mock.calls[api.listVideos.mock.calls.length - 1][0];
      expect(setup.state.sort.value).toBe('site_order');
      expect(lastCall.sort).toBe('site_order');
    } finally {
      setup.stop();
    }
  });

  it('switches collections, resets the current page, and refreshes with the selected key', async function () {
    const api = createPagedApi(makeRows(PAGE_SIZE + 1));
    const setup = createState(api);

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

  it('switches to the download list without querying collection rows', async function () {
    const api = createPagedApi(makeRows(PAGE_SIZE + 1));
    const setup = createState(api);

    try {
      await setup.state.refreshVideos();
      await setup.state.goToPage(2);
      api.countVideos.mockClear();
      api.listVideos.mockClear();

      await setup.state.selectTab('downloads');

      expect(setup.state.activeTab.value).toBe('downloads');
      expect(setup.state.activeCollection.value).toBe('favourites');
      expect(setup.state.currentPage.value).toBe(1);
      expect(setup.state.rows.value).toEqual([]);
      expect(setup.state.totalRows.value).toBe(0);
      expect(setup.state.countLabel.value).toBe('0 筆下載');
      expect(api.countVideos).not.toHaveBeenCalled();
      expect(api.listVideos).not.toHaveBeenCalled();
      expect(api.listDownloads).toHaveBeenCalledTimes(1);
    } finally {
      setup.stop();
    }
  });

  it('filters and sorts download records locally', async function () {
    const downloads: DownloadRecord[] = [
      makeDownloadRecord({
        videoUrl: 'https://jable.tv/videos/beta/',
        collectionKeys: ['favourites'],
        title: 'Beta Video',
        img: null,
        preview: null,
        localPath: '/tmp/beta.mp4',
        state: 'ready',
        progress: null,
        fileSizeBytes: 2048,
        error: null,
        createdAt: '2026-05-16T00:00:00.000Z',
        updatedAt: '2026-05-16T00:00:02.000Z',
        completedAt: '2026-05-16T00:00:02.000Z'
      }),
      makeDownloadRecord({
        videoUrl: 'https://jable.tv/videos/alpha/',
        collectionKeys: ['watch_later'],
        title: 'Alpha Video',
        img: null,
        preview: null,
        localPath: '/tmp/alpha.mp4',
        state: 'failed',
        progress: null,
        fileSizeBytes: null,
        error: 'HTTP 403',
        createdAt: '2026-05-16T00:00:00.000Z',
        updatedAt: '2026-05-16T00:00:01.000Z',
        completedAt: null
      }),
      makeDownloadRecord({
        videoUrl: 'https://jable.tv/videos/gamma/',
        collectionKeys: ['watch_later'],
        title: 'Gamma Video',
        img: null,
        preview: null,
        localPath: '/tmp/gamma.mp4',
        state: 'downloading',
        progress: 0.5,
        fileSizeBytes: null,
        error: null,
        createdAt: '2026-05-16T00:00:00.000Z',
        updatedAt: '2026-05-16T00:00:03.000Z',
        completedAt: null
      }),
      makeDownloadRecord({
        videoUrl: 'https://jable.tv/videos/delta/',
        collectionKeys: [],
        title: 'Delta Video',
        img: null,
        preview: null,
        localPath: '/tmp/delta.mp4',
        state: 'queued',
        progress: null,
        fileSizeBytes: null,
        error: null,
        createdAt: '2026-05-16T00:00:00.000Z',
        updatedAt: '2026-05-16T00:00:04.000Z',
        completedAt: null
      })
    ];
    const api = createPagedApi([]);
    api.listDownloads.mockResolvedValue(downloads);
    const setup = createState(api);

    try {
      await setup.state.selectTab('downloads');

      expect(setup.state.downloadRecords.value.map((record) => record.title)).toEqual([
        'Beta Video',
        'Alpha Video',
        'Gamma Video',
        'Delta Video'
      ]);
      expect(setup.state.downloads.value.map((record) => record.title)).toEqual([
        'Delta Video',
        'Gamma Video',
        'Beta Video',
        'Alpha Video'
      ]);
      expect(setup.state.countLabel.value).toBe('4 筆下載');

      setup.state.downloadSearch.value = 'alpha';
      await nextTick();
      expect(setup.state.downloads.value.map((record) => record.title)).toEqual(['Alpha Video']);
      expect(setup.state.countLabel.value).toBe('1 筆下載');

      setup.state.downloadSearch.value = '';
      setup.state.downloadStateFilters.value = ['downloading', 'queued'];
      await nextTick();
      expect(setup.state.downloads.value.map((record) => record.title)).toEqual(['Delta Video', 'Gamma Video']);
      expect(setup.state.countLabel.value).toBe('2 筆下載');

      setup.state.downloadStateFilters.value = ['queued'];
      await nextTick();
      expect(setup.state.downloads.value.map((record) => record.title)).toEqual(['Delta Video']);
      expect(setup.state.countLabel.value).toBe('1 筆下載');

      setup.state.downloadStateFilters.value = ['downloading'];
      await nextTick();
      expect(setup.state.downloads.value.map((record) => record.title)).toEqual(['Gamma Video']);
      expect(setup.state.countLabel.value).toBe('1 筆下載');

      setup.state.downloadStateFilters.value = ['ready'];
      await nextTick();
      expect(setup.state.downloads.value.map((record) => record.title)).toEqual(['Beta Video']);
      expect(setup.state.countLabel.value).toBe('1 筆下載');

      setup.state.downloadStateFilters.value = ['failed'];
      await nextTick();
      expect(setup.state.downloads.value.map((record) => record.title)).toEqual(['Alpha Video']);
      expect(setup.state.countLabel.value).toBe('1 筆下載');

      setup.state.downloadStateFilters.value = ['downloading', 'queued', 'failed'];
      await nextTick();
      expect(setup.state.downloads.value.map((record) => record.title)).toEqual([
        'Delta Video',
        'Gamma Video',
        'Alpha Video'
      ]);
      expect(setup.state.countLabel.value).toBe('3 筆下載');

      setup.state.downloadStateFilters.value = ['ready'];
      setup.state.downloadSort.value = 'file_size';
      setup.state.downloadDirection.value = 'asc';
      await nextTick();

      expect(setup.state.downloads.value.map((record) => record.title)).toEqual(['Beta Video']);
      expect(api.listDownloads).toHaveBeenCalledTimes(1);
    } finally {
      setup.stop();
    }
  });

  it('uses updated search and direction values when watched filters change', async function () {
    const api = {
      countVideos: vi.fn().mockResolvedValue(0),
      listVideos: vi.fn().mockResolvedValue([])
    };
    const setup = createState(api);

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
    const api = {
      countVideos: vi.fn().mockResolvedValue(0),
      listVideos: vi.fn().mockResolvedValue([])
    };
    const setup = createState(api);

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

  it('uses the collection download filter in local list and count queries', async function () {
    const rows = makeRows(PAGE_SIZE + 1);
    const api = createPagedApi(rows);
    const setup = createState(api);

    try {
      await setup.state.refreshVideos();

      setup.state.collectionDownloadFilter.value = 'downloadable';
      await settleWatchers();

      expect(api.countVideos).toHaveBeenLastCalledWith({
        collectionKey: 'favourites',
        search: '',
        searchMode: 'any',
        downloadFilter: 'downloadable',
        sort: 'site_order',
        direction: 'asc'
      });
      expect(api.listVideos).toHaveBeenLastCalledWith({
        collectionKey: 'favourites',
        search: '',
        searchMode: 'any',
        downloadFilter: 'downloadable',
        sort: 'site_order',
        direction: 'asc',
        limit: PAGE_SIZE,
        offset: 0
      });
    } finally {
      setup.stop();
    }
  });

  it('tracks selected videos for batch downloads and clears selection when the page changes', async function () {
    const rows = makeRows(PAGE_SIZE + 1);
    const api = createPagedApi(rows);
    const setup = createState(api);

    try {
      await setup.state.refreshVideos();

      setup.state.toggleBatchDownloadSelection(rows[0].url, true);
      setup.state.toggleBatchDownloadSelection(rows[1].url, true);

      expect(setup.state.batchDownloadSelection.value).toEqual([rows[0].url, rows[1].url]);
      expect(setup.state.selectedBatchDownloadVideos.value.map((video) => video.url)).toEqual([
        rows[0].url,
        rows[1].url
      ]);

      setup.state.toggleBatchDownloadSelection(rows[0].url, false);
      expect(setup.state.batchDownloadSelection.value).toEqual([rows[1].url]);

      setup.state.selectBatchDownloadVideos([rows[0].url, rows[1].url, rows[0].url]);
      expect(setup.state.batchDownloadSelection.value).toEqual([rows[0].url, rows[1].url]);

      await setup.state.goToPage(2);
      expect(setup.state.batchDownloadSelection.value).toEqual([]);

      setup.state.toggleBatchDownloadSelection(rows[PAGE_SIZE].url, true);
      setup.state.search.value = 'Video';
      await settleWatchers();
      expect(setup.state.batchDownloadSelection.value).toEqual([]);
    } finally {
      setup.stop();
    }
  });

  it('formats pagination labels in English', async function () {
    setLocale('en-US', false);
    const rows = makeRows(PAGE_SIZE + 1);
    const api = createPagedApi(rows);
    const setup = createState(api);

    try {
      await setup.state.refreshVideos();

      expect(setup.state.countLabel.value).toBe(PAGE_SIZE + 1 + ' items · ' + PAGE_SIZE + ' per page');
      expect(setup.state.pageLabel.value).toBe('Page 1 / 2');
      expect(setup.state.fullSyncButtonLabel.value).toBe('Full Sync');
    } finally {
      setup.stop();
    }
  });

  it('formats pagination and sync labels in Japanese', async function () {
    setLocale('ja-JP', false);
    const rows = makeRows(PAGE_SIZE + 1);
    const api = createPagedApi(rows);
    const setup = createState(api);

    try {
      await setup.state.refreshVideos();

      expect(setup.state.countLabel.value).toBe(PAGE_SIZE + 1 + ' 件 · 1ページ ' + PAGE_SIZE + ' 件');
      expect(setup.state.pageLabel.value).toBe('ページ 1 / 2');
      expect(setup.state.fullSyncButtonLabel.value).toBe('フル同期');
    } finally {
      setup.stop();
    }
  });
});
