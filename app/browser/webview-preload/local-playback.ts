'use strict';

import type { LocalPlaybackSourceResult } from '../../types/jable';

type LocalPlaybackIpc = {
  invoke(channel: 'download:local-playback-source', payload: unknown): Promise<LocalPlaybackSourceResult>;
  on(channel: 'downloads-changed', listener: (_event: unknown, records: unknown) => void): void;
};

type LocalPlaybackSourceSnapshot = {
  element: HTMLSourceElement;
  hadSrc: boolean;
  src: string;
  hadType: boolean;
  type: string;
};

type LocalPlaybackRestoreState = {
  hadSrc: boolean;
  src: string;
  sources: LocalPlaybackSourceSnapshot[];
};

type LocalPlaybackErrorHandler = (event: Event) => void;

type LocalPlaybackPreviewCue = {
  start: number;
  end: number;
  imageUrl: string;
};

type LocalPlaybackPreviewController = {
  dispose(): void;
};

type LocalPlaybackSourcePageNotice = {
  sourcePageChineseSubtitleNotice: boolean;
  sourcePageSubtitleNoticeText: string | null;
};

type DownloadRecordStateSnapshot = {
  videoUrl: string;
  state: string;
};

type LocalPlaybackControllerOptions = {
  absUrl(href: string, base?: string): string;
  currentVideoUrl(): string | null;
  ipcRenderer: LocalPlaybackIpc;
  mainVideoElement(): HTMLVideoElement | null;
  readCurrentLocalPlaybackSourcePageNotice(): LocalPlaybackSourcePageNotice;
};

type LocalPlaybackController = {
  install(): void;
};

const LOCAL_PLAYBACK_SCAN_DELAY_MS = 120;
const LOCAL_PLAYBACK_PREVIEW_WIDTH = 213;
const LOCAL_PLAYBACK_PREVIEW_HEIGHT = 120;

