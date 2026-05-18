import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useBrowserBounds } from '@/composables/useBrowserBounds';
import type { AppView, BrowserTabKind, BrowserTabsState, JableAppApi } from '../../../app/types/jable';

function createState(api: Partial<JableAppApi>) {
  const scope = effectScope();
  const state = scope.run(function () {
    return useBrowserBounds(api as JableAppApi, ref<AppView>('browser'));
  });

  if (!state) throw new Error('Failed to create browser state');

  return {
    state: state,
    stop: function () {
      scope.stop();
    }
  };
}

function makeTab(id: string, kind: BrowserTabKind, overrides?: Partial<BrowserTabsState['tabs'][number]>) {
  return Object.assign(
    {
      id: id,
      kind: kind,
      title: kind === 'sync' ? '同步：影片收藏' : 'Jable',
      url: kind === 'sync' ? 'https://jable.tv/my/favourites/videos/' : 'https://jable.tv/',
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
    },
    overrides || {}
  );
}

function makeTabsState(overrides?: Partial<BrowserTabsState>): BrowserTabsState {
  return Object.assign(
    {
      activeTabId: 'tab-1',
      maxTabs: 8,
      tabs: [
        makeTab('tab-1', 'normal', { canGoForward: true }),
        makeTab('tab-2', 'sync', { loading: true, locked: true })
      ]
    },
    overrides || {}
  );
}

describe('useBrowserBounds', function () {
  it('tracks tabs, active navigation state, and tab limits', function () {
    const setup = createState({
      setBrowserBounds: vi.fn()
    });

    try {
      setup.state.applyTabsState(
        makeTabsState({
          maxTabs: 2
        })
      );

      expect(setup.state.tabs.value).toHaveLength(2);
      expect(setup.state.activeTab.value?.id).toBe('tab-1');
      expect(setup.state.navigation.value).toEqual({
        tabId: 'tab-1',
        canGoBack: false,
        canGoForward: true,
        locked: false
      });
      expect(setup.state.canCreateTab.value).toBe(false);
      expect(setup.state.hasTab('tab-2')).toBe(true);
      expect(setup.state.firstUnlockedSyncTab()).toBe(null);
    } finally {
      setup.stop();
    }
  });

  it('updates navigation state for the matching tab only', function () {
    const setup = createState({
      setBrowserBounds: vi.fn()
    });

    try {
      setup.state.applyTabsState(makeTabsState());
      setup.state.setNavigationState({
        tabId: 'tab-2',
        canGoBack: true,
        canGoForward: true,
        locked: false
      });

      expect(setup.state.tabs.value[0].canGoForward).toBe(true);
      expect(setup.state.tabs.value[1].canGoBack).toBe(true);
      expect(setup.state.tabs.value[1].locked).toBe(false);
      expect(setup.state.firstUnlockedSyncTab()?.id).toBe('tab-2');
    } finally {
      setup.stop();
    }
  });

  it('delegates tab operations to the browser API and stores returned state', async function () {
    const api = {
      setBrowserBounds: vi.fn(),
      createBrowserTab: vi.fn().mockResolvedValue(
        makeTabsState({
          activeTabId: 'tab-3',
          tabs: [makeTab('tab-3', 'normal', { title: 'New' })]
        })
      ),
      activateBrowserTab: vi.fn().mockResolvedValue(makeTabsState({ activeTabId: 'tab-2' })),
      closeBrowserTab: vi.fn().mockResolvedValue(
        makeTabsState({
          activeTabId: 'tab-1',
          tabs: [makeTabsState().tabs[0]]
        })
      ),
      setBrowserTabLocked: vi.fn().mockResolvedValue(
        makeTabsState({
          activeTabId: 'tab-2',
          tabs: [makeTabsState().tabs[0], Object.assign({}, makeTabsState().tabs[1], { locked: false })]
        })
      ),
      setBrowserTabMuted: vi.fn().mockResolvedValue(
        makeTabsState({
          activeTabId: 'tab-2',
          tabs: [makeTabsState().tabs[0], Object.assign({}, makeTabsState().tabs[1], { muted: true })]
        })
      )
    };
    const setup = createState(api);

    try {
      await setup.state.createTab('https://jable.tv/videos/sample/', { active: true });
      expect(api.createBrowserTab).toHaveBeenCalledWith({
        active: true,
        url: 'https://jable.tv/videos/sample/'
      });
      expect(setup.state.activeTabId.value).toBe('tab-3');

      await setup.state.activateTab('tab-2');
      expect(api.activateBrowserTab).toHaveBeenCalledWith('tab-2');
      expect(setup.state.activeTabId.value).toBe('tab-2');

      await setup.state.closeTab('tab-2');
      expect(api.closeBrowserTab).toHaveBeenCalledWith('tab-2');
      expect(setup.state.tabs.value).toHaveLength(1);

      await setup.state.setTabLocked('tab-2', false);
      expect(api.setBrowserTabLocked).toHaveBeenCalledWith({
        tabId: 'tab-2',
        locked: false
      });

      await setup.state.setTabMuted('tab-2', true);
      expect(api.setBrowserTabMuted).toHaveBeenCalledWith({
        tabId: 'tab-2',
        muted: true
      });
      expect(setup.state.tabs.value[1].muted).toBe(true);
    } finally {
      setup.stop();
    }
  });

  it('skips navigation when the target video is already open in the tab', async function () {
    const api = {
      setBrowserBounds: vi.fn(),
      getBrowserUrl: vi.fn().mockResolvedValue('https://fs1.app/videos/sample/?autoplay=1#player'),
      navigateBrowser: vi.fn(),
      listBrowserTabs: vi.fn()
    };
    const setup = createState(api);

    try {
      setup.state.applyTabsState(
        makeTabsState({
          tabs: [makeTab('tab-1', 'normal', { url: 'https://jable.tv/videos/sample/' })]
        })
      );

      await setup.state.loadBrowser('https://jable.tv/videos/sample/', false);

      expect(api.getBrowserUrl).toHaveBeenCalledWith({ tabId: 'tab-1' });
      expect(api.navigateBrowser).not.toHaveBeenCalled();
      expect(api.listBrowserTabs).not.toHaveBeenCalled();
    } finally {
      setup.stop();
    }
  });

  it('navigates when the target video differs from the current tab', async function () {
    const targetTabsState = makeTabsState({
      tabs: [makeTab('tab-1', 'normal', { url: 'https://jable.tv/videos/target/' })]
    });
    const api = {
      setBrowserBounds: vi.fn(),
      getBrowserUrl: vi.fn().mockResolvedValue('https://jable.tv/videos/current/'),
      navigateBrowser: vi.fn().mockResolvedValue('https://jable.tv/videos/target/'),
      listBrowserTabs: vi.fn().mockResolvedValue(targetTabsState)
    };
    const setup = createState(api);

    try {
      setup.state.applyTabsState(makeTabsState());

      await setup.state.loadBrowser('https://jable.tv/videos/target/', false);

      expect(api.navigateBrowser).toHaveBeenCalledWith({
        url: 'https://jable.tv/videos/target/',
        forceReload: false,
        tabId: 'tab-1'
      });
      expect(api.listBrowserTabs).toHaveBeenCalledTimes(1);
      expect(setup.state.tabs.value[0].url).toBe('https://jable.tv/videos/target/');
    } finally {
      setup.stop();
    }
  });
});
