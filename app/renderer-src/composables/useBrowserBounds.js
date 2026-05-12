import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

export function useBrowserBounds(api, activeView) {
  var host = ref(null);
  var navigation = ref({
    canGoBack: false,
    canGoForward: false
  });

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
    navigation.value = {
      canGoBack: !!nextNavigation.canGoBack,
      canGoForward: !!nextNavigation.canGoForward
    };
  }

  async function refreshNavigationState() {
    setNavigationState(await api.getBrowserNavigationState());
  }

  async function loadBrowser(url, forceReload) {
    scheduleResize();
    await api.navigateBrowser({ url: url, forceReload: forceReload });
    await refreshNavigationState();
    scheduleResize();
  }

  async function currentBrowserUrl() {
    try {
      return await api.getBrowserUrl();
    } catch (error) {
      return '';
    }
  }

  async function goBack() {
    setNavigationState(await api.goBackBrowser());
  }

  async function goForward() {
    setNavigationState(await api.goForwardBrowser());
  }

  async function reload() {
    setNavigationState(await api.reloadBrowser());
  }

  async function diagnose() {
    resize();

    var hostRect = host.value
      ? host.value.getBoundingClientRect()
      : { width: 0, height: 0 };
    var guest = null;

    try {
      guest = await api.diagnoseBrowser();
    } catch (error) {
      guest = { error: error.message };
    }

    var message = [
      'app=' + window.innerWidth + 'x' + window.innerHeight,
      'host=' + Math.round(hostRect.width) + 'x' + Math.round(hostRect.height),
      'guest=' + (guest.error ? guest.error : guest.innerWidth + 'x' + guest.innerHeight + '/scroll' + guest.scrollHeight),
      'url=' + (guest.url || await currentBrowserUrl())
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
    navigation: navigation,
    setHost: setHost,
    hide: hide,
    setNavigationState: setNavigationState,
    refreshNavigationState: refreshNavigationState,
    loadBrowser: loadBrowser,
    currentBrowserUrl: currentBrowserUrl,
    goBack: goBack,
    goForward: goForward,
    reload: reload,
    diagnose: diagnose,
    scheduleResize: scheduleResize
  };
}
