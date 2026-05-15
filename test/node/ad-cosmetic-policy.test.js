'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const adBlocker = require('../../app/runtime-dist/ad-blocker');
const adCosmeticPolicy = require('../../app/runtime-dist/ad-cosmetic-policy');

async function createDocument(html) {
  const happyDom = await import('happy-dom');
  const window = new happyDom.Window({ url: 'https://jable.tv/videos/example/' });
  window.document.body.innerHTML = html;
  return window.document;
}

test('removes the full video grid column for known ad cards', async function () {
  const document = await createDocument(`
    <div class="row">
      <div id="ad-card" class="col-6 col-sm-4 col-lg-12">
        <div class="video-img-box mb-e-20">
          <div class="img-box cover-md">
            <a target="_blank" href="https://t.fluxtrck.site/c1/9432b3b0-661c-4d05-9552-29757dafc4cb?cv1=%7Bbanner%7D">
              <img src="https://assets-cdn.jable.tv/assets/images/252/427-240-3.gif">
            </a>
          </div>
          <div class="detail">ad text</div>
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

  const removed = adCosmeticPolicy.removeCosmeticAds(document, adBlocker.shouldBlockAdNavigation);

  assert.equal(removed, 1);
  assert.equal(document.querySelector('#ad-card'), null);
  assert.notEqual(document.querySelector('#real-card'), null);
});

test('removes sponsor text rows for known external sponsor links', async function () {
  const document = await createDocument(`
    <div id="sponsor-row" class="text-center">
      <a class="text-sponsor" target="_blank" href="https://s.zline0.com/v1/d.php?z=4789176">Sponsor</a>
    </div>
    <div id="content-row" class="text-center">
      <a href="/videos/real-video/">Real link</a>
    </div>
  `);

  const removed = adCosmeticPolicy.removeCosmeticAds(document, adBlocker.shouldBlockAdNavigation);

  assert.equal(removed, 1);
  assert.equal(document.querySelector('#sponsor-row'), null);
  assert.notEqual(document.querySelector('#content-row'), null);
});

test('removes modal wrappers when their media comes from known ad hosts', async function () {
  const document = await createDocument(`
    <div id="ad-modal" class="modelWrapper--hcpk7">
      <div class="layoutWrapper--zyz7H">
        <a href="https://go.bluetrafficstream.com/?seenLanding=1" target="_blank">
          <img src="https://img.doppiocdn.com/thumbs/1778850764/208569547">
        </a>
      </div>
    </div>
    <main id="page-content"></main>
  `);

  const removed = adCosmeticPolicy.removeCosmeticAds(document, adBlocker.shouldBlockAdNavigation);

  assert.equal(removed, 1);
  assert.equal(document.querySelector('#ad-modal'), null);
  assert.notEqual(document.querySelector('#page-content'), null);
});

test('removes fullscreen ad iframes left behind after request blocking', async function () {
  const document = await createDocument(`
    <iframe
      id="ad-iframe"
      src="https://go.xlivrdr.com/smartpop/ebdeebd?p1=3730011"
      style="width: 100vw; height: 100vh;"
    ></iframe>
    <iframe id="real-iframe" src="https://jable.tv/embed/player"></iframe>
  `);

  const removed = adCosmeticPolicy.removeCosmeticAds(document, adBlocker.shouldBlockAdNavigation);

  assert.equal(removed, 1);
  assert.equal(document.querySelector('#ad-iframe'), null);
  assert.notEqual(document.querySelector('#real-iframe'), null);
});
