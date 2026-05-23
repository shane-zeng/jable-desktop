'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserShortcutManager } = require('../../app/runtime-dist/main-process/browser/shortcut-manager');

function createHarness(options = {}) {
  let shortcutHandler = null;
  const forwardedMessages = [];

  const manager = createBrowserShortcutManager({
    activateRelativeBrowserTab: function () {
      return { activeTabId: null, maxTabs: 14, tabs: [] };
    },
    closeBrowserTab: function () {
      return { activeTabId: null, maxTabs: 14, tabs: [] };
    },
    createBrowserTab: function () {
      return { activeTabId: null, maxTabs: 14, tabs: [] };
    },
    createWindow: function () {},
    forwardBrowserMessage: function (channel, payload) {
      forwardedMessages.push({ channel, payload });
    },
    getMainWindow: function () {
      if (options.hasWindow === false) return null;
      return { isDestroyed: () => Boolean(options.destroyed) };
    },
    homeUrl: 'https://jable.tv/',
    isMacos: Boolean(options.isMacos),
    reloadBrowser: function () {
      return Promise.resolve({ locked: false, canGoBack: false, canGoForward: false });
    }
  });

  manager.registerAppShortcuts({
    on: function (eventName, handler) {
      if (eventName === 'before-input-event') shortcutHandler = handler;
    }
  });

  return {
    forwardedMessages,
    press: function (input) {
      let prevented = false;
      shortcutHandler(
        {
          preventDefault: function () {
            prevented = true;
          }
        },
        Object.assign({ type: 'keyDown' }, input)
      );
      return prevented;
    }
  };
}

test('browser shortcut manager forwards app view number shortcuts', function () {
  const macosHarness = createHarness({ isMacos: true });

  assert.equal(macosHarness.press({ key: '1', meta: true }), true);
  assert.equal(macosHarness.press({ key: '2', meta: true }), true);
  assert.equal(macosHarness.press({ key: '3', meta: true }), true);
  assert.deepEqual(macosHarness.forwardedMessages, [
    { channel: 'app-view-shortcut', payload: { view: 'browser' } },
    { channel: 'app-view-shortcut', payload: { view: 'library' } },
    { channel: 'app-view-shortcut', payload: { view: 'settings' } }
  ]);

  const windowsHarness = createHarness({ isMacos: false });

  assert.equal(windowsHarness.press({ key: '1', control: true }), true);
  assert.equal(windowsHarness.press({ key: '2', control: true }), true);
  assert.equal(windowsHarness.press({ key: '3', control: true }), true);
  assert.deepEqual(windowsHarness.forwardedMessages, [
    { channel: 'app-view-shortcut', payload: { view: 'browser' } },
    { channel: 'app-view-shortcut', payload: { view: 'library' } },
    { channel: 'app-view-shortcut', payload: { view: 'settings' } }
  ]);
});

test('browser shortcut manager ignores number shortcuts with unrelated modifiers', function () {
  const harness = createHarness({ isMacos: true });

  assert.equal(harness.press({ key: '1', meta: true, shift: true }), false);
  assert.equal(harness.press({ key: '2', control: true }), false);
  assert.equal(harness.press({ key: '3', meta: true, alt: true }), false);
  assert.deepEqual(harness.forwardedMessages, []);
});

test('browser shortcut manager forwards tab rail display mode shortcuts', function () {
  const macosHarness = createHarness({ isMacos: true });

  assert.equal(macosHarness.press({ key: 's', meta: true }), true);
  assert.equal(macosHarness.press({ key: 's', meta: true, shift: true }), true);
  assert.deepEqual(macosHarness.forwardedMessages, [
    { channel: 'browser-tabs-compact-toggle-shortcut', payload: {} },
    { channel: 'browser-tabs-shared-toggle-shortcut', payload: {} }
  ]);

  const windowsHarness = createHarness({ isMacos: false });

  assert.equal(windowsHarness.press({ key: 's', control: true }), true);
  assert.equal(windowsHarness.press({ key: 's', control: true, shift: true }), true);
  assert.deepEqual(windowsHarness.forwardedMessages, [
    { channel: 'browser-tabs-compact-toggle-shortcut', payload: {} },
    { channel: 'browser-tabs-shared-toggle-shortcut', payload: {} }
  ]);
});

test('browser shortcut manager forwards download sidebar shortcut', async function () {
  const macosHarness = createHarness({ isMacos: true });

  assert.equal(macosHarness.press({ key: 'd', meta: true, shift: true }), true);
  assert.deepEqual(macosHarness.forwardedMessages, [
    { channel: 'browser-download-sidebar-toggle-shortcut', payload: {} }
  ]);

  await new Promise(function (resolve) {
    setTimeout(resolve, 160);
  });

  const windowsHarness = createHarness({ isMacos: false });

  assert.equal(windowsHarness.press({ key: 'd', control: true, shift: true }), true);
  assert.deepEqual(windowsHarness.forwardedMessages, [
    { channel: 'browser-download-sidebar-toggle-shortcut', payload: {} }
  ]);
});

test('browser shortcut manager ignores download sidebar shortcut with unrelated modifiers', function () {
  const macosHarness = createHarness({ isMacos: true });

  assert.equal(macosHarness.press({ key: 'd', meta: true }), false);
  assert.equal(macosHarness.press({ key: 'd', meta: true, shift: true, alt: true }), false);
  assert.equal(macosHarness.press({ key: 'd', control: true, shift: true }), false);
  assert.deepEqual(macosHarness.forwardedMessages, []);
});
