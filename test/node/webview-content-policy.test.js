'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const webViewEnhancement = require('../../app/runtime-dist/browser/webview-enhancement');
const webViewContentPolicy = require('../../app/runtime-dist/browser/webview-content-policy');

async function createDocument(html) {
  const happyDom = await import('happy-dom');
  const window = new happyDom.Window({ url: 'https://jable.tv/videos/example/' });
  window.document.body.innerHTML = html;
  return window.document;
}

test('removes the full video grid column for configured cards', async function () {
  const document = await createDocument(`
    <div class="row">
      <div id="configured-card" class="col-6 col-sm-4 col-lg-12">
        <div class="video-img-box mb-e-20">
          <div class="img-box cover-md">
            <a target="_blank" href="https://t.fluxtrck.site/c1/9432b3b0-661c-4d05-9552-29757dafc4cb?cv1=%7Bbanner%7D">
              <img src="https://assets-cdn.jable.tv/assets/images/252/427-240-3.gif">
            </a>
          </div>
          <div class="detail">remote text</div>
        </div>
      </div>
      <div id="real-card" class="col-6 col-sm-4 col-lg-12">
        <div class="video-img-box mb-e-20">
          <div class="img-box cover-md">
            <a href="/videos/real-video/">
              <img src="https://assets-cdn.jable.tv/assets/images/logo.png">
            </a>
          </div>
        </div>
      </div>
    </div>
  `);

  const removed = webViewContentPolicy.applyWebViewContentPolicy(
    document,
    webViewEnhancement.shouldSuppressWebViewNavigation
  );

  assert.equal(removed, 1);
  assert.equal(document.querySelector('#configured-card'), null);
  assert.notEqual(document.querySelector('#real-card'), null);
});

test('removes configured external text rows', async function () {
  const document = await createDocument(`
    <div id="external-text-row" class="text-center">
      <a class="text-sponsor" target="_blank" href="https://s.zline0.com/v1/d.php?z=4789176">External</a>
    </div>
    <div id="content-row" class="text-center">
      <a href="/videos/real-video/">Real link</a>
    </div>
  `);

  const removed = webViewContentPolicy.applyWebViewContentPolicy(
    document,
    webViewEnhancement.shouldSuppressWebViewNavigation
  );

  assert.equal(removed, 1);
  assert.equal(document.querySelector('#external-text-row'), null);
  assert.notEqual(document.querySelector('#content-row'), null);
});

test('keeps collection action buttons when removing a configured link from a shared detail row', async function () {
  const document = await createDocument(`
    <div id="shared-row" class="text-center">
      <a class="text-sponsor" target="_blank" href="https://s.zline0.com/v1/d.php?z=4789176">External</a>
      <style>.text-sponsor::before { content: 'x'; }</style>
      <div class="my-3">
        <button id="fav-button" data-fav-video-id="59085" data-fav-type="0" class="btn btn-action fav mr-2">
          <span class="count">106</span>
        </button>
        <button id="watch-later-button" data-fav-video-id="59085" data-fav-type="1" class="btn btn-action">
        </button>
      </div>
    </div>
  `);

  const removed = webViewContentPolicy.applyWebViewContentPolicy(
    document,
    webViewEnhancement.shouldSuppressWebViewNavigation
  );

  assert.equal(removed, 1);
  assert.notEqual(document.querySelector('#shared-row'), null);
  assert.equal(document.querySelector('#shared-row .text-sponsor'), null);
  assert.notEqual(document.querySelector('#fav-button'), null);
  assert.notEqual(document.querySelector('#watch-later-button'), null);
});

test('removes modal wrappers when their media comes from configured hosts', async function () {
  const document = await createDocument(`
    <div id="configured-modal" class="modelWrapper--hcpk7">
      <div class="layoutWrapper--zyz7H">
        <a href="https://go.bluetrafficstream.com/?seenLanding=1" target="_blank">
          <img src="https://img.doppiocdn.com/thumbs/1778850764/208569547">
        </a>
      </div>
    </div>
    <main id="page-content"></main>
  `);

  const removed = webViewContentPolicy.applyWebViewContentPolicy(
    document,
    webViewEnhancement.shouldSuppressWebViewNavigation
  );

  assert.equal(removed, 1);
  assert.equal(document.querySelector('#configured-modal'), null);
  assert.notEqual(document.querySelector('#page-content'), null);
});

test('removes fullscreen iframes left behind after request filtering', async function () {
  const document = await createDocument(`
    <iframe
      id="configured-iframe"
      src="https://go.xlivrdr.com/smartpop/ebdeebd?p1=3730011"
      style="width: 100vw; height: 100vh;"
    ></iframe>
    <iframe id="real-iframe" src="https://jable.tv/embed/player"></iframe>
  `);

  const removed = webViewContentPolicy.applyWebViewContentPolicy(
    document,
    webViewEnhancement.shouldSuppressWebViewNavigation
  );

  assert.equal(removed, 1);
  assert.equal(document.querySelector('#configured-iframe'), null);
  assert.notEqual(document.querySelector('#real-iframe'), null);
});
