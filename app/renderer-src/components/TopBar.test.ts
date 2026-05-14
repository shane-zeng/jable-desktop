import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import TopBar from './TopBar.vue';

describe('TopBar', function () {
  beforeEach(function () {
    setLocale('zh-TW', false);
  });

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

  it('renders English labels after switching locale', async function () {
    setLocale('en-US', false);
    var wrapper = mount(TopBar, {
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
    expect(wrapper.find('[aria-label="Back"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Interface Language"]').exists()).toBe(true);
  });

  it('renders Japanese labels and locale option after switching locale', function () {
    setLocale('ja-JP', false);
    var wrapper = mount(TopBar, {
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
    expect(wrapper.text()).toContain('日本語');
    expect(wrapper.find('[aria-label="戻る"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="表示言語"]').exists()).toBe(true);
  });
});
