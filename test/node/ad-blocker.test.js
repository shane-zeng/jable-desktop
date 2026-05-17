'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const adBlocker = require('../../app/runtime-dist/browser/ad-blocker');

test('blocks known Jable ad and popup request hosts', function () {
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://a.labadena.com/api/spots/220808?p=1&s1=%subid1%&kw=',
      resourceType: 'xhr'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://static.adxadserv.com/js/adb.js',
      resourceType: 'script'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://ads.adxadserv.com/api/v1/popunder?zone=example',
      resourceType: 'xhr'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://cdn.tapioni.com/asg_embed.js',
      resourceType: 'script'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://go.mnaspm.com/smartpop/example?width=330px',
      resourceType: 'script'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://a.magsrv.com/nativeads-v2.js',
      resourceType: 'script'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://t.fluxtrck.site/c1/9432b3b0-661c-4d05-9552-29757dafc4cb?cv1=%7Bbanner%7D',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://s.zline0.com/v1/d.php?z=4789176',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://go.bluetrafficstream.com/?realDomain=creative.bluetrafficstream.example&seenLanding=1',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://go.xlivrdr.com/smartpop/ebdeebd?seenLanding=1&p1=3730011',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://creative.xlivrdr.com/LPOmega?action=sbSignupwithModel&campaignId=example',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://creative.xxxvjmp.com/LPOmega?action=sbSignupwithModel',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://pxl-eu.tsyndicate.com/api/v1/p/p.gif?p=example',
      resourceType: 'image'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://r.trackwilltrk.com/click?campaign=example',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://s.magsrv.com/v1/vast.php?zone=example',
      resourceType: 'xhr'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://t.nettrck.store/click?campaign=example',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://img.doppiocdn.com/thumbs/1778850764/208569547',
      resourceType: 'image'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://z6v2p9a8.bkcdn.net/library/952500/5047446.mp4',
      resourceType: 'media'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://assets-cdn.jable.tv/assets/images/252/427-240-3.gif',
      resourceType: 'image'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://assetscdn.jable.tv/assets/images/uu/uhyg6-760x70.gif',
      resourceType: 'image'
    }),
    true
  );
});

test('blocks the Google IMA ad SDK without blocking unrelated Google APIs', function () {
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://imasdk.googleapis.com/js/sdkloader/ima3.js',
      resourceType: 'script'
    }),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://imasdk.googleapis.com/other/library.js',
      resourceType: 'script'
    }),
    false
  );
});

test('does not block Jable main pages, blob media URLs, or analytics in the first rule set', function () {
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://jable.tv/videos/example/',
      resourceType: 'mainFrame'
    }),
    false
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'blob:https://jable.tv/47ca347e-6160-4772-b55f-b3351a00b91a',
      resourceType: 'media'
    }),
    false
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://www.googletagmanager.com/gtag/js?id=G-1DTX7D4FHE',
      resourceType: 'script'
    }),
    false
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://assetscdn.jable.tv/assets/images/logo.png',
      resourceType: 'image'
    }),
    false
  );
  assert.equal(
    adBlocker.shouldBlockAdRequest({
      url: 'https://assets-cdn.jable.tv/assets/images/logo.png',
      resourceType: 'image'
    }),
    false
  );
});

test('blocks known ad navigations before creating app tabs', function () {
  assert.equal(adBlocker.shouldBlockAdNavigation('https://go.mnaspm.com/smartpop/example'), true);
  assert.equal(adBlocker.shouldBlockAdNavigation('https://t.fluxtrck.site/c1/example?cv1=%7Bbanner%7D'), true);
  assert.equal(adBlocker.shouldBlockAdNavigation('https://s.zline0.com/v1/d.php?z=4789176'), true);
  assert.equal(adBlocker.shouldBlockAdNavigation('https://go.bluetrafficstream.com/?seenLanding=1'), true);
  assert.equal(adBlocker.shouldBlockAdNavigation('https://go.xlivrdr.com/smartpop/ebdeebd?p1=3730011'), true);
  assert.equal(
    adBlocker.shouldBlockAdNavigation('https://creative.xlivrdr.com/LPOmega?action=sbSignupwithModel'),
    true
  );
  assert.equal(
    adBlocker.shouldBlockAdNavigation('https://creative.xxxvjmp.com/LPOmega?action=sbSignupwithModel'),
    true
  );
  assert.equal(adBlocker.shouldBlockAdNavigation('https://r.trackwilltrk.com/click?campaign=example'), true);
  assert.equal(adBlocker.shouldBlockAdNavigation('https://t.nettrck.store/click?campaign=example'), true);
  assert.equal(adBlocker.shouldBlockAdNavigation('https://jable.tv/videos/example/'), false);
  assert.equal(adBlocker.shouldBlockAdNavigation('blob:https://jable.tv/example'), false);
});

test('reads the ad blocker environment switches', function () {
  assert.equal(adBlocker.isAdBlockEnabledByEnv({}), true);
  assert.equal(adBlocker.isAdBlockEnabledByEnv({ JABLE_DESKTOP_AD_BLOCK: '0' }), false);
  assert.equal(adBlocker.isAdBlockEnabledByEnv({ JABLE_DESKTOP_AD_BLOCK: 'false' }), false);
  assert.equal(adBlocker.isAdBlockEnabledByEnv({ JABLE_DESKTOP_AD_BLOCK: 'off' }), false);
  assert.equal(adBlocker.isAdBlockEnabledByEnv({ JABLE_DESKTOP_AD_BLOCK: 'yes' }), true);

  assert.equal(adBlocker.isAdBlockDebugEnabledByEnv({}), false);
  assert.equal(adBlocker.isAdBlockDebugEnabledByEnv({ JABLE_DESKTOP_AD_BLOCK_DEBUG: '1' }), true);
  assert.equal(adBlocker.isAdBlockDebugEnabledByEnv({ JABLE_DESKTOP_AD_BLOCK_DEBUG: 'true' }), true);
});

test('installs one centralized Electron webRequest listener', function () {
  let capturedFilter = null;
  let capturedListener = null;
  const logs = [];
  const fakeSession = {
    webRequest: {
      onBeforeRequest(filter, listener) {
        capturedFilter = filter;
        capturedListener = listener;
      }
    }
  };

  const result = adBlocker.installJableAdBlocker(fakeSession, {
    debug: true,
    logger: {
      info() {
        logs.push(Array.from(arguments));
      }
    }
  });

  assert.equal(result.enabled, true);
  assert.deepEqual(capturedFilter, { urls: adBlocker.BLOCKED_AD_URL_PATTERNS });
  assert.equal(typeof capturedListener, 'function');

  capturedListener(
    {
      url: 'https://a.magsrv.com/nativeads-v2.js',
      resourceType: 'script'
    },
    function (response) {
      assert.deepEqual(response, { cancel: true });
    }
  );
  capturedListener(
    {
      url: 'https://jable.tv/videos/example/',
      resourceType: 'mainFrame'
    },
    function (response) {
      assert.deepEqual(response, {});
    }
  );

  assert.equal(logs.length, 1);
});

test('does not attach a webRequest listener when disabled', function () {
  let listenerAttached = false;
  const fakeSession = {
    webRequest: {
      onBeforeRequest() {
        listenerAttached = true;
      }
    }
  };

  const result = adBlocker.installJableAdBlocker(fakeSession, { enabled: false });

  assert.equal(result.enabled, false);
  assert.equal(listenerAttached, false);
});
