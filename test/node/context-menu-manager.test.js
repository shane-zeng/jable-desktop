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

function createHarness() {
  const tab = createTab();
  const openedUrls = [];
  let menuItems = [];
  let popupOptions = null;

  const Menu = {
    buildFromTemplate: function (items) {
      menuItems = items;
      return {
        popup: function (options) {
          popupOptions = options;
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
    clipboard: {
      writeText: function () {}
    },
    closeBrowserTab: function () {
      return {};
    },
    forwardBrowserMessage: function () {},
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
    menuItems: function () {
      return menuItems;
    },
    openedUrls: openedUrls,
    popupOptions: function () {
      return popupOptions;
    },
    tab: tab
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
