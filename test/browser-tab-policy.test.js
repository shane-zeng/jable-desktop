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
