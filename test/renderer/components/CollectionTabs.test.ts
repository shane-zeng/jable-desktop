import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import CollectionTabs from '@/components/CollectionTabs.vue';
import { setLocale } from '@/i18n';

describe('CollectionTabs', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  it('marks the active local collection visibly and semantically', async function () {
    const wrapper = mount(CollectionTabs, {
      props: {
        activeCollection: 'watch_later',
        activeTab: 'watch_later',
        pendingCount: 0
      }
    });

    const tabs = wrapper.findAll('[role="tab"]');

    expect(tabs[0].text()).toBe('影片收藏');
    expect(tabs[0].attributes('aria-selected')).toBe('false');
    expect(tabs[0].classes()).not.toContain('is-active');
    expect(tabs[1].text()).toBe('稍後觀看');
    expect(tabs[1].attributes('aria-selected')).toBe('true');
    expect(tabs[1].classes()).toContain('is-active');

    await tabs[0].trigger('click');

    expect(wrapper.emitted('select')).toEqual([['favourites']]);
  });

  it('renders English collection names', function () {
    setLocale('en-US', false);
    const wrapper = mount(CollectionTabs, {
      props: {
        activeCollection: 'watch_later',
        activeTab: 'watch_later',
        pendingCount: 0
      }
    });

    const tabs = wrapper.findAll('[role="tab"]');

    expect(tabs[0].text()).toBe('Favourites');
    expect(tabs[1].text()).toBe('Watch Later');
  });

  it('shows the pending remote tab with a count badge', async function () {
    const wrapper = mount(CollectionTabs, {
      props: {
        activeCollection: 'favourites',
        activeTab: 'pending_remote',
        pendingCount: 3
      }
    });

    const tabs = wrapper.findAll('[role="tab"]');

    expect(tabs[2].text()).toContain('待同步');
    expect(tabs[2].text()).toContain('3');
    expect(tabs[2].attributes('aria-selected')).toBe('true');
    expect(tabs[2].classes()).toEqual(expect.arrayContaining(['segmented-tab', 'is-active']));
    expect(tabs[2].find('.pending-count-badge').exists()).toBe(true);
    expect(tabs[2].find('.pending-count-badge').text()).toBe('3');

    await tabs[2].trigger('click');

    expect(wrapper.emitted('select')).toEqual([['pending_remote']]);
  });
});
