import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import TopBar from './TopBar.vue';

describe('TopBar', function () {
  it('marks the active main view visibly and semantically', async function () {
    var wrapper = mount(TopBar, {
      props: {
        activeView: 'library',
        busy: false,
        navigation: {
          tabId: null,
          canGoBack: false,
          canGoForward: false,
          locked: false
        }
      }
    });

    var tabs = wrapper.findAll('[role="tab"]');

    expect(tabs[0].attributes('aria-selected')).toBe('false');
    expect(tabs[0].classes()).not.toContain('is-active');
    expect(tabs[1].attributes('aria-selected')).toBe('true');
    expect(tabs[1].classes()).toContain('is-active');

    await tabs[0].trigger('click');

    expect(wrapper.emitted('set-view')).toEqual([['browser']]);
  });
});
