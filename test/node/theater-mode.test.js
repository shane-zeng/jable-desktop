'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const theaterMode = require('../../app/runtime-dist/browser/webview-preload/theater-mode.js');

async function withWindow(html, run) {
  const happyDom = await import('happy-dom');
  const window = new happyDom.Window({ url: 'https://jable.tv/videos/example/' });
  const previous = {
    document: global.document,
    Element: global.Element,
    Event: global.Event,
    HTMLElement: global.HTMLElement,
    HTMLVideoElement: global.HTMLVideoElement,
    MouseEvent: global.MouseEvent,
    MutationObserver: global.MutationObserver,
    Node: global.Node,
    window: global.window
  };

  window.document.body.innerHTML = html;

  global.document = window.document;
  global.Element = window.Element;
  global.Event = window.Event;
  global.HTMLElement = window.HTMLElement;
  global.HTMLVideoElement = window.HTMLVideoElement;
  global.MouseEvent = window.MouseEvent;
  global.MutationObserver = window.MutationObserver;
  global.Node = window.Node;
  global.window = window;

  try {
    return await run(window);
  } finally {
    Object.keys(previous).forEach(function (key) {
      if (typeof previous[key] === 'undefined') delete global[key];
      else global[key] = previous[key];
    });
  }
}

test('theater mode injects a localized mouse exit button that leaves theater mode', async function () {
  await withWindow(
    `
      <main id="player" class="video-js">
        <video controls></video>
        <div class="vjs-control-bar"></div>
      </main>
    `,
    function (window) {
      const changes = [];
      const controller = theaterMode.createTheaterModeController({
        currentVideoUrl: function () {
          return 'https://jable.tv/videos/example/';
        },
        mainVideoElement: function () {
          return window.document.querySelector('video');
        },
        sendChanged: function (result) {
          changes.push(result);
        }
      });

      const result = controller.set(true, true, '離開劇院模式');
      const player = window.document.getElementById('player');
      const exitButton = window.document.getElementById('jable-desktop-theater-exit');

      assert.equal(result.applied, true);
      assert.equal(player.classList.contains('jable-desktop-theater-target'), true);
      assert.ok(exitButton);
      assert.equal(exitButton.getAttribute('aria-label'), '離開劇院模式');
      assert.equal(exitButton.getAttribute('aria-keyshortcuts'), 'Escape');

      exitButton.click();

      assert.deepEqual(changes, [
        {
          enabled: false,
          applied: false,
          videoUrl: 'https://jable.tv/videos/example/',
          reason: 'disabled'
        }
      ]);
      assert.equal(player.classList.contains('jable-desktop-theater-target'), false);
      assert.equal(window.document.getElementById('jable-desktop-theater-exit'), null);
    }
  );
});
