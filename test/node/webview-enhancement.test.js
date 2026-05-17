'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const webViewEnhancement = require('../../app/runtime-dist/browser/webview-enhancement');

test('suppresses configured remote request hosts', function () {
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://a.labadena.com/api/spots/220808?p=1&s1=%subid1%&kw=',
      resourceType: 'xhr'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://static.adxadserv.com/js/adb.js',
      resourceType: 'script'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://ads.adxadserv.com/api/v1/popunder?zone=example',
      resourceType: 'xhr'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://cdn.tapioni.com/asg_embed.js',
      resourceType: 'script'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://go.mnaspm.com/smartpop/example?width=330px',
      resourceType: 'script'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://a.magsrv.com/nativeads-v2.js',
      resourceType: 'script'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://t.fluxtrck.site/c1/9432b3b0-661c-4d05-9552-29757dafc4cb?cv1=%7Bbanner%7D',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://s.zline0.com/v1/d.php?z=4789176',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://go.bluetrafficstream.com/?realDomain=creative.bluetrafficstream.example&seenLanding=1',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://go.xlivrdr.com/smartpop/ebdeebd?seenLanding=1&p1=3730011',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://creative.xlivrdr.com/LPOmega?action=sbSignupwithModel&campaignId=example',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://creative.xxxvjmp.com/LPOmega?action=sbSignupwithModel',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://pxl-eu.tsyndicate.com/api/v1/p/p.gif?p=example',
      resourceType: 'image'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://r.trackwilltrk.com/click?campaign=example',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://s.magsrv.com/v1/vast.php?zone=example',
      resourceType: 'xhr'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://t.nettrck.store/click?campaign=example',
      resourceType: 'subFrame'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://img.doppiocdn.com/thumbs/1778850764/208569547',
      resourceType: 'image'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://z6v2p9a8.bkcdn.net/library/952500/5047446.mp4',
      resourceType: 'media'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://assets-cdn.jable.tv/assets/images/252/427-240-3.gif',
      resourceType: 'image'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://assetscdn.jable.tv/assets/images/uu/uhyg6-760x70.gif',
      resourceType: 'image'
    }),
    true
  );
});

test('suppresses the configured Google SDK without suppressing unrelated Google APIs', function () {
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://imasdk.googleapis.com/js/sdkloader/ima3.js',
      resourceType: 'script'
    }),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://imasdk.googleapis.com/other/library.js',
      resourceType: 'script'
    }),
    false
  );
});

test('keeps Jable main pages, blob media URLs, and analytics in the first rule set', function () {
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://jable.tv/videos/example/',
      resourceType: 'mainFrame'
    }),
    false
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'blob:https://jable.tv/47ca347e-6160-4772-b55f-b3351a00b91a',
      resourceType: 'media'
    }),
    false
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://www.googletagmanager.com/gtag/js?id=G-1DTX7D4FHE',
      resourceType: 'script'
    }),
    false
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://assetscdn.jable.tv/assets/images/logo.png',
      resourceType: 'image'
    }),
    false
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewRequest({
      url: 'https://assets-cdn.jable.tv/assets/images/logo.png',
      resourceType: 'image'
    }),
    false
  );
});

test('suppresses configured navigations before creating app tabs', function () {
  assert.equal(webViewEnhancement.shouldSuppressWebViewNavigation('https://go.mnaspm.com/smartpop/example'), true);
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewNavigation('https://t.fluxtrck.site/c1/example?cv1=%7Bbanner%7D'),
    true
  );
  assert.equal(webViewEnhancement.shouldSuppressWebViewNavigation('https://s.zline0.com/v1/d.php?z=4789176'), true);
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewNavigation('https://go.bluetrafficstream.com/?seenLanding=1'),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewNavigation('https://go.xlivrdr.com/smartpop/ebdeebd?p1=3730011'),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewNavigation('https://creative.xlivrdr.com/LPOmega?action=sbSignupwithModel'),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewNavigation('https://creative.xxxvjmp.com/LPOmega?action=sbSignupwithModel'),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewNavigation('https://r.trackwilltrk.com/click?campaign=example'),
    true
  );
  assert.equal(
    webViewEnhancement.shouldSuppressWebViewNavigation('https://t.nettrck.store/click?campaign=example'),
    true
  );
  assert.equal(webViewEnhancement.shouldSuppressWebViewNavigation('https://jable.tv/videos/example/'), false);
  assert.equal(webViewEnhancement.shouldSuppressWebViewNavigation('blob:https://jable.tv/example'), false);
});

test('reads the WebView enhancement debug environment switch', function () {
  assert.equal(webViewEnhancement.isWebViewEnhancementDebugEnabledByEnv({}), false);
  assert.equal(
    webViewEnhancement.isWebViewEnhancementDebugEnabledByEnv({ JABLE_DESKTOP_WEBVIEW_ENHANCEMENT_DEBUG: '1' }),
    true
  );
  assert.equal(
    webViewEnhancement.isWebViewEnhancementDebugEnabledByEnv({ JABLE_DESKTOP_WEBVIEW_ENHANCEMENT_DEBUG: 'true' }),
    true
  );
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

  const result = webViewEnhancement.installJableWebViewEnhancement(fakeSession, {
    enabled: true,
    debug: true,
    logger: {
      info() {
        logs.push(Array.from(arguments));
      }
    }
  });

  assert.equal(result.installed, true);
  assert.deepEqual(capturedFilter, { urls: webViewEnhancement.SUPPRESSED_REMOTE_URL_PATTERNS });
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

  const result = webViewEnhancement.installJableWebViewEnhancement(fakeSession, { enabled: false });

  assert.equal(result.installed, false);
  assert.equal(listenerAttached, false);
});

test('does not attach a webRequest listener by default without an enabled setting', function () {
  let listenerAttached = false;
  const fakeSession = {
    webRequest: {
      onBeforeRequest() {
        listenerAttached = true;
      }
    }
  };

  const result = webViewEnhancement.installJableWebViewEnhancement(fakeSession);

  assert.equal(result.installed, false);
  assert.equal(listenerAttached, false);
});

test('uses the current enabled callback when handling requests', function () {
  let capturedListener = null;
  let enabled = false;
  const fakeSession = {
    webRequest: {
      onBeforeRequest(_filter, listener) {
        capturedListener = listener;
      }
    }
  };

  const result = webViewEnhancement.installJableWebViewEnhancement(fakeSession, {
    enabled: function () {
      return enabled;
    }
  });

  assert.equal(result.installed, true);
  assert.equal(typeof capturedListener, 'function');

  capturedListener(
    {
      url: 'https://a.magsrv.com/nativeads-v2.js',
      resourceType: 'script'
    },
    function (response) {
      assert.deepEqual(response, {});
    }
  );

  enabled = true;
  capturedListener(
    {
      url: 'https://a.magsrv.com/nativeads-v2.js',
      resourceType: 'script'
    },
    function (response) {
      assert.deepEqual(response, { cancel: true });
    }
  );
});
