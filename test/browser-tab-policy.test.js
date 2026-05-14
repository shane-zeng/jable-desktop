'use strict';

var assert = require('node:assert/strict');
var test = require('node:test');
var policy = require('../app/browser-tab-policy');

test('normal browser tabs use background throttling', function () {
  var preferences = policy.browserTabWebPreferences('normal', '/tmp/preload.js', 'persist:test');

  assert.equal(preferences.backgroundThrottling, true);
  assert.equal(preferences.preload, '/tmp/preload.js');
  assert.equal(preferences.partition, 'persist:test');
});

test('sync browser tabs keep background throttling disabled', function () {
  var preferences = policy.browserTabWebPreferences('sync', '/tmp/preload.js', 'persist:test');

  assert.equal(preferences.backgroundThrottling, false);
});

test('serializedMediaState exposes stable tab media flags', function () {
  assert.deepEqual(
    policy.serializedMediaState({
      muted: true,
      audible: true,
      mediaPlaying: true,
      pictureInPicture: true,
      discarded: true
    }),
    {
      muted: true,
      audible: true,
      mediaPlaying: true,
      pictureInPicture: true,
      discarded: true
    }
  );
});

test('nextActiveTabIdAfterClose prefers the next tab when closing the active tab', function () {
  var tabs = [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }];

  assert.equal(policy.nextActiveTabIdAfterClose(tabs, 'tab-2', 'tab-2'), 'tab-3');
});

test('nextActiveTabIdAfterClose falls back to the previous tab when closing the last active tab', function () {
  var tabs = [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }];

  assert.equal(policy.nextActiveTabIdAfterClose(tabs, 'tab-3', 'tab-3'), 'tab-2');
});

test('nextActiveTabIdAfterClose keeps the current active tab when closing an inactive tab', function () {
  var tabs = [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }];

  assert.equal(policy.nextActiveTabIdAfterClose(tabs, 'tab-2', 'tab-1'), 'tab-2');
});

test('nextActiveTabIdAfterClose returns null when closing the only active tab', function () {
  var tabs = [{ id: 'tab-1' }];

  assert.equal(policy.nextActiveTabIdAfterClose(tabs, 'tab-1', 'tab-1'), null);
});

test('nextActiveTabIdByOffset returns the next tab', function () {
  var tabs = [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }];

  assert.equal(policy.nextActiveTabIdByOffset(tabs, 'tab-2', 1), 'tab-3');
});

test('nextActiveTabIdByOffset returns the previous tab', function () {
  var tabs = [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }];

  assert.equal(policy.nextActiveTabIdByOffset(tabs, 'tab-2', -1), 'tab-1');
});

test('nextActiveTabIdByOffset wraps from the last tab to the first tab', function () {
  var tabs = [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }];

  assert.equal(policy.nextActiveTabIdByOffset(tabs, 'tab-3', 1), 'tab-1');
});

test('nextActiveTabIdByOffset wraps from the first tab to the last tab', function () {
  var tabs = [{ id: 'tab-1' }, { id: 'tab-2' }, { id: 'tab-3' }];

  assert.equal(policy.nextActiveTabIdByOffset(tabs, 'tab-1', -1), 'tab-3');
});

test('nextActiveTabIdByOffset keeps the active tab when there is only one tab', function () {
  var tabs = [{ id: 'tab-1' }];

  assert.equal(policy.nextActiveTabIdByOffset(tabs, 'tab-1', 1), 'tab-1');
  assert.equal(policy.nextActiveTabIdByOffset(tabs, 'tab-1', -1), 'tab-1');
});

test('nextActiveTabIdByOffset returns null when the active tab is missing', function () {
  var tabs = [{ id: 'tab-1' }, { id: 'tab-2' }];

  assert.equal(policy.nextActiveTabIdByOffset(tabs, 'tab-3', 1), null);
});

test('browserTabShortcutOffset detects shared tab switching shortcuts', function () {
  assert.equal(policy.browserTabShortcutOffset({ type: 'keyDown', key: 'Tab', control: true }, true), 1);
  assert.equal(policy.browserTabShortcutOffset({ type: 'keyDown', key: 'Tab', control: true, shift: true }, false), -1);
});

test('browserTabShortcutOffset detects Windows and Linux page key shortcuts', function () {
  assert.equal(policy.browserTabShortcutOffset({ type: 'keyDown', key: 'PageDown', control: true }, false), 1);
  assert.equal(policy.browserTabShortcutOffset({ type: 'keyDown', key: 'PageUp', control: true }, false), -1);
});

test('browserTabShortcutOffset detects macOS arrow and bracket shortcuts', function () {
  assert.equal(policy.browserTabShortcutOffset({ type: 'keyDown', key: 'ArrowRight', meta: true, alt: true }, true), 1);
  assert.equal(policy.browserTabShortcutOffset({ type: 'keyDown', key: 'ArrowLeft', meta: true, alt: true }, true), -1);
  assert.equal(
    policy.browserTabShortcutOffset({ type: 'keyDown', key: '}', code: 'BracketRight', meta: true, shift: true }, true),
    1
  );
  assert.equal(
    policy.browserTabShortcutOffset({ type: 'keyDown', key: '{', code: 'BracketLeft', meta: true, shift: true }, true),
    -1
  );
});

test('browserTabShortcutOffset ignores auto-repeat and unrelated modifiers', function () {
  assert.equal(
    policy.browserTabShortcutOffset({ type: 'keyDown', key: 'Tab', control: true, isAutoRepeat: true }, false),
    0
  );
  assert.equal(policy.browserTabShortcutOffset({ type: 'keyDown', key: 'PageDown', control: true }, true), 0);
  assert.equal(policy.browserTabShortcutOffset({ type: 'keyDown', key: 'ArrowRight', meta: true }, true), 0);
});
