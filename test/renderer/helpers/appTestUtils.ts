import { flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { vi } from 'vitest';
import { nextTick } from 'vue';
import { DEFAULT_APP_SETTINGS } from '@/constants';
import type { AppSettings, BrowserTabsState, DownloadRecord, JableAppApi } from '../../../app/types/jable';

export function createAppTestApi(
  downloads: DownloadRecord[] = [],
  settingsOverrides?: Partial<AppSettings>
): JableAppApi {
  const settings: AppSettings = Object.assign(
    {},
    DEFAULT_APP_SETTINGS,
    {
      downloadStateFilters: DEFAULT_APP_SETTINGS.downloadStateFilters.slice()
    },
    settingsOverrides || {}
  );
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

export async function settle() {
  await nextTick();
  await flushPromises();
  await nextTick();
}

export async function clickButtonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find(function (candidate) {
    return candidate.text().trim() === text;
  });

  if (!button) {
    throw new Error('Unable to find button with text: ' + text);
  }

  await button.trigger('click');
  await settle();
}
