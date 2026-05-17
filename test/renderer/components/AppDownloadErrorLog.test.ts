import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import App from '@/App.vue';
import { DEFAULT_APP_SETTINGS } from '@/constants';
import type { AppSettings, BrowserTabsState, DownloadRecord, JableAppApi } from '../../../app/types/jable';

function makeDownloadRecord(index: number): DownloadRecord {
  const timestamp = new Date(Date.UTC(2026, 4, 17, 0, 0, index)).toISOString();

  return {
    videoUrl: 'https://jable.tv/videos/failed-' + index + '/',
    collectionKeys: [],
    title: 'Failed Video ' + (index + 1),
    img: null,
    preview: null,
    sourcePageChineseSubtitleNotice: false,
    sourcePageSubtitleNoticeText: null,
    localPath: null,
    state: 'failed',
    progress: null,
    fileSizeBytes: null,
    error: 'Segment request rejected',
    failurePhase: 'segments',
    failureCode: 'segment_http_403',
    attemptCount: index + 1,
    lastStartedAt: timestamp,
    lastErrorAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null
  };
}

function createApi(downloads: DownloadRecord[]): JableAppApi {
  const settings: AppSettings = Object.assign({}, DEFAULT_APP_SETTINGS, {
    downloadStateFilters: DEFAULT_APP_SETTINGS.downloadStateFilters.slice()
  });
  const tabs: BrowserTabsState = {
    activeTabId: 'tab-1',
    maxTabs: 14,
    tabs: [
      {
        id: 'tab-1',
        kind: 'normal',
        title: 'Jable',
        url: 'https://jable.tv/',
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

  return {
    getAppInfo: vi.fn().mockResolvedValue({
      databasePath: '/tmp/jable.sqlite',
      locale: 'zh-TW',
      systemLocale: 'zh-TW'
    }),
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockImplementation(function (patch: Partial<AppSettings>) {
      Object.assign(settings, patch);
      return Promise.resolve(settings);
    }),
    setLocale: vi.fn().mockResolvedValue({ locale: 'zh-TW' }),
    getFfmpegStatus: vi.fn().mockResolvedValue({
      state: 'detected',
      source: 'path',
      path: '/usr/bin/ffmpeg',
      version: 'ffmpeg version 7',
      error: null
    }),
    refreshFfmpegStatus: vi.fn(),
    chooseFfmpegPath: vi.fn(),
    setFfmpegPath: vi.fn(),
    clearFfmpegPath: vi.fn(),
    getDownloadRoot: vi.fn().mockResolvedValue({
      source: 'default',
      path: '/tmp/downloads',
      exists: true
    }),
    chooseDownloadRoot: vi.fn(),
    setDownloadRoot: vi.fn(),
    clearDownloadRoot: vi.fn(),
    openDownloadRoot: vi.fn(),
    listDownloads: vi.fn().mockResolvedValue(downloads),
    enqueueDownload: vi.fn(),
    retryDownload: vi.fn(),
    retryFailedDownloads: vi.fn(),
    pauseDownload: vi.fn(),
    pauseAllDownloads: vi.fn(),
    resumeDownload: vi.fn(),
    resumePausedDownloads: vi.fn(),
    cancelDownload: vi.fn(),
    cancelQueuedDownloads: vi.fn(),
    openDownloadFile: vi.fn(),
    revealDownloadFile: vi.fn(),
    deleteDownload: vi.fn(),
    deleteDownloads: vi.fn(),
    openLocalDataFolder: vi.fn(),
    checkForUpdates: vi.fn(),
    listVideos: vi.fn().mockResolvedValue([]),
    countVideos: vi.fn().mockResolvedValue(0),
    getCollectionUrls: vi.fn(),
    saveSyncPage: vi.fn(),
    finishSync: vi.fn(),
    clearSyncState: vi.fn(),
    importJson: vi.fn(),
    exportJson: vi.fn(),
    exportJsonFile: vi.fn(),
    listPendingRemoteOperationGroups: vi.fn().mockResolvedValue([]),
    addPendingRemoteOperationGroup: vi.fn(),
    removePendingRemoteOperationGroup: vi.fn(),
    resolvePendingRemoteOperationGroup: vi.fn(),
    listBrowserTabs: vi.fn().mockResolvedValue(tabs),
    showBrowserTabMenu: vi.fn(),
    showLibraryVideoMenu: vi.fn(),
    createBrowserTab: vi.fn().mockResolvedValue(tabs),
    activateBrowserTab: vi.fn().mockResolvedValue(tabs),
    closeBrowserTab: vi.fn().mockResolvedValue(tabs),
    setBrowserTabLocked: vi.fn().mockResolvedValue(tabs),
    setBrowserTabMuted: vi.fn().mockResolvedValue(tabs),
    setBrowserBounds: vi.fn().mockResolvedValue(null),
    navigateBrowser: vi.fn(),
    reloadBrowser: vi.fn(),
    goBackBrowser: vi.fn(),
    goForwardBrowser: vi.fn(),
    getBrowserNavigationState: vi.fn(),
    getBrowserUrl: vi.fn().mockResolvedValue('https://jable.tv/'),
    syncBrowserCollection: vi.fn(),
    diagnoseBrowser: vi.fn(),
    onBrowserMessage: vi.fn()
  } as unknown as JableAppApi;
}

async function settle() {
  await nextTick();
  await flushPromises();
  await nextTick();
}

async function openDownloadList(wrapper: ReturnType<typeof mount>) {
  const localDataButton = wrapper.findAll('button').find(function (button) {
    return button.text().trim() === '本機資料';
  });
  expect(localDataButton).toBeTruthy();
  await localDataButton!.trigger('click');
  await settle();

  const downloadListButton = wrapper.findAll('button').find(function (button) {
    return button.text().trim() === '下載清單';
  });
  expect(downloadListButton).toBeTruthy();
  await downloadListButton!.trigger('click');
  await settle();
}

function dispatchKey(
  key: string,
  options?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }
) {
  window.dispatchEvent(
    new KeyboardEvent(
      'keydown',
      Object.assign(
        {
          key: key,
          bubbles: true
        },
        options || {}
      )
    )
  );
}

describe('App Download Error Log diagnostics shortcut', function () {
  afterEach(function () {
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.jableApp;
  });

  it('opens from Ctrl+Shift+E only on Download List and limits the initial records', async function () {
    window.jableApp = createApi(
      Array.from({ length: 105 }, function (_, index) {
        return makeDownloadRecord(index);
      })
    );

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

    dispatchKey('E', { ctrlKey: true, shiftKey: true });
    await settle();
    expect(wrapper.find('[data-test="download-error-log-modal"]').exists()).toBe(false);

    await openDownloadList(wrapper);
    expect(wrapper.find('[data-test="download-error-log"]').exists()).toBe(false);

    dispatchKey('E', { ctrlKey: true, shiftKey: true });
    await settle();

    expect(wrapper.find('[data-test="download-error-log-modal"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="download-error-log-summary"]').text()).toContain('100');
    expect(wrapper.find('[data-test="download-error-log-summary"]').text()).toContain('105');
    expect(wrapper.findAll('[data-test="download-error-log-row"]')).toHaveLength(100);
    expect(wrapper.findAll('[data-test="download-error-log-row"]')[0].text()).toContain('Failed Video 105');

    await wrapper.get('[data-test="download-error-log-show-all"]').trigger('click');
    await settle();

    expect(wrapper.findAll('[data-test="download-error-log-row"]')).toHaveLength(105);

    dispatchKey('Escape');
    await settle();
    expect(wrapper.find('[data-test="download-error-log-modal"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it('opens from the D L E key sequence', async function () {
    window.jableApp = createApi([makeDownloadRecord(0)]);

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
    await openDownloadList(wrapper);

    dispatchKey('d');
    dispatchKey('l');
    dispatchKey('e');
    await settle();

    expect(wrapper.find('[data-test="download-error-log-modal"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="download-error-log-row"]')).toHaveLength(1);

    wrapper.unmount();
  });
});
