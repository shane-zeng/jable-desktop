import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { canonicalJableVideoUrl } from '../../browser/url-policy';
import type {
  AppView,
  BrowserBounds,
  BrowserDiagnosis,
  BrowserNavigationState,
  BrowserTabState,
  BrowserTabsState,
  CreateBrowserTabPayload,
  JableAppApi
} from '../../types/jable';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useBrowserBounds(api: JableAppApi, activeView: Ref<AppView>) {
  const host = ref<HTMLElement | null>(null);
  const tabs = ref<BrowserTabState[]>([]);
  const activeTabId = ref<string | null>(null);
  const maxTabs = ref(8);

  const activeTab = computed(function () {
    return findTab(activeTabId.value);
  });

  const canCreateTab = computed(function () {
    return tabs.value.length < maxTabs.value;
  });

  const navigation = computed(function () {
    const tab = activeTab.value;

    return {
      tabId: tab ? tab.id : null,
      canGoBack: Boolean(tab && tab.canGoBack),
      canGoForward: Boolean(tab && tab.canGoForward),
      locked: Boolean(tab && tab.locked)
    };
  });

  function findTab(tabId: string | null | undefined): BrowserTabState | null {
    if (!tabId) return null;

    for (let i = 0; i < tabs.value.length; i++) {
      if (tabs.value[i].id === tabId) return tabs.value[i];
    }

    return null;
  }

  function hasTab(tabId: string | null | undefined): boolean {
    return Boolean(findTab(tabId));
  }

  function firstUnlockedSyncTab(): BrowserTabState | null {
    for (let i = 0; i < tabs.value.length; i++) {
      if (tabs.value[i].kind === 'sync' && !tabs.value[i].locked) return tabs.value[i];
    }

    return null;
  }

  function applyTabsState(state: BrowserTabsState | null | undefined): BrowserTabsState | null | undefined {
    const nextState = state || { activeTabId: null, maxTabs: maxTabs.value, tabs: [] };
    tabs.value = Array.isArray(nextState.tabs) ? nextState.tabs : [];
    activeTabId.value = nextState.activeTabId || (tabs.value[0] ? tabs.value[0].id : null);

    if (nextState.maxTabs) maxTabs.value = nextState.maxTabs;
    scheduleResize();
    return state;
  }

  async function refreshTabs() {
    return applyTabsState(await api.listBrowserTabs());
  }

  function setHost(element: HTMLElement | null) {
    host.value = element;
    scheduleResize();
  }

  function currentBounds(): BrowserBounds {
    if (!host.value) return { visible: false };

    const rect = host.value.getBoundingClientRect();
    return {
      visible: activeView.value === 'browser',
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function resize() {
    if (!host.value) return;

    if (activeView.value !== 'browser') {
      hide();
      return;
    }

    api.setBrowserBounds(currentBounds());
  }

  function hide() {
    api.setBrowserBounds({ visible: false });
  }

  function scheduleResize() {
    nextTick(function () {
      resize();
      // Vue layout, tab rail transitions, and Electron WebContentsView bounds
      // settle on different ticks; replaying avoids stale embedded-browser size.
      setTimeout(resize, 50);
      setTimeout(resize, 250);
      setTimeout(resize, 1000);
    });
  }

  function setNavigationState(nextNavigation?: Partial<BrowserNavigationState> | null) {
    nextNavigation = nextNavigation || {};
    const tabId = nextNavigation.tabId || activeTabId.value;

    if (!tabId) return;

    tabs.value = tabs.value.map(function (tab) {
      if (tab.id !== tabId) return tab;

      return Object.assign({}, tab, {
        canGoBack: Boolean(nextNavigation.canGoBack),
        canGoForward: Boolean(nextNavigation.canGoForward),
        locked: Boolean(nextNavigation.locked)
      });
    });
  }

  async function refreshNavigationState(tabId?: string | null) {
    setNavigationState(await api.getBrowserNavigationState({ tabId: tabId || activeTabId.value }));
  }

  async function createTab(url: string | null, options?: Omit<CreateBrowserTabPayload, 'url'>) {
    options = options || {};
    applyTabsState(await api.createBrowserTab(Object.assign({}, options, { url: url })));
    scheduleResize();
    return activeTab.value;
  }

  async function activateTab(tabId: string | null) {
    applyTabsState(await api.activateBrowserTab(tabId));
    scheduleResize();
  }

  async function closeTab(tabId: string | null) {
    applyTabsState(await api.closeBrowserTab(tabId));
    scheduleResize();
  }

  async function setTabLocked(tabId: string | null, locked: boolean) {
    applyTabsState(
      await api.setBrowserTabLocked({
        tabId: tabId,
        locked: locked
      })
    );
  }

  async function setTabMuted(tabId: string | null, muted: boolean) {
    applyTabsState(
      await api.setBrowserTabMuted({
        tabId: tabId,
        muted: muted
      })
    );
  }

  async function loadBrowser(url: string, forceReload: boolean, tabId?: string | null) {
    const targetTabId = tabId || activeTabId.value;
    scheduleResize();
    if (!forceReload && (await isSameOpenVideo(url, targetTabId))) {
      return;
    }

    await api.navigateBrowser({
      url: url,
      forceReload: forceReload,
      tabId: targetTabId
    });
    await refreshTabs();
    scheduleResize();
  }

  async function isSameOpenVideo(url: string, tabId?: string | null) {
    const targetVideoUrl = canonicalJableVideoUrl(url);

    if (!targetVideoUrl) return false;

    return canonicalJableVideoUrl(await currentBrowserUrl(tabId)) === targetVideoUrl;
  }

  async function currentBrowserUrl(tabId?: string | null) {
    try {
      return await api.getBrowserUrl({ tabId: tabId || activeTabId.value });
    } catch (error) {
      return '';
    }
  }

  async function goBack() {
    setNavigationState(await api.goBackBrowser({ tabId: activeTabId.value }));
  }

  async function goForward() {
    setNavigationState(await api.goForwardBrowser({ tabId: activeTabId.value }));
  }

  async function reload() {
    setNavigationState(await api.reloadBrowser({ tabId: activeTabId.value }));
  }

  async function reloadTab(tabId?: string | null) {
    setNavigationState(await api.reloadBrowser({ tabId: tabId || activeTabId.value }));
    await refreshTabs();
  }

  async function diagnose() {
    resize();

    const hostRect = host.value ? host.value.getBoundingClientRect() : { width: 0, height: 0 };
    let guest: BrowserDiagnosis = {};

    try {
      guest = await api.diagnoseBrowser({ tabId: activeTabId.value });
    } catch (error) {
      guest = { error: errorMessage(error) };
    }

    const message = [
      'app=' + window.innerWidth + 'x' + window.innerHeight,
      'host=' + Math.round(hostRect.width) + 'x' + Math.round(hostRect.height),
      'guest=' +
        (guest.error ? guest.error : guest.innerWidth + 'x' + guest.innerHeight + '/scroll' + guest.scrollHeight),
      'url=' + (guest.url || (await currentBrowserUrl()))
    ].join(' | ');

    console.log('[JableDesktopDiagnostics]', message, guest);
    return message;
  }

  window.addEventListener('resize', scheduleResize);
  watch(activeView, scheduleResize);

  onBeforeUnmount(function () {
    window.removeEventListener('resize', scheduleResize);
  });

  return {
    host: host,
    tabs: tabs,
    activeTabId: activeTabId,
    activeTab: activeTab,
    maxTabs: maxTabs,
    canCreateTab: canCreateTab,
    navigation: navigation,
    setHost: setHost,
    hide: hide,
    applyTabsState: applyTabsState,
    refreshTabs: refreshTabs,
    setNavigationState: setNavigationState,
    refreshNavigationState: refreshNavigationState,
    createTab: createTab,
    activateTab: activateTab,
    closeTab: closeTab,
    setTabLocked: setTabLocked,
    setTabMuted: setTabMuted,
    loadBrowser: loadBrowser,
    currentBrowserUrl: currentBrowserUrl,
    hasTab: hasTab,
    firstUnlockedSyncTab: firstUnlockedSyncTab,
    goBack: goBack,
    goForward: goForward,
    reload: reload,
    reloadTab: reloadTab,
    diagnose: diagnose,
    scheduleResize: scheduleResize
  };
}
