import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import TopBar from '@/components/TopBar.vue';
import { setLocale } from '@/i18n';

describe('TopBar', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

  it('marks the active main view visibly and semantically', async function () {
    const wrapper = mount(TopBar, {
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

    const tabs = wrapper.findAll('[role="tab"]');

    expect(tabs[0].attributes('aria-selected')).toBe('false');
    expect(tabs[0].classes()).not.toContain('is-active');
    expect(tabs[1].attributes('aria-selected')).toBe('true');
    expect(tabs[1].classes()).toContain('is-active');
    expect(wrapper.get('[data-test="settings-view-button"]').text()).toContain('設定');

    await tabs[0].trigger('click');

    expect(wrapper.emitted('set-view')).toEqual([['browser']]);

    await wrapper.get('[data-test="settings-view-button"]').trigger('click');

    expect(wrapper.emitted('set-view')).toEqual([['browser'], ['settings']]);
  });

  it('renders English labels after switching locale', async function () {
    setLocale('en-US', false);
    const wrapper = mount(TopBar, {
      props: {
        activeView: 'browser',
        busy: false,
        navigation: {
          tabId: null,
          canGoBack: true,
          canGoForward: false,
          locked: false
        }
      }
    });

    expect(wrapper.text()).toContain('Browser');
    expect(wrapper.text()).toContain('Local Data');
    expect(wrapper.text()).toContain('Settings');
    expect(wrapper.find('[aria-label="Back"]').exists()).toBe(true);
  });

  it('renders Japanese labels after switching locale', function () {
    setLocale('ja-JP', false);
    const wrapper = mount(TopBar, {
      props: {
        activeView: 'browser',
        busy: false,
        navigation: {
          tabId: null,
          canGoBack: true,
          canGoForward: false,
          locked: false
        }
      }
    });

    expect(wrapper.text()).toContain('ブラウザー');
    expect(wrapper.text()).toContain('ローカルデータ');
    expect(wrapper.text()).toContain('設定');
    expect(wrapper.find('[aria-label="戻る"]').exists()).toBe(true);
  });

  it('renders status content in the center chrome without replacing view tabs', function () {
    const wrapper = mount(TopBar, {
      props: {
        activeView: 'browser',
        busy: false,
        navigation: {
          tabId: null,
          canGoBack: true,
          canGoForward: false,
          locked: false
        }
      },
      slots: {
        status: '<div data-test="toast-status">同步完成</div>'
      }
    });

    expect(wrapper.get('[data-test="topbar-center"]').text()).toContain('同步完成');
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="settings-view-button"]').exists()).toBe(true);
  });
});
