'use strict';

import type { ScrapedVideoRow } from '../../types/jable';
import { absoluteUrl, inferPreviewFromImageUrl, parseMetricNumber } from '../webview-preload-helpers';

export type LocalPlaybackSourcePageNotice = {
  sourcePageChineseSubtitleNotice: boolean;
  sourcePageSubtitleNoticeText: string | null;
};

type VideoMetadataIpc = {
  invoke(channel: 'db:refresh-video-metadata', payload: unknown): Promise<unknown>;
};
type DiagnosticsReporter = (level: 'debug' | 'info' | 'warn' | 'error', event: string, details?: unknown) => void;

type VideoMetadataControllerOptions = {
  buttonHasIcon(button: Element | null, iconId: string): boolean;
  ipcRenderer: VideoMetadataIpc;
  isJablePage(): boolean;
  reportDiagnostics?: DiagnosticsReporter;
};

type VideoMetadataController = {
  cleanVideoTitle(value: unknown): string | null;
  currentVideoUrl(): string | null;
  install(): void;
  readCurrentLocalPlaybackSourcePageNotice(): LocalPlaybackSourcePageNotice;
  readCurrentVideoDetails(): ScrapedVideoRow | null;
};

const VIDEO_METADATA_REFRESH_DELAY_MS = 400;
const CHINESE_SUBTITLE_NOTICE_TOKEN = '中文字幕版';

