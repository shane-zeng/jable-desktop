import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHlsPlaybackController } from '../../app/browser/webview-preload/hls-playback';

const VIDEO_URL = 'https://jable.tv/videos/hls-playback/';

function trustedMouseEvent(type: string, button = 0): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, button: button });
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

function createHarness() {
  const send = vi.fn();
  const controller = createHlsPlaybackController({
    cleanVideoTitle: function () {
      return null;
    },
    currentVideoUrl: function () {
      return VIDEO_URL;
    },
    ipcRenderer: {
      invoke: vi.fn(),
      send: send
    },
    isEditableUserGestureTarget: function () {
      return false;
    },
    mainVideoElement: function () {
      return document.querySelector('video');
    },
    readCurrentLocalPlaybackSourcePageNotice: function () {
      return {
        sourcePageChineseSubtitleNotice: false,
        sourcePageSubtitleNoticeText: null
      };
    },
    readCurrentVideoDetails: function () {
      return null;
    }
  });

  return {
    controller: controller,
    send: send
  };
}

describe('webview HLS playback observer', function () {
  beforeEach(function () {
    document.body.innerHTML =
      '<main id="player"><button type="button">Play</button><video></video></main>' +
      '<aside><div class="video-container"><a href="/videos/recommended/">Recommended</a></div></aside>';
  });

  afterEach(function () {
    document.body.innerHTML = '';
  });

  it('does not treat script-dispatched page events as playback user gestures', function () {
    const harness = createHarness();
    harness.controller.installPlaybackStartedObserver();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.querySelector('video')?.dispatchEvent(new Event('play', { bubbles: true }));

    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.send.mock.calls[0][1]).toMatchObject({
      videoUrl: VIDEO_URL,
      userInitiatedPlayback: false
    });
  });

  it('reports trusted playback gestures and can upgrade a prior script-started play event', function () {
    const harness = createHarness();
    harness.controller.installPlaybackStartedObserver();
    const video = document.querySelector('video');
    const button = document.querySelector('button');

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    video?.dispatchEvent(new Event('play', { bubbles: true }));

    button?.dispatchEvent(trustedMouseEvent('pointerdown'));
    video?.dispatchEvent(new Event('playing', { bubbles: true }));

    expect(harness.send).toHaveBeenCalledTimes(2);
    expect(harness.send.mock.calls[0][1]).toMatchObject({
      userInitiatedPlayback: false
    });
    expect(harness.send.mock.calls[1][1]).toMatchObject({
      videoUrl: VIDEO_URL,
      userInitiatedPlayback: true
    });
  });

  it('does not treat trusted recommendation link clicks as playback gestures', function () {
    const harness = createHarness();
    harness.controller.installPlaybackStartedObserver();
    const video = document.querySelector('video');
    const recommendation = document.querySelector('aside a');

    recommendation?.dispatchEvent(trustedMouseEvent('pointerdown'));
    video?.dispatchEvent(new Event('play', { bubbles: true }));

    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.send.mock.calls[0][1]).toMatchObject({
      videoUrl: VIDEO_URL,
      userInitiatedPlayback: false
    });
  });

  it('does not treat middle-clicks as playback gestures', function () {
    const harness = createHarness();
    harness.controller.installPlaybackStartedObserver();
    const video = document.querySelector('video');
    const button = document.querySelector('button');

    button?.dispatchEvent(trustedMouseEvent('pointerdown', 1));
    video?.dispatchEvent(new Event('play', { bubbles: true }));

    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.send.mock.calls[0][1]).toMatchObject({
      videoUrl: VIDEO_URL,
      userInitiatedPlayback: false
    });
  });
});
