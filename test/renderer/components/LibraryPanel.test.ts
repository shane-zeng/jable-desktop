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
        fullSyncLabel: 'Full Sync',
        pendingCount: 0,
        pendingGroups: [],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '0 items · 24 per page',
        pageLabel: 'Page 1 / 1',
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
        fullSyncLabel: 'フル同期',
        pendingCount: 0,
        pendingGroups: [],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '0 件 · 1ページ 24 件',
        pageLabel: 'ページ 1 / 1',
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
        fullSyncLabel: '完整同步',
        pendingCount: 0,
        pendingGroups: [],
        search: '',
        searchMode: 'any',
        sort: 'site_order',
        direction: 'asc',
        countLabel: '96 筆 · 每頁 24 筆',
        pageLabel: '第 1 / 4 頁',
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

  it('renders pending remote groups without collection controls', async function () {
    const wrapper = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        activeTab: 'pending_remote',
        busy: false,
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
});
