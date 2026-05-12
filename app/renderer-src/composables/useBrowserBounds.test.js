import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useBrowserBounds } from './useBrowserBounds';

function createState(api) {
  var scope = effectScope();
  var state;

  scope.run(function () {
    state = useBrowserBounds(api, ref('browser'));
  });

  return {
    state: state,
    stop: function () {
      scope.stop();
    }
  };
}

function makeTabsState(overrides) {
  return Object.assign({
    activeTabId: 'tab-1',
    maxTabs: 8,
    tabs: [
      {
        id: 'tab-1',
        kind: 'normal',
        title: 'Jable',
        url: 'https://jable.tv/',
        loading: false,
        locked: false,
        canGoBack: false,
        canGoForward: true
      },
      {
        id: 'tab-2',
        kind: 'sync',
        title: '同步：影片收藏',
        url: 'https://jable.tv/my/favourites/videos/',
        loading: true,
        locked: true,
        canGoBack: false,
        canGoForward: false
      }
    ]
  }, overrides || {});
}

describe('useBrowserBounds', function () {
  it('tracks tabs, active navigation state, and tab limits', function () {
    var setup = createState({
      setBrowserBounds: vi.fn()
    });

    try {
      setup.state.applyTabsState(makeTabsState({
        maxTabs: 2
      }));

      expect(setup.state.tabs.value).toHaveLength(2);
      expect(setup.state.activeTab.value.id).toBe('tab-1');
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
    var setup = createState({
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
      expect(setup.state.firstUnlockedSyncTab().id).toBe('tab-2');
    } finally {
      setup.stop();
    }
  });

  it('delegates tab operations to the browser API and stores returned state', async function () {
    var api = {
      setBrowserBounds: vi.fn(),
      createBrowserTab: vi.fn().mockResolvedValue(makeTabsState({
        activeTabId: 'tab-3',
        tabs: [
          { id: 'tab-3', kind: 'normal', title: 'New', url: 'https://jable.tv/', loading: false, locked: false }
        ]
      })),
      activateBrowserTab: vi.fn().mockResolvedValue(makeTabsState({ activeTabId: 'tab-2' })),
      closeBrowserTab: vi.fn().mockResolvedValue(makeTabsState({
        activeTabId: 'tab-1',
        tabs: [makeTabsState().tabs[0]]
      })),
      setBrowserTabLocked: vi.fn().mockResolvedValue(makeTabsState({
        activeTabId: 'tab-2',
        tabs: [
          makeTabsState().tabs[0],
          Object.assign({}, makeTabsState().tabs[1], { locked: false })
        ]
      }))
    };
    var setup = createState(api);

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
    } finally {
      setup.stop();
    }
  });
});
