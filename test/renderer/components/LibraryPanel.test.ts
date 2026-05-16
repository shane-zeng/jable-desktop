import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import LibraryPanel from '@/components/LibraryPanel.vue';
import { setLocale } from '@/i18n';

describe('LibraryPanel', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  it('renders English controls, placeholders, empty state, and option labels', function () {
    setLocale('en-US', false);
    const wrapper = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        activeTab: 'favourites',
        busy: false,
        ffmpegReady: true,
        fullSyncLabel: 'Full Sync',
        pendingCount: 0,
        pendingGroups: [],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '0 items · 24 per page',
        pageLabel: 'Page 1 / 1',
        downloads: [],
        rows: [],
        currentPage: 1,
        totalPages: 1
      }
    });

    expect(wrapper.text()).toContain('Quick Sync');
    expect(wrapper.text()).toContain('Full Sync');
    expect(wrapper.text()).not.toContain('Import JSON');
    expect(wrapper.text()).toContain('No local data yet');
    expect(wrapper.find('input[type="search"]').attributes('placeholder')).toBe('Search title or URL');
    expect(wrapper.find('[aria-label="Search Mode"]').text()).toContain('Any Word');
    expect(wrapper.find('[aria-label="Sort"]').text()).toContain('Site Order');
    expect(wrapper.find('[aria-label="Sort Direction"]').text()).toContain('Ascending');
  });

  it('renders Japanese controls, placeholders, empty state, and option labels', function () {
    setLocale('ja-JP', false);
    const wrapper = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        activeTab: 'favourites',
        busy: false,
        ffmpegReady: true,
        fullSyncLabel: 'フル同期',
        pendingCount: 0,
        pendingGroups: [],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '0 件 · 1ページ 24 件',
        pageLabel: 'ページ 1 / 1',
        downloads: [],
        rows: [],
        currentPage: 1,
        totalPages: 1
      }
    });

    expect(wrapper.text()).toContain('お気に入り');
    expect(wrapper.text()).toContain('クイック同期');
    expect(wrapper.text()).toContain('フル同期');
    expect(wrapper.text()).not.toContain('Import JSON');
    expect(wrapper.text()).toContain('ローカルデータはまだありません');
    expect(wrapper.text()).toContain('ページ');
    expect(wrapper.text()).toContain('/ 1');
    expect((wrapper.get('[data-test="pagination-page-input"]').element as HTMLInputElement).value).toBe('1');
    expect(wrapper.find('[data-test="library-filters"]').classes()).toContain(
      'grid-cols-[minmax(132px,max-content)_minmax(220px,1fr)_160px_120px]'
    );
    expect(wrapper.find('[aria-label="検索モード"]').classes()).toEqual(
      expect.arrayContaining(['w-auto', 'min-w-[132px]', 'max-w-[220px]'])
    );
    expect(wrapper.find('input[type="search"]').attributes('placeholder')).toBe('タイトルまたは URL を検索');
    expect(wrapper.find('[aria-label="検索モード"]').text()).toContain('いずれかの語');
    expect(wrapper.find('[aria-label="並び替え"]').text()).toContain('サイト順');
    expect(wrapper.find('[aria-label="並び順"]').text()).toContain('昇順');
  });

  it('relays a selected page from the editable page label', async function () {
    const wrapper = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        activeTab: 'favourites',
        busy: false,
        ffmpegReady: true,
        fullSyncLabel: '完整同步',
        pendingCount: 0,
        pendingGroups: [],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '96 筆 · 每頁 24 筆',
        pageLabel: '第 1 / 4 頁',
        downloads: [],
        rows: [],
        currentPage: 1,
        totalPages: 4
      }
    });

    expect(wrapper.text()).toContain('第');
    expect(wrapper.text()).toContain('/ 4 頁');
    expect((wrapper.get('[data-test="pagination-page-input"]').element as HTMLInputElement).value).toBe('1');

    await wrapper.get('[data-test="pagination-page-input"]').setValue('3');
    await wrapper.get('[data-test="pagination-action"]').trigger('click');

    expect(wrapper.emitted('go-page')).toEqual([[3]]);

    await wrapper.get('[data-test="pagination-page-input"]').setValue('99');
    await wrapper.get('[data-test="pagination-action"]').trigger('click');

    expect(wrapper.emitted('go-page')).toEqual([[3], [4]]);
  });

  it('relays video download actions from collection cards', async function () {
    const video = {
      title: 'Downloadable Video',
      url: 'https://jable.tv/videos/downloadable/',
      views: 1,
      likes: 2,
      img: null,
      preview: null
    };
    const wrapper = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        activeTab: 'favourites',
        busy: false,
        ffmpegReady: true,
        fullSyncLabel: '完整同步',
        pendingCount: 0,
        pendingGroups: [],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '1 筆 · 每頁 24 筆',
        pageLabel: '第 1 / 1 頁',
        downloads: [],
        rows: [video],
        currentPage: 1,
        totalPages: 1
      }
    });

    await wrapper.get('[data-test="video-download"]').trigger('click');

    expect(wrapper.emitted('download-video')).toEqual([[video]]);
  });

  it('renders pending remote groups without collection controls', async function () {
    const wrapper = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        activeTab: 'pending_remote',
        busy: false,
        ffmpegReady: true,
        fullSyncLabel: '完整同步',
        pendingCount: 1,
        pendingGroups: [
          {
            groupId: 'favourites\thttps://jable.tv/videos/pending/',
            collectionKey: 'favourites',
            videoUrl: 'https://jable.tv/videos/pending/',
            title: 'Pending Video',
            views: 1234,
            likes: 56,
            img: null,
            preview: null,
            state: 'failed',
            error: 'HTTP 500',
            operationCount: 2,
            sequence: [
              { id: 1, action: 'remove', state: 'failed', error: 'HTTP 500' },
              { id: 2, action: 'add', state: 'blocked', error: 'Blocked by earlier failed operation' }
            ]
          }
        ],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '1 筆待同步',
        pageLabel: '第 1 / 1 頁',
        downloads: [],
        rows: [],
        currentPage: 1,
        totalPages: 1
      }
    });

    expect(wrapper.text()).toContain('Pending Video');
    expect(wrapper.text()).toContain('HTTP 500');
    expect(wrapper.get('[data-test="library-grid"]').classes()).toContain('[grid-template-columns:minmax(0,1fr)]');
    expect(wrapper.get('[data-test="library-grid"]').classes()).not.toContain(
      '[grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]'
    );
    expect(wrapper.find('[data-test="library-filters"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('快速同步');
    expect(wrapper.get('[data-test="pending-remote-card"]').classes()).toContain(
      'grid-cols-[132px_minmax(0,1fr)_max-content]'
    );
    expect(wrapper.get('[data-test="pending-remote-card"] > div:last-child').classes()).toContain('flex-col');
    const summary = wrapper.get('[data-test="pending-remote-summary"]');
    const metadata = wrapper.get('[data-test="pending-remote-metadata"]');
    expect(metadata.text()).toContain(Number(1234).toLocaleString('zh-TW'));
    expect(metadata.text()).toContain('views');
    expect(metadata.text()).toContain(Number(56).toLocaleString('zh-TW'));
    expect(metadata.text()).toContain('likes');
    expect(summary.text()).toContain('清單');
    expect(summary.text()).toContain('影片收藏');
    expect(summary.text()).toContain('同步狀態');
    expect(summary.text()).toContain('送出失敗');
    expect(summary.find('.pending-chip-failed').exists()).toBe(true);
    expect(wrapper.get('[data-test="pending-remote-sequence"]').text()).toContain('操作序列');
    expect(wrapper.get('[data-test="pending-remote-sequence"]').find('.max-h-16').exists()).toBe(true);
    const sequenceSteps = wrapper.findAll('[data-test="pending-remote-sequence"] .pending-sequence-step');
    expect(sequenceSteps[0].text()).toBe('移除');
    expect(sequenceSteps[0].classes()).toContain('pending-chip-remove');
    expect(sequenceSteps[0].attributes('aria-label')).toBe('移除送出失敗');
    expect(sequenceSteps[1].text()).toBe('加入');
    expect(wrapper.find('[data-test="pending-remote-card"] button').classes()).toContain('success');

    const buttons = wrapper.findAll('[data-test="pending-remote-card"] button');
    expect(buttons).toHaveLength(3);
    expect(buttons[1].classes()).toContain('danger');
    await buttons[0].trigger('click');
    await buttons[1].trigger('click');
    await buttons[2].trigger('click');

    expect(wrapper.emitted('add-pending-group')).toEqual([['favourites\thttps://jable.tv/videos/pending/']]);
    expect(wrapper.emitted('remove-pending-group')).toEqual([['favourites\thttps://jable.tv/videos/pending/']]);
    expect(wrapper.emitted('resolve-pending-group')).toEqual([['favourites\thttps://jable.tv/videos/pending/']]);
  });

  it('renders download list setup and empty states without collection controls', function () {
    const setupRequired = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        activeTab: 'downloads',
        busy: false,
        ffmpegReady: false,
        fullSyncLabel: '完整同步',
        pendingCount: 0,
        pendingGroups: [],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '0 筆下載',
        pageLabel: '第 1 / 1 頁',
        downloads: [],
        rows: [],
        currentPage: 1,
        totalPages: 1
      }
    });

    expect(setupRequired.text()).toContain('下載清單');
    expect(setupRequired.get('[data-test="download-list-setup-required"]').text()).toBe('需要安裝 FFmpeg');
    expect(setupRequired.find('[data-test="library-filters"]').exists()).toBe(false);
    expect(setupRequired.text()).not.toContain('快速同步');
    expect(setupRequired.find('[data-test="pagination-page-input"]').exists()).toBe(false);

    const empty = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        activeTab: 'downloads',
        busy: false,
        ffmpegReady: true,
        fullSyncLabel: '完整同步',
        pendingCount: 0,
        pendingGroups: [],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '0 筆下載',
        pageLabel: '第 1 / 1 頁',
        downloads: [],
        rows: [],
        currentPage: 1,
        totalPages: 1
      }
    });

    expect(empty.get('[data-test="download-list-empty"]').text()).toBe('目前沒有下載項目');
  });

  it('renders download records and emits ready file open actions', async function () {
    const wrapper = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        activeTab: 'downloads',
        busy: false,
        ffmpegReady: true,
        fullSyncLabel: '完整同步',
        pendingCount: 0,
        pendingGroups: [],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '2 筆下載',
        pageLabel: '第 1 / 1 頁',
        downloads: [
          {
            videoUrl: 'https://jable.tv/videos/ready/',
            collectionKey: 'favourites',
            title: 'Ready Video',
            img: null,
            localPath: '/tmp/ready.mp4',
            state: 'ready',
            progress: null,
            fileSizeBytes: 1024,
            error: null,
            createdAt: '2026-05-16T00:00:00.000Z',
            updatedAt: '2026-05-16T00:00:00.000Z',
            completedAt: '2026-05-16T00:00:00.000Z'
          },
          {
            videoUrl: 'https://jable.tv/videos/missing/',
            collectionKey: 'watch_later',
            title: 'Missing Video',
            img: null,
            localPath: '/tmp/missing.mp4',
            state: 'missing',
            progress: null,
            fileSizeBytes: null,
            error: null,
            createdAt: '2026-05-16T00:00:00.000Z',
            updatedAt: '2026-05-16T00:00:00.000Z',
            completedAt: null
          }
        ],
        rows: [],
        currentPage: 1,
        totalPages: 1
      }
    });

    const cards = wrapper.findAll('[data-test="download-record-card"]');
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain('Ready Video');
    expect(cards[0].text()).toContain('已下載');
    expect(cards[1].text()).toContain('Missing Video');
    expect(cards[1].text()).toContain('檔案遺失');

    await cards[0].get('button').trigger('click');
    await cards[1].get('button').trigger('click');

    expect(wrapper.emitted('open-download')).toEqual([['https://jable.tv/videos/ready/']]);
  });
});
