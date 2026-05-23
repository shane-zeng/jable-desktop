import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App.vue';
import DownloadProgressSidebar from '@/components/DownloadProgressSidebar.vue';
import LibraryPanel from '@/components/LibraryPanel.vue';
import { DEFAULT_BROWSER_URL } from '@/constants';
import { clickButtonByText, createAppTestApi, settle } from '../helpers/appTestUtils';
import type { BrowserTabsState, DownloadRecord } from '../../../app/types/jable';

function makeDownloadRecord(patch: Partial<DownloadRecord>): DownloadRecord {
  return Object.assign(
    {
      videoUrl: 'https://jable.tv/videos/sidebar-app/',
      collectionKeys: [],
      title: 'Sidebar App Download',
      img: null,
      preview: null,
      sourcePageChineseSubtitleNotice: false,
      sourcePageSubtitleNoticeText: null,
      downloadSource: 'normal',
      localPath: null,
      state: 'downloading',
      progress: null,
      playbackAutoResumeBlocked: false,
      fileSizeBytes: null,
      downloadedBytes: 1024,
      downloadSpeedBytesPerSecond: 512,
      error: null,
      failurePhase: null,
      failureCode: null,
      attemptCount: 0,
      lastStartedAt: '2026-05-23T09:30:00.000Z',
      lastErrorAt: null,
      createdAt: '2026-05-23T09:00:00.000Z',
      updatedAt: '2026-05-23T09:30:00.000Z',
      completedAt: null
    },
    patch
  );
}