export function createLocalPlaybackController(options: LocalPlaybackControllerOptions): LocalPlaybackController {
  let requestSequence = 0;
  let activeVideoUrl: string | null = null;
  let activeSourceUrl: string | null = null;
  let activeThumbnailVttUrl: string | null = null;
  let activeSourcePageChineseSubtitleNotice: boolean | null = null;
  let activePreviewRefreshInFlight = false;
  let pageReloadScheduled = false;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  const failedSources: Record<string, boolean> = {};
  const failedVideoUrls: Record<string, boolean> = {};
  const restoreStates = new WeakMap<HTMLVideoElement, LocalPlaybackRestoreState>();
  const errorHandlers = new WeakMap<HTMLVideoElement, LocalPlaybackErrorHandler>();
  const previewControllers = new WeakMap<HTMLVideoElement, LocalPlaybackPreviewController>();

  function localPlaybackSourceIsAvailable(
    value: LocalPlaybackSourceResult
  ): value is Extract<LocalPlaybackSourceResult, { available: true }> {
    return Boolean(value && value.available);
  }

  function installLocalPlaybackPreviewStyle() {
    if (document.getElementById('jable-local-playback-preview-style')) return;

    const style = document.createElement('style');
    style.id = 'jable-local-playback-preview-style';
    style.textContent =
      '.jable-local-playback-preview{' +
      'position:fixed;' +
      'z-index:2147483646;' +
      'width:' +
      LOCAL_PLAYBACK_PREVIEW_WIDTH +
      'px;' +
      'pointer-events:none;' +
      'opacity:0;' +
      'transform:translateX(-50%) translateY(4px);' +
      'transition:opacity .08s ease,transform .08s ease;' +
      'border:2px solid rgba(255,255,255,.9);' +
      'border-radius:6px;' +
      'overflow:hidden;' +
      'background:#111;' +
      'box-shadow:0 10px 28px rgba(0,0,0,.42);' +
      '}' +
      '.jable-local-playback-preview.active{' +
      'opacity:1;' +
      'transform:translateX(-50%) translateY(0);' +
      '}' +
      '.jable-local-playback-preview img{' +
      'display:block;' +
      'width:' +
      LOCAL_PLAYBACK_PREVIEW_WIDTH +
      'px;' +
      'height:' +
      LOCAL_PLAYBACK_PREVIEW_HEIGHT +
      'px;' +
      'object-fit:cover;' +
      '}' +
      '.jable-local-playback-preview span{' +
      'position:absolute;' +
      'right:6px;' +
      'bottom:5px;' +
      'border-radius:4px;' +
      'background:rgba(15,16,20,.78);' +
      'padding:2px 6px;' +
      'color:#fff;' +
      'font:600 12px/1.3 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      '}';
    document.documentElement.appendChild(style);
  }

  function parseVttTimestamp(value: string): number | null {
    const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const milliseconds = Number((match[4] || '').padEnd(3, '0') || '0');

    if (
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds) ||
      !Number.isFinite(milliseconds)
    ) {
      return null;
    }

    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  }

  function parseLocalPlaybackPreviewVtt(text: string, baseUrl: string): LocalPlaybackPreviewCue[] {
    const cues: LocalPlaybackPreviewCue[] = [];
    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim();
      if (!line.includes('-->')) continue;

      const parts = line.split(/\s+-->\s+/);
      if (parts.length !== 2) continue;

      const start = parseVttTimestamp(parts[0]);
      const end = parseVttTimestamp(parts[1].split(/\s+/)[0]);
      if (start === null || end === null || end <= start) continue;

      let imageLine = '';
      for (let cueIndex = index + 1; cueIndex < lines.length; cueIndex++) {
        imageLine = lines[cueIndex].trim();
        if (imageLine) break;
      }
      if (!imageLine) continue;

      cues.push({
        start: start,
        end: end,
        imageUrl: options.absUrl(imageLine, baseUrl)
      });
    }

    return cues;
  }

  function localPlaybackPreviewCueAtTime(
    cues: LocalPlaybackPreviewCue[],
    seconds: number
  ): LocalPlaybackPreviewCue | null {
    for (let index = 0; index < cues.length; index++) {
      const cue = cues[index];
      if (seconds >= cue.start && seconds < cue.end) return cue;
    }

    return cues.length ? cues[cues.length - 1] : null;
  }

  function formatLocalPlaybackPreviewTime(seconds: number): string {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainingSeconds = wholeSeconds % 60;

    if (hours > 0) {
      return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(remainingSeconds).padStart(2, '0');
    }

    return minutes + ':' + String(remainingSeconds).padStart(2, '0');
  }

  function createLocalPlaybackPreviewController(
    video: HTMLVideoElement,
    cues: LocalPlaybackPreviewCue[]
  ): LocalPlaybackPreviewController {
    installLocalPlaybackPreviewStyle();

    const overlay = document.createElement('div');
    overlay.className = 'jable-local-playback-preview';
    const image = document.createElement('img');
    image.alt = '';
    image.decoding = 'async';
    const time = document.createElement('span');
    overlay.appendChild(image);
    overlay.appendChild(time);
    (document.body || document.documentElement).appendChild(overlay);

    function hide() {
      overlay.classList.remove('active');
    }

    function showForPointer(event: PointerEvent) {
      const rect = video.getBoundingClientRect();
      const duration = video.duration;
      if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(duration) || duration <= 0) {
        hide();
        return;
      }

      const controlBandHeight = Math.min(110, Math.max(56, rect.height * 0.22));
      const inVideoX = event.clientX >= rect.left && event.clientX <= rect.right;
      const inControlBand = event.clientY >= rect.bottom - controlBandHeight && event.clientY <= rect.bottom;
      if (!inVideoX || !inControlBand) {
        hide();
        return;
      }

      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const previewTime = Math.min(duration, Math.max(0, ratio * duration));
      const cue = localPlaybackPreviewCueAtTime(cues, previewTime);
      if (!cue) {
        hide();
        return;
      }

      if (image.getAttribute('src') !== cue.imageUrl) image.setAttribute('src', cue.imageUrl);
      time.textContent = formatLocalPlaybackPreviewTime(previewTime);

      const halfWidth = LOCAL_PLAYBACK_PREVIEW_WIDTH / 2;
      const edgeMargin = 8;
      const left = Math.min(
        window.innerWidth - halfWidth - edgeMargin,
        Math.max(halfWidth + edgeMargin, event.clientX)
      );
      const top = Math.max(edgeMargin, rect.bottom - controlBandHeight - LOCAL_PLAYBACK_PREVIEW_HEIGHT - 16);
      overlay.style.left = left + 'px';
      overlay.style.top = top + 'px';
      overlay.classList.add('active');
    }

    function hideOnVisibilityChange() {
      if (document.hidden) hide();
    }

    document.addEventListener('pointermove', showForPointer, true);
    document.addEventListener('pointerleave', hide, true);
    document.addEventListener('visibilitychange', hideOnVisibilityChange);
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    return {
      dispose: function () {
        document.removeEventListener('pointermove', showForPointer, true);
        document.removeEventListener('pointerleave', hide, true);
        document.removeEventListener('visibilitychange', hideOnVisibilityChange);
        window.removeEventListener('blur', hide);
        window.removeEventListener('scroll', hide, true);
        window.removeEventListener('resize', hide);
        overlay.remove();
      }
    };
  }

  function removeLocalPlaybackPreview(video: HTMLVideoElement) {
    const controller = previewControllers.get(video);
    if (!controller) return;

    controller.dispose();
    previewControllers.delete(video);
  }

  async function installLocalPlaybackPreview(video: HTMLVideoElement, thumbnailVttUrl: string | null) {
    removeLocalPlaybackPreview(video);
    if (!thumbnailVttUrl) return;

    const sourceUrl = video.dataset.jableLocalPlaybackSource || '';
    let text: string;
    try {
      const response = await fetch(thumbnailVttUrl);
      if (!response.ok) return;
      text = await response.text();
    } catch (error) {
      return;
    }

    if (video.dataset.jableLocalPlaybackSource !== sourceUrl || !document.documentElement.contains(video)) return;

    const cues = parseLocalPlaybackPreviewVtt(text, thumbnailVttUrl);
    if (!cues.length) return;

    previewControllers.set(video, createLocalPlaybackPreviewController(video, cues));
  }

  function downloadRecordStateSnapshots(value: unknown): DownloadRecordStateSnapshot[] {
    if (!Array.isArray(value)) return [];

    const records: DownloadRecordStateSnapshot[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;

      const record = item as { videoUrl?: unknown; state?: unknown };
      if (typeof record.videoUrl !== 'string' || typeof record.state !== 'string') continue;

      records.push({
        videoUrl: record.videoUrl,
        state: record.state
      });
    }

    return records;
  }

  function downloadRecordStateForVideo(records: DownloadRecordStateSnapshot[], videoUrl: string): string | null {
    const snapshots = records;
    for (const record of snapshots) {
      if (record.videoUrl === videoUrl) return record.state;
    }

    return null;
  }

  async function refreshActiveLocalPlaybackPreview() {
    if (activePreviewRefreshInFlight) return;
    if (!activeVideoUrl || !activeSourceUrl || activeThumbnailVttUrl) return;

    const videoUrl = activeVideoUrl;
    const sourceUrl = activeSourceUrl;
    const sourcePageChineseSubtitleNotice = activeSourcePageChineseSubtitleNotice;
    activePreviewRefreshInFlight = true;

    try {
      const result = await options.ipcRenderer.invoke('download:local-playback-source', {
        videoUrl: videoUrl,
        sourcePageChineseSubtitleNotice: sourcePageChineseSubtitleNotice
      });
      if (!localPlaybackSourceIsAvailable(result) || !result.thumbnailVttUrl) return;
      if (activeVideoUrl !== videoUrl || activeSourceUrl !== sourceUrl) return;

      const video = options.mainVideoElement();
      if (!video || video.dataset.jableLocalPlaybackSource !== sourceUrl) return;

      activeThumbnailVttUrl = result.thumbnailVttUrl;
      await installLocalPlaybackPreview(video, result.thumbnailVttUrl);
    } catch (error) {
    } finally {
      activePreviewRefreshInFlight = false;
    }
  }

  function snapshotLocalPlaybackSource(source: HTMLSourceElement): LocalPlaybackSourceSnapshot {
    return {
      element: source,
      hadSrc: source.hasAttribute('src'),
      src: source.getAttribute('src') || '',
      hadType: source.hasAttribute('type'),
      type: source.getAttribute('type') || ''
    };
  }

  function ensureLocalPlaybackRestoreState(video: HTMLVideoElement) {
    if (restoreStates.has(video)) return;

    const sources = Array.from(video.querySelectorAll<HTMLSourceElement>('source')).map(snapshotLocalPlaybackSource);
    restoreStates.set(video, {
      hadSrc: video.hasAttribute('src'),
      src: video.getAttribute('src') || '',
      sources: sources
    });
  }

  function restoreLocalPlaybackVideo(video: HTMLVideoElement) {
    const handler = errorHandlers.get(video);
    if (handler) {
      video.removeEventListener('error', handler);
      errorHandlers.delete(video);
    }
    removeLocalPlaybackPreview(video);

    const state = restoreStates.get(video);
    if (!state) return;

    if (state.hadSrc) video.setAttribute('src', state.src);
    else video.removeAttribute('src');

    for (let i = 0; i < state.sources.length; i++) {
      const source = state.sources[i];
      if (!document.documentElement.contains(source.element)) continue;
      if (source.hadSrc) source.element.setAttribute('src', source.src);
      else source.element.removeAttribute('src');
      if (source.hadType) source.element.setAttribute('type', source.type);
      else source.element.removeAttribute('type');
    }

    delete video.dataset.jableLocalPlayback;
    delete video.dataset.jableLocalPlaybackSource;
    restoreStates.delete(video);
    activeVideoUrl = null;
    activeSourceUrl = null;
    activeThumbnailVttUrl = null;
    activeSourcePageChineseSubtitleNotice = null;

    try {
      video.load();
    } catch (error) {}
  }

  function restoreLocalPlaybackVideos() {
    const videos = document.querySelectorAll<HTMLVideoElement>('video[data-jable-local-playback="true"]');
    for (let i = 0; i < videos.length; i++) {
      restoreLocalPlaybackVideo(videos[i]);
    }
  }

  function reloadAfterActiveLocalPlaybackRemoved(videoUrl: string): boolean {
    const videos = document.querySelectorAll<HTMLVideoElement>('video[data-jable-local-playback="true"]');
    if (!videos.length) return false;

    failedVideoUrls[videoUrl] = true;
    if (pageReloadScheduled) return true;

    pageReloadScheduled = true;
    setTimeout(function () {
      window.location.reload();
    }, 0);
    return true;
  }

  function handleLocalPlaybackUnavailable(videoUrl: string) {
    if (reloadAfterActiveLocalPlaybackRemoved(videoUrl)) return;
    restoreLocalPlaybackVideos();
  }

  function markLocalPlaybackFailed(video: HTMLVideoElement) {
    const sourceUrl = video.dataset.jableLocalPlaybackSource || '';
    const videoUrl = activeVideoUrl || options.currentVideoUrl();
    if (sourceUrl) failedSources[sourceUrl] = true;
    if (videoUrl) failedVideoUrls[videoUrl] = true;
    restoreLocalPlaybackVideo(video);
  }

  function restoreLocalPlaybackTimeline(
    video: HTMLVideoElement,
    resumeTime: number,
    playbackRate: number,
    wasPlaying: boolean
  ) {
    let restored = false;
    const targetTime = Number.isFinite(resumeTime) && resumeTime > 0 ? resumeTime : 0;
    const targetRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;

    const restore = function () {
      if (restored) return;

      try {
        video.playbackRate = targetRate;
      } catch (error) {}

      if (targetTime > 0) {
        if (video.readyState < 1) return;

        try {
          const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
          video.currentTime = duration ? Math.min(targetTime, Math.max(0, duration - 0.25)) : targetTime;
        } catch (error) {
          return;
        }
      }

      restored = true;
      if (wasPlaying) {
        video.play().catch(function () {});
      }
    };

    video.addEventListener('loadedmetadata', restore, { once: true });
    video.addEventListener('canplay', restore, { once: true });
    setTimeout(restore, 0);
    setTimeout(restore, 600);
  }

  function setLocalPlaybackSource(
    video: HTMLVideoElement,
    videoUrl: string,
    sourceUrl: string,
    thumbnailVttUrl: string | null,
    sourcePageNotice: LocalPlaybackSourcePageNotice
  ) {
    if (video.dataset.jableLocalPlaybackSource === sourceUrl) return;

    const oldHandler = errorHandlers.get(video);
    if (oldHandler) video.removeEventListener('error', oldHandler);
    removeLocalPlaybackPreview(video);

    ensureLocalPlaybackRestoreState(video);

    const wasPlaying = !video.paused && !video.ended;
    const resumeTime = Number.isFinite(video.currentTime) && video.currentTime > 0 ? video.currentTime : 0;
    const playbackRate = Number.isFinite(video.playbackRate) ? video.playbackRate : 1;
    const sources = video.querySelectorAll<HTMLSourceElement>('source');
    for (let i = 0; i < sources.length; i++) {
      sources[i].setAttribute('src', sourceUrl);
      sources[i].setAttribute('type', 'video/mp4');
    }
    video.setAttribute('src', sourceUrl);
    video.dataset.jableLocalPlayback = 'true';
    video.dataset.jableLocalPlaybackSource = sourceUrl;
    activeVideoUrl = videoUrl;
    activeSourceUrl = sourceUrl;
    activeThumbnailVttUrl = thumbnailVttUrl;
    activeSourcePageChineseSubtitleNotice = sourcePageNotice.sourcePageChineseSubtitleNotice;

    const handler = function () {
      markLocalPlaybackFailed(video);
    };
    errorHandlers.set(video, handler);
    video.addEventListener('error', handler, { once: true });

    restoreLocalPlaybackTimeline(video, resumeTime, playbackRate, wasPlaying);

    try {
      video.load();
    } catch (error) {}

    void installLocalPlaybackPreview(video, thumbnailVttUrl);
  }

  async function applyLocalPlaybackSource() {
    scanTimer = null;
    const videoUrl = options.currentVideoUrl();
    const sequence = ++requestSequence;

    if (!videoUrl) {
      restoreLocalPlaybackVideos();
      return;
    }
    if (failedVideoUrls[videoUrl]) return;

    const sourcePageNotice = options.readCurrentLocalPlaybackSourcePageNotice();
    if (
      activeVideoUrl === videoUrl &&
      activeSourceUrl &&
      activeSourcePageChineseSubtitleNotice === sourcePageNotice.sourcePageChineseSubtitleNotice &&
      !failedSources[activeSourceUrl]
    ) {
      const activeVideo = options.mainVideoElement();
      if (activeVideo) {
        setLocalPlaybackSource(activeVideo, videoUrl, activeSourceUrl, activeThumbnailVttUrl, sourcePageNotice);
      }
      return;
    }

    let result: LocalPlaybackSourceResult;
    try {
      result = await options.ipcRenderer.invoke('download:local-playback-source', {
        videoUrl: videoUrl,
        sourcePageChineseSubtitleNotice: sourcePageNotice.sourcePageChineseSubtitleNotice,
        sourcePageSubtitleNoticeText: sourcePageNotice.sourcePageSubtitleNoticeText
      });
    } catch (error) {
      return;
    }

    if (sequence !== requestSequence || options.currentVideoUrl() !== videoUrl) return;

    if (!localPlaybackSourceIsAvailable(result)) {
      handleLocalPlaybackUnavailable(videoUrl);
      return;
    }

    if (failedSources[result.sourceUrl]) return;

    const video = options.mainVideoElement();
    if (!video) return;

    setLocalPlaybackSource(video, result.videoUrl, result.sourceUrl, result.thumbnailVttUrl, sourcePageNotice);
  }

  function scheduleLocalPlaybackSourceCheck() {
    if (scanTimer) return;
    scanTimer = setTimeout(applyLocalPlaybackSource, LOCAL_PLAYBACK_SCAN_DELAY_MS);
  }

  function installLocalPlaybackReplacement() {
    scheduleLocalPlaybackSourceCheck();
    document.addEventListener('DOMContentLoaded', scheduleLocalPlaybackSourceCheck, { once: true });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleLocalPlaybackSourceCheck();
    });
    window.addEventListener('focus', scheduleLocalPlaybackSourceCheck);
    window.addEventListener('pageshow', scheduleLocalPlaybackSourceCheck);
    window.addEventListener('load', scheduleLocalPlaybackSourceCheck, { once: true });
    options.ipcRenderer.on('downloads-changed', function (_event, records) {
      for (const videoUrl in failedVideoUrls) delete failedVideoUrls[videoUrl];

      if (activeVideoUrl && activeSourceUrl) {
        const state = downloadRecordStateForVideo(downloadRecordStateSnapshots(records), activeVideoUrl);
        if (Array.isArray(records) && state !== 'ready') {
          restoreLocalPlaybackVideos();
          return;
        }

        void refreshActiveLocalPlaybackPreview();
        return;
      }

      scheduleLocalPlaybackSourceCheck();
    });

    if (typeof MutationObserver === 'undefined') return;

    const target = document.documentElement || document;
    const observer = new MutationObserver(function (records) {
      for (let i = 0; i < records.length; i++) {
        if (records[i].type === 'childList' && (records[i].addedNodes.length || records[i].removedNodes.length)) {
          scheduleLocalPlaybackSourceCheck();
          return;
        }
        if (records[i].type === 'attributes') {
          scheduleLocalPlaybackSourceCheck();
          return;
        }
      }
    });
    observer.observe(target, {
      attributes: true,
      attributeFilter: ['src'],
      childList: true,
      subtree: true
    });
  }

  return {
    install: installLocalPlaybackReplacement
  };
}
