'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const contextMenuManager = require('../../app/runtime-dist/main-process/context-menu-manager.js');

function createTab() {
  return {
    id: 'tab-1',
    canGoBack: false,
    canGoForward: false,
    locked: false,
    muted: false,
    theaterMode: false,
    url: 'https://jable.tv/',
    view: {
      webContents: {
        copy: function () {},
        cut: function () {},
        paste: function () {},
        redo: function () {},
        selectAll: function () {},
        undo: function () {}
      }
    }
  };
}

function canonicalJableVideoUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:') return null;
    if (parsed.origin !== 'https://jable.tv' && parsed.origin !== 'https://fs1.app') return null;
    if (!/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return null;
    return 'https://jable.tv' + parsed.pathname.replace(/\/?$/, '/');
  } catch (error) {
    return null;
  }
}

function createHarness(options) {
  options = options || {};
  const tab = createTab();
  const openedUrls = [];
  const forwardedMessages = [];
  const theaterModeCalls = [];
  let menuItems = [];
  let popupOptions = null;

  if (options.url) tab.url = options.url;
  if (options.theaterMode) tab.theaterMode = true;

  const Menu = {
    buildFromTemplate: function (items) {
      menuItems = items;
      return {
        popup: function (nextPopupOptions) {
          popupOptions = nextPopupOptions;
        }
      };
    }
  };

  const manager = contextMenuManager.createContextMenuManager({
    activateBrowserTab: function () {
      return {};
    },
    canCreateBrowserTab: function () {
      return true;
    },
    canonicalJableVideoUrl: canonicalJableVideoUrl,
    clipboard: {
      writeText: function () {}
    },
    closeBrowserTab: function () {
      return {};
    },
    forwardBrowserMessage: function (channel, payload) {
      forwardedMessages.push({ channel: channel, payload: payload });
    },
    getActiveBrowserTabId: function () {
      return tab.id;
    },
    getBrowserTab: function () {
      return tab;
    },
    getMainWindow: function () {
      return {
        isDestroyed: function () {
          return false;
        }
      };
    },
    goBrowserBack: function () {
      return Promise.resolve({});
    },
    goBrowserForward: function () {
      return Promise.resolve({});
    },
    homeUrl: 'https://jable.tv/',
    Menu: Menu,
    reloadBrowser: function () {
      return Promise.resolve({});
    },
    safeCreateBrowserTab: function () {
      return {};
    },
    setBrowserTabTheaterMode: function (targetTab, enabled) {
      theaterModeCalls.push({ tabId: targetTab.id, enabled: enabled });
      if (options.theaterModeError) return Promise.reject(new Error(options.theaterModeError));
      targetTab.theaterMode = enabled;
      return Promise.resolve({ enabled: enabled });
    },
    setBrowserTabMuted: function () {
      return {};
    },
    shell: {
      openExternal: function (url) {
        openedUrls.push(url);
        return Promise.resolve();
      }
    },
    syncBrowserTabMediaState: function () {},
    t: function (key) {
      return key;
    }
  });

  return {
    manager: manager,
    forwardedMessages: forwardedMessages,
    menuItems: function () {
      return menuItems;
    },
    openedUrls: openedUrls,
    popupOptions: function () {
      return popupOptions;
    },
    tab: tab,
    theaterModeCalls: theaterModeCalls
  };
}

function menuItemByLabel(items, label) {
  return items.find(function (item) {
    return item.label === label;
  });
}

test('browser context menu can search selected text with Google in the system browser', function () {
  const harness = createHarness();

  harness.manager.showBrowserContextMenu(harness.tab, {
    selectionText: '  測試 keyword & symbols  '
  });

  const items = harness.menuItems();
  const searchItem = menuItemByLabel(items, 'context.searchSelectionWithGoogle');

  assert.ok(searchItem);
  assert.ok(menuItemByLabel(items, 'context.copySelection'));
  assert.ok(harness.popupOptions());

  searchItem.click();

  assert.deepEqual(harness.openedUrls, ['https://www.google.com/search?q=%E6%B8%AC%E8%A9%A6+keyword+%26+symbols']);
});

