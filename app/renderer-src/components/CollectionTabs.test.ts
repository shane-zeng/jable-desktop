import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CollectionTabs from './CollectionTabs.vue';

describe('CollectionTabs', function () {
  it('marks the active local collection visibly and semantically', async function () {
    var wrapper = mount(CollectionTabs, {
      props: {
        activeCollection: 'watch_later'
      }
    });

    var tabs = wrapper.findAll('[role="tab"]');

    expect(tabs[0].text()).toBe('影片收藏');
    expect(tabs[0].attributes('aria-selected')).toBe('false');
    expect(tabs[0].classes()).not.toContain('is-active');
    expect(tabs[1].text()).toBe('稍後觀看');
    expect(tabs[1].attributes('aria-selected')).toBe('true');
    expect(tabs[1].classes()).toContain('is-active');

    await tabs[0].trigger('click');

    expect(wrapper.emitted('select')).toEqual([['favourites']]);
  });
});
