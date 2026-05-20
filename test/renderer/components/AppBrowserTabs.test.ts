import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App.vue';
import LibraryPanel from '@/components/LibraryPanel.vue';
import { DEFAULT_BROWSER_URL } from '@/constants';
import { clickButtonByText, createAppTestApi, settle } from '../helpers/appTestUtils';

describe('App browser tab behavior', function () {
  afterEach(function () {
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.jableApp;
  });

  it('keeps Local Data active when creating a tab from the shared rail', async function () {
    const api = createAppTestApi([], {
      browserTabsMode: 'shared',
      compactBrowserTabs: false
    });
    window.jableApp = api;

    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        stubs: {
          SettingsPanel: true
        }
      }
    });
    await settle();
    await clickButtonByText(wrapper, '本機資料');

    await wrapper.get('[aria-label="新增分頁"]').trigger('click');
    await settle();

    expect(api.createBrowserTab).toHaveBeenCalledWith({
      url: DEFAULT_BROWSER_URL,
      active: false
    });
    expect(wrapper.find('[aria-label="本機資料庫"]').isVisible()).toBe(true);

    wrapper.unmount();
  });

  it('opens Local Data card new-tab actions in the background', async function () {
    const api = createAppTestApi();
    window.jableApp = api;

    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        stubs: {
          BrowserPanel: true,
          SettingsPanel: true
        }
      }
    });
    await settle();
    await clickButtonByText(wrapper, '本機資料');

    const videoUrl = 'https://jable.tv/videos/background-open/';
    const libraryPanel = wrapper.findComponent(LibraryPanel);
    expect(libraryPanel.exists()).toBe(true);
    libraryPanel.vm.$emit('open-video-new-tab', videoUrl);
    await settle();

    expect(api.createBrowserTab).toHaveBeenCalledWith({
      url: videoUrl,
      active: false
    });
    expect(wrapper.find('[aria-label="本機資料庫"]').isVisible()).toBe(true);

    wrapper.unmount();
  });

  it('switches Browser, Local Data, and Settings from app view shortcut messages', async function () {
    const api = createAppTestApi();
    window.jableApp = api;

    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        stubs: {
          BrowserPanel: true,
          SettingsPanel: true
        }
      }
    });
    await settle();

    const browserMessageCallback = vi.mocked(api.onBrowserMessage).mock.calls[0][0];
    browserMessageCallback({ channel: 'app-view-shortcut', args: [{ view: 'library' }] });
    await settle();

    expect(wrapper.find('[aria-label="本機資料庫"]').isVisible()).toBe(true);

    browserMessageCallback({ channel: 'app-view-shortcut', args: [{ view: 'settings' }] });
    await settle();

    expect(wrapper.get('[data-test="settings-view-button"]').attributes('aria-pressed')).toBe('true');

    browserMessageCallback({ channel: 'app-view-shortcut', args: [{ view: 'browser' }] });
    await settle();

    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe('瀏覽器');

    wrapper.unmount();
  });

  it('toggles shared tab rail from shortcut messages outside Settings', async function () {
    const api = createAppTestApi([], {
      browserTabsMode: 'standard',
      compactBrowserTabs: false
    });
    window.jableApp = api;

    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        stubs: {
          BrowserPanel: true,
          SettingsPanel: true
        }
      }
    });
    await settle();

    const browserMessageCallback = vi.mocked(api.onBrowserMessage).mock.calls[0][0];
    browserMessageCallback({ channel: 'browser-tabs-shared-toggle-shortcut', args: [{}] });
    await settle();

    expect(api.updateSettings).toHaveBeenLastCalledWith({ browserTabsMode: 'shared' });

    await clickButtonByText(wrapper, '本機資料');
    browserMessageCallback({ channel: 'browser-tabs-shared-toggle-shortcut', args: [{}] });
    await settle();

    expect(api.updateSettings).toHaveBeenLastCalledWith({ browserTabsMode: 'standard' });

    wrapper.unmount();
  });
});