function makeBrowserTabsState(url: string): BrowserTabsState {
  return {
    activeTabId: 'tab-1',
    maxTabs: 14,
    tabs: [
      {
        id: 'tab-1',
        kind: 'normal',
        title: 'Jable',
        url: url,
        favicon: '',
        loading: false,
        locked: false,
        muted: false,
        audible: false,
        mediaPlaying: false,
        pictureInPicture: false,
        discarded: false,
        canGoBack: false,
        canGoForward: false
      }
    ]
  };
}

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

  it('toggles the Browser download sidebar shortcut only in Browser view', async function () {
    const api = createAppTestApi([], {
      downloadSidebarEnabled: true
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

    expect(wrapper.find('[aria-label="展開下載進度側邊欄"]').exists()).toBe(true);

    const browserMessageCallback = vi.mocked(api.onBrowserMessage).mock.calls[0][0];
    browserMessageCallback({ channel: 'browser-download-sidebar-toggle-shortcut', args: [{}] });
    await settle();

    expect(localStorage.getItem('jable-desktop:download-sidebar-collapsed')).toBe('false');
    expect(wrapper.find('[data-test="download-sidebar-resize"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="收合下載進度側邊欄"]').exists()).toBe(false);

    await clickButtonByText(wrapper, '本機資料');
    browserMessageCallback({ channel: 'browser-download-sidebar-toggle-shortcut', args: [{}] });
    await settle();

    expect(localStorage.getItem('jable-desktop:download-sidebar-collapsed')).toBe('false');

    wrapper.unmount();
  });

  it('keeps the Browser right edge clean when the download sidebar feature is disabled', async function () {
    const api = createAppTestApi();
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

    expect(wrapper.find('[data-test="download-sidebar-host"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="展開下載進度側邊欄"]').exists()).toBe(false);

    const browserMessageCallback = vi.mocked(api.onBrowserMessage).mock.calls[0][0];
    browserMessageCallback({ channel: 'browser-download-sidebar-toggle-shortcut', args: [{}] });
    await settle();

    expect(localStorage.getItem('jable-desktop:download-sidebar-collapsed')).toBe(null);

    wrapper.unmount();
  });

  it('persists Browser download sidebar resize and collapses below the drag threshold', async function () {
    const api = createAppTestApi([], {
      downloadSidebarEnabled: true
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

    const browserMessageCallback = vi.mocked(api.onBrowserMessage).mock.calls[0][0];
    browserMessageCallback({ channel: 'browser-download-sidebar-toggle-shortcut', args: [{}] });
    await settle();

    const handle = wrapper.get('[data-test="download-sidebar-resize"]');
    await handle.trigger('pointerdown', { clientX: 400 });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 360 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 360 }));
    await settle();

    expect(localStorage.getItem('jable-desktop:download-sidebar-width')).toBe('360');
    expect(wrapper.find('[data-test="download-sidebar-resize"]').exists()).toBe(true);
    expect(localStorage.getItem('jable-desktop:download-sidebar-collapsed')).toBe('false');

    await wrapper.get('[data-test="download-sidebar-resize"]').trigger('pointerdown', { clientX: 400 });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 620 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 620 }));
    await settle();

    expect(localStorage.getItem('jable-desktop:download-sidebar-collapsed')).toBe('true');
    expect(wrapper.find('[aria-label="展開下載進度側邊欄"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it('pins the current playback auto download in the Browser sidebar and cancels it in place', async function () {
    const currentVideoUrl = 'https://jable.tv/videos/current-playback/';
    const api = createAppTestApi(
      [
        makeDownloadRecord({
          title: 'Other Download',
          videoUrl: 'https://jable.tv/videos/other-download/',
          state: 'downloading',
          downloadSource: 'normal',
          lastStartedAt: '2026-05-23T09:58:00.000Z'
        }),
        makeDownloadRecord({
          title: 'Current Playback',
          videoUrl: currentVideoUrl,
          state: 'downloading',
          downloadSource: 'playback_auto',
          lastStartedAt: '2026-05-23T09:30:00.000Z'
        })
      ],
      {
        downloadSidebarEnabled: true
      }
    );
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

    const browserMessageCallback = vi.mocked(api.onBrowserMessage).mock.calls[0][0];
    browserMessageCallback({ channel: 'browser-tabs-changed', args: [makeBrowserTabsState(currentVideoUrl)] });
    browserMessageCallback({ channel: 'browser-download-sidebar-toggle-shortcut', args: [{}] });
    await settle();

    const records = wrapper.findAll('[data-test="download-sidebar-record"]');
    expect(records[0].text()).toContain('目前影片');
    expect(records[0].text()).toContain('Current Playback');
    expect(records[0].find('[data-test="download-sidebar-current-cancel"]').text()).toBe('取消');

    await records[0].get('[data-test="download-sidebar-current-cancel"]').trigger('click');
    await settle();

    expect(api.cancelDownload).toHaveBeenCalledWith(currentVideoUrl);

    wrapper.unmount();
  });

  it('reports a sanitized diagnostic when the Browser sidebar quick cancel guard blocks the action', async function () {
    const currentVideoUrl = 'https://jable.tv/videos/current-formal/';
    const api = createAppTestApi(
      [
        makeDownloadRecord({
          title: 'Current Formal',
          videoUrl: currentVideoUrl,
          state: 'downloading',
          downloadSource: 'normal'
        })
      ],
      {
        downloadSidebarEnabled: true
      }
    );
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

    const browserMessageCallback = vi.mocked(api.onBrowserMessage).mock.calls[0][0];
    browserMessageCallback({ channel: 'browser-tabs-changed', args: [makeBrowserTabsState(currentVideoUrl)] });
    browserMessageCallback({ channel: 'browser-download-sidebar-toggle-shortcut', args: [{}] });
    await settle();

    wrapper.findComponent(DownloadProgressSidebar).vm.$emit('cancel-current-playback-download', currentVideoUrl);
    await settle();

    expect(api.cancelDownload).not.toHaveBeenCalled();
    expect(api.reportRendererError).toHaveBeenCalledWith({
      level: 'warn',
      event: 'download-sidebar-current-cancel-skipped',
      message: 'Download sidebar current playback cancel was ignored.',
      details: {
        reason: 'not-playback-auto',
        hasActiveVideoUrl: true,
        state: 'downloading',
        downloadSource: 'normal'
      }
    });

    wrapper.unmount();
  });

  it('applies pushed download records without re-listing downloads', async function () {
    const api = createAppTestApi([], {
      downloadSidebarEnabled: true
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

    const initialListCalls = vi.mocked(api.listDownloads).mock.calls.length;
    const browserMessageCallback = vi.mocked(api.onBrowserMessage).mock.calls[0][0];
    browserMessageCallback({
      channel: 'downloads-changed',
      args: [[makeDownloadRecord({ title: 'Pushed Download' })]]
    });
    browserMessageCallback({ channel: 'browser-download-sidebar-toggle-shortcut', args: [{}] });
    await settle();

    expect(api.listDownloads).toHaveBeenCalledTimes(initialListCalls);
    expect(wrapper.text()).toContain('Pushed Download');

    wrapper.unmount();
  });
});
