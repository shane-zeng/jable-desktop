import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

export function useBrowserBounds(api, activeView) {
  var host = ref(null);
  var tabs = ref([]);
  var activeTabId = ref(null);
  var maxTabs = ref(8);

  var activeTab = computed(function () {
    return findTab(activeTabId.value);
  });

  var canCreateTab = computed(function () {
    return tabs.value.length < maxTabs.value;
  });

  var navigation = computed(function () {
    var tab = activeTab.value;

    return {
      tabId: tab ? tab.id : null,
      canGoBack: !!(tab && tab.canGoBack),
      canGoForward: !!(tab && tab.canGoForward),
      locked: !!(tab && tab.locked)
    };
  });

  function findTab(tabId) {
    if (!tabId) return null;

    for (var i = 0; i < tabs.value.length; i++) {
      if (tabs.value[i].id === tabId) return tabs.value[i];
    }

    return null;
  }

  function hasTab(tabId) {
    return !!findTab(tabId);
  }

  function firstUnlockedSyncTab() {
    for (var i = 0; i < tabs.value.length; i++) {
      if (tabs.value[i].kind === 'sync' && !tabs.value[i].locked) return tabs.value[i];
    }

    return null;
  }

  function applyTabsState(state) {
    state = state || {};
    tabs.value = Array.isArray(state.tabs) ? state.tabs : [];
    activeTabId.value = state.activeTabId || (tabs.value[0] ? tabs.value[0].id : null);

    if (state.maxTabs) maxTabs.value = state.maxTabs;
    scheduleResize();
    return state;
  }

  async function refreshTabs() {
    return applyTabsState(await api.listBrowserTabs());
  }

  function setHost(element) {
    host.value = element;
    scheduleResize();
  }

  function currentBounds() {
    if (!host.value) return { visible: false };

    var rect = host.value.getBoundingClientRect();
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
      setTimeout(resize, 50);
      setTimeout(resize, 250);
      setTimeout(resize, 1000);
    });
  }

  function setNavigationState(nextNavigation) {
    nextNavigation = nextNavigation || {};
    var tabId = nextNavigation.tabId || activeTabId.value;

    if (!tabId) return;

    tabs.value = tabs.value.map(function (tab) {
      if (tab.id !== tabId) return tab;

      return Object.assign({}, tab, {
        canGoBack: !!nextNavigation.canGoBack,
        canGoForward: !!nextNavigation.canGoForward,
        locked: !!nextNavigation.locked
      });
    });
  }

  async function refreshNavigationState(tabId) {
    setNavigationState(await api.getBrowserNavigationState({ tabId: tabId || activeTabId.value }));
  }

  async function createTab(url, options) {
    options = options || {};
    applyTabsState(await api.createBrowserTab(Object.assign({}, options, { url: url })));
    scheduleResize();
    return activeTab.value;
  }

  async function activateTab(tabId) {
    applyTabsState(await api.activateBrowserTab(tabId));
    scheduleResize();
  }

  async function closeTab(tabId) {
    applyTabsState(await api.closeBrowserTab(tabId));
    scheduleResize();
  }

  async function setTabLocked(tabId, locked) {
    applyTabsState(
      await api.setBrowserTabLocked({
        tabId: tabId,
        locked: locked
      })
    );
  }

  async function setTabMuted(tabId, muted) {
    applyTabsState(
      await api.setBrowserTabMuted({
        tabId: tabId,
        muted: muted
      })
    );
  }

  async function loadBrowser(url, forceReload, tabId) {
    var targetTabId = tabId || activeTabId.value;
    scheduleResize();
    await api.navigateBrowser({
      url: url,
      forceReload: forceReload,
      tabId: targetTabId
    });
    await refreshTabs();
    scheduleResize();
  }

  async function currentBrowserUrl(tabId) {
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

  async function reloadTab(tabId) {
    setNavigationState(await api.reloadBrowser({ tabId: tabId || activeTabId.value }));
    await refreshTabs();
  }

  async function diagnose() {
    resize();

    var hostRect = host.value ? host.value.getBoundingClientRect() : { width: 0, height: 0 };
    var guest = null;

    try {
      guest = await api.diagnoseBrowser({ tabId: activeTabId.value });
    } catch (error) {
      guest = { error: error.message };
    }

    var message = [
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