test('editable browser context menu can search selected text with Google', function () {
  const harness = createHarness();

  harness.manager.showBrowserContextMenu(harness.tab, {
    isEditable: true,
    selectionText: 'title text',
    editFlags: {
      canCopy: true,
      canSelectAll: true
    }
  });

  const searchItem = menuItemByLabel(harness.menuItems(), 'context.searchSelectionWithGoogle');

  assert.ok(searchItem);

  searchItem.click();

  assert.deepEqual(harness.openedUrls, ['https://www.google.com/search?q=title+text']);
});

test('browser context menu toggles theater mode on Jable video pages', function () {
  const harness = createHarness({ url: 'https://jable.tv/videos/sample/' });

  harness.manager.showBrowserContextMenu(harness.tab, {
    pageURL: 'https://jable.tv/videos/sample/'
  });

  const theaterItem = menuItemByLabel(harness.menuItems(), 'context.theaterMode');

  assert.ok(theaterItem);
  assert.equal(theaterItem.type, 'checkbox');
  assert.equal(theaterItem.checked, false);

  theaterItem.click({ checked: true });

  assert.deepEqual(harness.theaterModeCalls, [{ tabId: 'tab-1', enabled: true }]);
});

test('browser context menu marks active theater mode on Jable video pages', function () {
  const harness = createHarness({
    theaterMode: true,
    url: 'https://fs1.app/videos/sample/'
  });

  harness.manager.showBrowserContextMenu(harness.tab, {
    pageURL: 'https://fs1.app/videos/sample/'
  });

  const theaterItem = menuItemByLabel(harness.menuItems(), 'context.theaterMode');

  assert.ok(theaterItem);
  assert.equal(theaterItem.checked, true);
});

test('browser context menu hides theater mode outside Jable video pages', function () {
  const harness = createHarness({ url: 'https://jable.tv/my/favourites/videos/' });

  harness.manager.showBrowserContextMenu(harness.tab, {
    pageURL: 'https://jable.tv/my/favourites/videos/',
    mediaType: 'video',
    srcURL: 'https://jable.tv/preview.mp4'
  });

  assert.equal(menuItemByLabel(harness.menuItems(), 'context.theaterMode'), undefined);
});

test('browser context menu forwards theater mode errors', async function () {
  const harness = createHarness({
    theaterModeError: 'No video player found',
    url: 'https://jable.tv/videos/sample/'
  });

  harness.manager.showBrowserContextMenu(harness.tab, {
    pageURL: 'https://jable.tv/videos/sample/'
  });

  menuItemByLabel(harness.menuItems(), 'context.theaterMode').click({ checked: true });
  await new Promise(function (resolve) {
    setImmediate(resolve);
  });

  assert.deepEqual(harness.forwardedMessages, [
    {
      channel: 'browser-error',
      payload: { message: 'No video player found' }
    }
  ]);
});

test('library video context menu can include download file actions', function () {
  const harness = createHarness();

  harness.manager.showLibraryVideoMenu({
    url: 'https://jable.tv/videos/ready/',
    title: 'Ready Video',
    downloadFileActions: true,
    x: 11,
    y: 22
  });

  const openFileItem = menuItemByLabel(harness.menuItems(), 'context.openDownloadFile');
  const revealFileItem = menuItemByLabel(harness.menuItems(), 'context.revealDownloadFile');

  assert.ok(openFileItem);
  assert.ok(revealFileItem);
  assert.deepEqual(harness.popupOptions().x, 11);
  assert.deepEqual(harness.popupOptions().y, 22);

  openFileItem.click();
  revealFileItem.click();

  assert.deepEqual(harness.forwardedMessages, [
    {
      channel: 'library-video-menu-action',
      payload: {
        action: 'open-download-file',
        url: 'https://jable.tv/videos/ready/'
      }
    },
    {
      channel: 'library-video-menu-action',
      payload: {
        action: 'reveal-download-file',
        url: 'https://jable.tv/videos/ready/'
      }
    }
  ]);
});
