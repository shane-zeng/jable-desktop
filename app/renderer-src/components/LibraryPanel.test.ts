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
    expect(wrapper.text()).toContain('Import JSON');
    expect(wrapper.text()).toContain('No local data yet');
    expect(wrapper.find('input[type="search"]').attributes('placeholder')).toBe('Search title or URL');
    expect(wrapper.find('[aria-label="Search Mode"]').text()).toContain('Any Word');
    expect(wrapper.find('[aria-label="Sort"]').text()).toContain('Site Order');
    expect(wrapper.find('[aria-label="Sort Direction"]').text()).toContain('Ascending');
  });
});