export function createVideoMetadataController(options: VideoMetadataControllerOptions): VideoMetadataController {
  let videoMetadataRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let lastVideoMetadataRefreshSignature = '';

  function serializedError(error: unknown) {
    if (!(error instanceof Error)) {
      return {
        message: String(error)
      };
    }

    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null
    };
  }

  function currentVideoUrl() {
    if (!options.isJablePage()) return null;

    try {
      const parsed = new URL(location.href);
      if (!/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return null;
      if (!/\/$/.test(parsed.pathname)) parsed.pathname += '/';
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch (error) {
      return null;
    }
  }

  function normalizePageText(value: unknown) {
    const text = value === null || typeof value === 'undefined' ? '' : String(value);
    return text.replace(/\s+/g, ' ').trim();
  }

  function readMetaContent(selector: string) {
    const el = document.querySelector<HTMLMetaElement>(selector);
    return el ? normalizePageText(el.getAttribute('content')) : '';
  }

  function readFirstText(selectors: string[]) {
    for (let i = 0; i < selectors.length; i++) {
      const el = document.querySelector(selectors[i]);
      const text = el ? normalizePageText(el.textContent) : '';
      if (text) return text;
    }

    return '';
  }

  function readCurrentChineseSubtitleNoticeText(): string | null {
    const elements = document.querySelectorAll<HTMLElement>('h5.desc.h6-md');

    for (let i = 0; i < elements.length; i++) {
      const text = normalizePageText(elements[i].textContent);
      if (text.indexOf(CHINESE_SUBTITLE_NOTICE_TOKEN) !== -1) return text;
    }

    return null;
  }

  function readCurrentLocalPlaybackSourcePageNotice(): LocalPlaybackSourcePageNotice {
    const text = readCurrentChineseSubtitleNoticeText();
    return {
      sourcePageChineseSubtitleNotice: text !== null,
      sourcePageSubtitleNoticeText: text
    };
  }

  function cleanVideoTitle(value: unknown) {
    let text = normalizePageText(value);
    if (!text) return null;

    text = text.replace(/\s*[-|]\s*Jable\.TV\b.*$/i, '').trim();
    return text || null;
  }

  function readNumberAfterIcon(container: Element | null, iconId: string) {
    if (!container) return null;

    const svgs = container.querySelectorAll('svg');

    for (let i = 0; i < svgs.length; i++) {
      if (!options.buttonHasIcon(svgs[i], iconId)) continue;

      let node = svgs[i].nextSibling;

      while (node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const textNumber = parseMetricNumber(node.textContent);
          if (textNumber !== null) return textNumber;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const elementNumber = parseMetricNumber(node.textContent);
          if (elementNumber !== null) return elementNumber;
        }

        node = node.nextSibling;
      }
    }

    return null;
  }

  function readCurrentVideoViews() {
    return readNumberAfterIcon(document.querySelector('.video-info .info-header h6'), '#icon-eye');
  }

  function readCurrentVideoLikes() {
    const count = document.querySelector('button[data-fav-type="0"] .count, button.fav .count');
    return count ? parseMetricNumber(count.textContent) : null;
  }

  function readCurrentVideoDetails(): ScrapedVideoRow | null {
    const url = currentVideoUrl();
    if (!url) return null;

    const title =
      readMetaContent('meta[property="og:title"]') ||
      readMetaContent('meta[name="twitter:title"]') ||
      readFirstText(['.video-info .info-header h4', 'section.video-info h4', 'h1', 'h4', '.video-title', '.title']) ||
      document.title;
    const img =
      readMetaContent('meta[property="og:image"]') ||
      readMetaContent('meta[name="twitter:image"]') ||
      (document.querySelector('video[poster]') as HTMLVideoElement | null)?.poster ||
      '' ||
      '';

    return {
      title: cleanVideoTitle(title),
      url: url,
      views: readCurrentVideoViews(),
      likes: readCurrentVideoLikes(),
      img: img ? absoluteUrl(img, location.href) : null,
      preview: inferPreviewFromImageUrl(img, location.href)
    };
  }

  function videoMetadataRefreshSignature(video: ScrapedVideoRow) {
    return [
      video.url,
      video.title || '',
      video.views === null ? '' : String(video.views),
      video.likes === null ? '' : String(video.likes),
      video.img || '',
      video.preview || ''
    ].join('\n');
  }

  async function refreshCurrentVideoMetadata() {
    videoMetadataRefreshTimer = null;
    const video = readCurrentVideoDetails();
    if (!video) return;

    const metadataSignature = videoMetadataRefreshSignature(video);
    if (metadataSignature === lastVideoMetadataRefreshSignature) return;
    lastVideoMetadataRefreshSignature = metadataSignature;

    try {
      await options.ipcRenderer.invoke('db:refresh-video-metadata', video);
    } catch (error) {
      if (options.reportDiagnostics) {
        options.reportDiagnostics('warn', 'video-metadata-refresh-failed', {
          error: serializedError(error),
          videoUrl: video.url
        });
      }
      console.warn('[JableDesktopScraper] video metadata refresh failed', error);
    }
  }

  function scheduleCurrentVideoMetadataRefresh() {
    if (!currentVideoUrl()) return;
    if (videoMetadataRefreshTimer) clearTimeout(videoMetadataRefreshTimer);
    videoMetadataRefreshTimer = setTimeout(refreshCurrentVideoMetadata, VIDEO_METADATA_REFRESH_DELAY_MS);
  }

  function installVideoMetadataRefresh() {
    scheduleCurrentVideoMetadataRefresh();
    document.addEventListener('DOMContentLoaded', scheduleCurrentVideoMetadataRefresh, { once: true });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleCurrentVideoMetadataRefresh();
    });
    window.addEventListener('focus', scheduleCurrentVideoMetadataRefresh);
    window.addEventListener('pageshow', scheduleCurrentVideoMetadataRefresh);
    window.addEventListener('load', scheduleCurrentVideoMetadataRefresh, { once: true });

    if (typeof MutationObserver === 'undefined') return;

    const target = document.documentElement || document;
    const observer = new MutationObserver(function (records) {
      for (let i = 0; i < records.length; i++) {
        if (records[i].type === 'childList' && (records[i].addedNodes.length || records[i].removedNodes.length)) {
          scheduleCurrentVideoMetadataRefresh();
          return;
        }
      }
    });
    observer.observe(target, {
      childList: true,
      subtree: true
    });
  }

  return {
    cleanVideoTitle: cleanVideoTitle,
    currentVideoUrl: currentVideoUrl,
    install: installVideoMetadataRefresh,
    readCurrentLocalPlaybackSourcePageNotice: readCurrentLocalPlaybackSourcePageNotice,
    readCurrentVideoDetails: readCurrentVideoDetails
  };
}
