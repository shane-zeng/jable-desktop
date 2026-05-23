import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalPlaybackController } from '../../app/browser/webview-preload/local-playback';
import type { LocalPlaybackSourceResult, LocalPlaybackUnavailableReason } from '../../app/types/jable';

const VIDEO_URL = 'https://jable.tv/videos/local-playback/';
const LOCAL_SOURCE_URL = 'jable-local-video://play/local-token.mp4';

function localPlaybackResult(): LocalPlaybackSourceResult {
  return {
    available: true,
    videoUrl: VIDEO_URL,
    sourceUrl: LOCAL_SOURCE_URL,
    thumbnailVttUrl: null,
    title: 'Local Playback',
    fileSizeBytes: 1024
  };
}

function unavailableResult(reason: LocalPlaybackUnavailableReason): LocalPlaybackSourceResult {
  return {
    available: false,
    videoUrl: VIDEO_URL,
    reason: reason
  };
}

function createHarness(results: LocalPlaybackSourceResult[]) {
  const listeners: Array<(_event: unknown, records: unknown) => void> = [];
  const reloadPage = vi.fn();
  const invoke = vi.fn(function () {
    const result = results.shift();
    if (!result) throw new Error('Unexpected local playback source request');
    return Promise.resolve(result);
  });

  const controller = createLocalPlaybackController({
    absUrl: function (href: string, base?: string) {
      return new URL(href, base || window.location.href).toString();
    },
    currentVideoUrl: function () {
      return VIDEO_URL;
    },
    ipcRenderer: {
      invoke: invoke,
      on: function (_channel, listener) {
        listeners.push(listener);
      }
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
    reloadPage: reloadPage
  });

  return {
    controller: controller,
    invoke: invoke,
    listeners: listeners,
    reloadPage: reloadPage
  };
}

async function runScheduledLocalPlaybackScan() {
  await vi.advanceTimersByTimeAsync(130);
}

describe('webview local playback replacement', function () {
  beforeEach(function () {
    vi.useFakeTimers();
    document.body.innerHTML = '<video><source /></video>';
  });

  afterEach(function () {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('replaces the video source when local playback is ready during page load', async function () {
    const harness = createHarness([localPlaybackResult()]);

    harness.controller.install();
    await runScheduledLocalPlaybackScan();

    const video = document.querySelector('video');
    expect(harness.invoke).toHaveBeenCalledTimes(1);
    expect(video?.dataset.jableLocalPlayback).toBe('true');
    expect(video?.getAttribute('src')).toBe(LOCAL_SOURCE_URL);
  });

  it('does not replace later in the same page after local playback was not ready', async function () {
    const harness = createHarness([unavailableResult('not_ready'), localPlaybackResult()]);

    harness.controller.install();
    await runScheduledLocalPlaybackScan();

    const video = document.querySelector('video');
    expect(harness.invoke).toHaveBeenCalledTimes(1);
    expect(video?.dataset.jableLocalPlayback).toBeUndefined();
    expect(video?.getAttribute('src')).toBeNull();

    harness.listeners[0]?.({}, [{ videoUrl: VIDEO_URL, state: 'ready' }]);
    await runScheduledLocalPlaybackScan();
    document.body.appendChild(document.createElement('span'));
    await runScheduledLocalPlaybackScan();

    expect(harness.invoke).toHaveBeenCalledTimes(1);
    expect(video?.dataset.jableLocalPlayback).toBeUndefined();
    expect(video?.getAttribute('src')).toBeNull();
  });

  it('reloads the page when the active local playback record is removed', async function () {
    const harness = createHarness([localPlaybackResult()]);

    harness.controller.install();
    await runScheduledLocalPlaybackScan();

    const video = document.querySelector('video');
    expect(video?.dataset.jableLocalPlayback).toBe('true');

    harness.listeners[0]?.({}, []);
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.reloadPage).toHaveBeenCalledTimes(1);
    expect(video?.dataset.jableLocalPlayback).toBe('true');
    expect(video?.getAttribute('src')).toBe(LOCAL_SOURCE_URL);
  });

  it('reloads the page when the active local playback source fails', async function () {
    const harness = createHarness([localPlaybackResult()]);

    harness.controller.install();
    await runScheduledLocalPlaybackScan();

    const video = document.querySelector('video');
    expect(video?.dataset.jableLocalPlayback).toBe('true');

    video?.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.reloadPage).toHaveBeenCalledTimes(1);
    expect(video?.dataset.jableLocalPlayback).toBe('true');
    expect(video?.getAttribute('src')).toBe(LOCAL_SOURCE_URL);
  });
});
