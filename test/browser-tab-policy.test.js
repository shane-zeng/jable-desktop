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
