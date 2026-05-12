import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { PAGE_SIZE } from '../constants';
import { useLibraryState } from './useLibraryState';

function makeRows(count) {
  return Array.from({ length: count }, function (_, index) {
    return {
      title: 'Video ' + (index + 1),
      url: 'https://example.test/videos/' + (index + 1)
    };
  });
}

function createState(api) {
  var scope = effectScope();
  var state;

  scope.run(function () {
    state = useLibraryState(api);
  });

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
  it('refreshes videos with the current list parameters and paginates rows', async function () {
    var rows = makeRows(PAGE_SIZE + 1);
    var api = {
      listVideos: vi.fn().mockResolvedValue(rows)
    };
    var setup = createState(api);

    try {
      await setup.state.refreshVideos();

      expect(api.listVideos).toHaveBeenCalledWith({
        collectionKey: 'favourites',
        search: '',
        sort: 'site_order',
        direction: 'asc'
      });
      expect(setup.state.totalPages.value).toBe(2);
      expect(setup.state.pageRows.value).toHaveLength(PAGE_SIZE);
      expect(setup.state.countLabel.value).toBe((PAGE_SIZE + 1) + ' 筆 · 每頁 ' + PAGE_SIZE + ' 筆');
      expect(setup.state.pageLabel.value).toBe('第 1 / 2 頁');

      setup.state.goToPage(2);
      expect(setup.state.currentPage.value).toBe(2);
      expect(setup.state.pageRows.value).toHaveLength(1);

      setup.state.goToPage(99);
      expect(setup.state.currentPage.value).toBe(2);

      setup.state.goToPage(0);
      expect(setup.state.currentPage.value).toBe(1);
    } finally {
      setup.stop();
    }
  });

  it('normalizes invalid sort values before listing videos', async function () {
    var api = {
      listVideos: vi.fn().mockResolvedValue([])
    };
    var setup = createState(api);

    try {
      setup.state.sort.value = 'unknown';
      await settleWatchers();

      var lastCall = api.listVideos.mock.calls[api.listVideos.mock.calls.length - 1][0];
      expect(setup.state.sort.value).toBe('site_order');
      expect(lastCall.sort).toBe('site_order');
    } finally {
      setup.stop();
    }
  });

  it('switches collections, resets the current page, and refreshes with the selected key', async function () {
    var api = {
      listVideos: vi.fn().mockResolvedValue(makeRows(PAGE_SIZE + 1))
    };
    var setup = createState(api);

    try {
      await setup.state.refreshVideos();
      setup.state.goToPage(2);

      await setup.state.selectCollection('watch_later');

      expect(setup.state.activeCollection.value).toBe('watch_later');
      expect(setup.state.currentPage.value).toBe(1);
      expect(api.listVideos).toHaveBeenLastCalledWith({
        collectionKey: 'watch_later',
        search: '',
        sort: 'site_order',
        direction: 'asc'
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
        sort: 'site_order',
        direction: 'desc'
      });
      expect(setup.state.currentPage.value).toBe(1);
    } finally {
      setup.stop();
    }
  });
});
