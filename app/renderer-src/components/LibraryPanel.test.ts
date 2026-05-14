import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import LibraryPanel from './LibraryPanel.vue';

describe('LibraryPanel', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  it('renders English controls, placeholders, empty state, and option labels', function () {
    setLocale('en-US', false);
    var wrapper = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        busy: false,
        fullSyncLabel: 'Full Sync',
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
    expect(wrapper.text()).toContain('Import JSON');
    expect(wrapper.text()).toContain('No local data yet');
    expect(wrapper.find('input[type="search"]').attributes('placeholder')).toBe('Search title or URL');
    expect(wrapper.find('[aria-label="Search Mode"]').text()).toContain('Any Word');
    expect(wrapper.find('[aria-label="Sort"]').text()).toContain('Site Order');
    expect(wrapper.find('[aria-label="Sort Direction"]').text()).toContain('Ascending');
  });

  it('renders Japanese controls, placeholders, empty state, and option labels', function () {
    setLocale('ja-JP', false);
    var wrapper = mount(LibraryPanel, {
      props: {
        active: true,
        activeCollection: 'favourites',
        busy: false,
        fullSyncLabel: 'フル同期',
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
    expect(wrapper.text()).toContain('Import JSON');
    expect(wrapper.text()).toContain('ローカルデータはまだありません');
    expect(wrapper.text()).toContain('ページ 1 / 1');
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
});
