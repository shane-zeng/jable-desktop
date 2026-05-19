'use strict';

import type * as Electron from 'electron';
import type { BrowserDiagnosis, CollectionKey, ScrapedVideoRow, SyncBrowserCollectionOptions } from './types/jable';
import type { AjaxSyncPage, AjaxSyncRetryEvent } from './browser/webview-preload-helpers';
import {
  AjaxSyncError,
  FULL_SYNC_AJAX_FETCH_TIMEOUT_MS,
  SITE_PAGE_SIZE,
  absoluteUrl,
  activePageNumberFrom,
  ajaxUrlForPagerLink,
  fetchAjaxSyncPage,
  fetchTextWithTimeout,
  lastPagerPageNumberFrom,
  normalizePageNumber,
  pagerPageNumberFromElement,
  pagerPageParameter,
  samePageUrl,
  scrapeRowsFrom as scrapeRowsFromRoot,
  scrapeVideoBox as scrapeVideoBoxFromElement,
  signatureFrom
} from './browser/webview-preload-helpers';
import { createBrowserSyncController } from './browser/webview-preload/browser-sync';
import type { BrowserSyncPagerLink } from './browser/webview-preload/browser-sync';
import { createCollectionActionController } from './browser/webview-preload/collection-actions';
import { createHlsPlaybackController } from './browser/webview-preload/hls-playback';
import { createLocalPlaybackController } from './browser/webview-preload/local-playback';
import type { TheaterModeResult } from './browser/webview-preload/theater-mode';
import {
  THEATER_MODE_EDITABLE_SHORTCUT_SELECTOR,
  createTheaterModeController
} from './browser/webview-preload/theater-mode';
import { createVideoMetadataController } from './browser/webview-preload/video-metadata';

type TrackpadHistoryDirection = 'back' | 'forward';
type SendToHostIpcRenderer = Electron.IpcRenderer & {
  sendToHost?: (channel: string, ...args: unknown[]) => void;
};
type UrlPolicyModule = {
  isTrustedJableUrl(value: unknown): boolean;
};
type WebViewEnhancementModule = {
  isWebViewEnhancementDebugEnabledByEnv(env?: Record<string, string | undefined> | null): boolean;
  shouldSuppressWebViewNavigation(value: unknown): boolean;
};
type WebViewContentPolicyModule = {
  applyWebViewContentPolicy(root: Document | Element, isSuppressedRemoteUrl: (value: unknown) => boolean): number;
};

const electron: typeof Electron = require('electron');
const ipcRenderer = electron.ipcRenderer as SendToHostIpcRenderer;
const webViewEnhancement = require('./browser/webview-enhancement') as WebViewEnhancementModule;
const webViewContentPolicy = require('./browser/webview-content-policy') as WebViewContentPolicyModule;
const urlPolicy = require('./browser/url-policy') as UrlPolicyModule;

const IS_MACOS = process.platform === 'darwin';
const SEL_LIST_CONTAINER = '#list_videos_my_favourite_videos';
const SEL_PAGER = 'ul.pagination';
const SEL_PAGER_LINKS = 'ul.pagination a.page-link';
const TRACKPAD_HISTORY_THRESHOLD = 180;
const TRACKPAD_HISTORY_COOLDOWN_MS = 700;
const TRACKPAD_HISTORY_RESET_MS = 180;
const WEBVIEW_CONTENT_POLICY_SCAN_DELAY_MS = 0;
let trackpadHistoryDeltaX = 0;
let trackpadHistoryLastSentAt = 0;
let trackpadHistoryResetTimer: ReturnType<typeof setTimeout> | null = null;
let webViewContentPolicyScanTimer: ReturnType<typeof setTimeout> | null = null;
let webViewEnhancementMode = false;
const videoMetadataController = createVideoMetadataController({
  buttonHasIcon: buttonHasIcon,
  ipcRenderer: ipcRenderer,
  isJablePage: isJablePage
});
const browserSyncController = createBrowserSyncController({
  clickOrFetchPagerLink: clickOrFetchPagerLink,
  currentPageNumber: currentPageNumber,
  fetchAjaxSyncPageForTemplate: fetchAjaxSyncPageForTemplate,
  ipcRenderer: ipcRenderer,
  readPagerLinks: readPagerLinks,
  scrapeCurrentPage: scrapeCurrentPage,
  sendProgress: sendProgress,
  signature: signature,
  uniqByUrl: uniqByUrl
});
const collectionActionController = createCollectionActionController({
  buttonHasIcon: buttonHasIcon,
  collectionKeyForCurrentLocation: collectionKeyForCurrentLocation,
  ipcRenderer: ipcRenderer,
  readCurrentVideoDetails: videoMetadataController.readCurrentVideoDetails,
  scrapeVideoBox: scrapeVideoBox,
  siteOrderForVideoBox: siteOrderForVideoBox
});
const theaterModeController = createTheaterModeController({
  currentVideoUrl: videoMetadataController.currentVideoUrl,
  mainVideoElement: mainVideoElement,
  sendChanged: sendTheaterModeChanged
});
const hlsPlaybackController = createHlsPlaybackController({
  cleanVideoTitle: videoMetadataController.cleanVideoTitle,
  currentVideoUrl: videoMetadataController.currentVideoUrl,
  ipcRenderer: ipcRenderer,
  isEditableUserGestureTarget: function (target) {
    return target instanceof HTMLElement && target.matches(THEATER_MODE_EDITABLE_SHORTCUT_SELECTOR);
  },
  readCurrentLocalPlaybackSourcePageNotice: videoMetadataController.readCurrentLocalPlaybackSourcePageNotice,
  readCurrentVideoDetails: videoMetadataController.readCurrentVideoDetails
});
const localPlaybackController = createLocalPlaybackController({
  absUrl: absUrl,
  currentVideoUrl: videoMetadataController.currentVideoUrl,
  ipcRenderer: ipcRenderer,
  mainVideoElement: mainVideoElement,
  readCurrentLocalPlaybackSourcePageNotice: videoMetadataController.readCurrentLocalPlaybackSourcePageNotice
});

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node && target.parentElement) return target.parentElement;
  return null;
}

function absUrl(href: string, base?: string) {
  return absoluteUrl(href, base || location.href);
}

function uniqByUrl(rows: ScrapedVideoRow[]) {
  const seen: Record<string, boolean> = {};
  const out: ScrapedVideoRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].url || seen[rows[i].url]) continue;
    seen[rows[i].url] = true;
    out.push(rows[i]);
  }

  return out;
}

function applyWebViewContentRules() {
  webViewContentPolicyScanTimer = null;
  if (!webViewEnhancementMode) return;

  const removed = webViewContentPolicy.applyWebViewContentPolicy(
    document,
    webViewEnhancement.shouldSuppressWebViewNavigation
  );
  if (removed && webViewEnhancement.isWebViewEnhancementDebugEnabledByEnv(process.env)) {
    console.info('[webview-enhancement] updated ' + removed + ' container(s)');
  }
}

function scheduleWebViewContentRules() {
  if (!webViewEnhancementMode || webViewContentPolicyScanTimer) return;

  webViewContentPolicyScanTimer = setTimeout(applyWebViewContentRules, WEBVIEW_CONTENT_POLICY_SCAN_DELAY_MS);
}

function applyWebViewEnhancementSettings(value: unknown) {
  webViewEnhancementMode = Boolean(isRecord(value) && value.webViewEnhancementMode);
  if (webViewEnhancementMode) scheduleWebViewContentRules();
}

function installWebViewContentRules() {
  ipcRenderer
    .invoke('app:get-settings')
    .then(applyWebViewEnhancementSettings)
    .catch(function () {
      applyWebViewEnhancementSettings(null);
    });
  ipcRenderer.on('settings-changed', function (_event, settings) {
    applyWebViewEnhancementSettings(settings);
  });

  document.addEventListener('DOMContentLoaded', scheduleWebViewContentRules, { once: true });

  if (typeof MutationObserver === 'undefined') return;

  const target = document.documentElement || document;
  const observer = new MutationObserver(scheduleWebViewContentRules);
  observer.observe(target, {
    attributes: true,
    attributeFilter: ['href', 'src', 'data-src'],
    childList: true,
    subtree: true
  });
}

function scrapeVideoBox(box: Element | null): ScrapedVideoRow | null {
  return scrapeVideoBoxFromElement(box, location.href);
}

function scrapeRowsFrom(root: Document | Element) {
  return scrapeRowsFromRoot(root, location.href);
}

function scrapeCurrentPage() {
  return scrapeRowsFrom(document);
}

function siteOrderForVideoBox(box: Element | null) {
  if (!box) return null;

  const boxes = document.querySelectorAll('div.video-img-box');
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i] !== box) continue;
    return ((currentPageNumber() || 1) - 1) * SITE_PAGE_SIZE + i + 1;
  }

  return null;
}

function collectionKeyForCurrentLocation(): CollectionKey | null {
  const path = location.pathname.replace(/\/?$/, '/');
  if (/^\/my\/favourites\/videos\/(?:\d+\/)?$/.test(path)) return 'favourites';
  if (/^\/my\/favourites\/videos-watch-later\/(?:\d+\/)?$/.test(path)) return 'watch_later';
  return null;
}

function hasVisibleActiveBackground(el: Element | null) {
  if (!el) return false;

  try {
    const color = window.getComputedStyle(el).backgroundColor;
    return Boolean(color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)');
  } catch (error) {
    return false;
  }
}

function currentPageNumber(): number | null {
  const activePageNumber = activePageNumberFrom(document);
  if (activePageNumber) return activePageNumber;

  const anchors = document.querySelectorAll<HTMLAnchorElement>(SEL_PAGER_LINKS);

  for (let i = 0; i < anchors.length; i++) {
    const pageNumber = pagerPageNumberFromElement(anchors[i]);
    if (pageNumber && samePageUrl(anchors[i].getAttribute('href'), location.href, location.href)) return pageNumber;
  }

  for (let i = 0; i < anchors.length; i++) {
    const pageNumber = pagerPageNumberFromElement(anchors[i]);
    if (!pageNumber) continue;
    if (hasVisibleActiveBackground(anchors[i]) || hasVisibleActiveBackground(anchors[i].parentElement)) {
      return pageNumber;
    }
  }

  return null;
}

function signature() {
  return signatureFrom(document);
}

function waitForContainerChange(oldSig: string, timeoutMs: number): Promise<boolean> {
  const timeout = timeoutMs || 12000;
  const target = document.querySelector(SEL_LIST_CONTAINER) || document.body;
  const deadline = Date.now() + timeout;

  return new Promise(function (resolve) {
    let done = false;
    const observer = new MutationObserver(function () {
      check();
    });

    function finish(changed: boolean) {
      if (done) return;
      done = true;
      observer.disconnect();
      resolve(changed);
    }

    function check() {
      const cur = signature();
      if (cur && cur !== oldSig) finish(true);
      else if (Date.now() > deadline) finish(false);
    }

    observer.observe(target, { childList: true, subtree: true });

    (function poll() {
      if (done) return;
      check();
      if (!done) setTimeout(poll, 300);
    })();
  });
}

function readPagerLinks() {
  const pager = document.querySelector(SEL_PAGER);
  if (!pager) return [];

  const anchors = pager.querySelectorAll<HTMLAnchorElement>(SEL_PAGER_LINKS);
  const out: BrowserSyncPagerLink[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
    const href = absUrl(anchor.getAttribute('href') || anchor.href || '', anchor.baseURI || location.href);
    const blockId = anchor.getAttribute('data-block-id') || '';
    const parameters = anchor.getAttribute('data-parameters') || '';
    const pageParameter = pagerPageParameter(anchor);
    const ajaxUrl = ajaxUrlForPagerLink(blockId, parameters, location.href);
    let pageNumber = /^\d+$/.test(text) ? normalizePageNumber(text) : null;
    let id: string;

    if (pageParameter) id = pageParameter.value;
    else if (/^\d+$/.test(text)) id = text;
    else id = text || 'a_' + i;

    if (!pageNumber && pageParameter) {
      pageNumber = normalizePageNumber(pageParameter.value);
    }

    out.push({
      ajaxUrl: ajaxUrl,
      el: anchor,
      href: href,
      id: id,
      label: text,
      pageParamName: pageParameter ? pageParameter.name : null,
      pageParamWidth: pageParameter ? pageParameter.width : 0,
      pageNumber: pageNumber
    });
  }

  return out;
}

function replacePagersFromDocument(doc: Document) {
  const currentPagers = document.querySelectorAll<Element>(SEL_PAGER);
  const nextPagers = doc.querySelectorAll<Element>(SEL_PAGER);
  let replaced = false;

  for (let i = 0; i < currentPagers.length && i < nextPagers.length; i++) {
    currentPagers[i].replaceWith(document.importNode(nextPagers[i], true));
    replaced = true;
  }

  return replaced;
}

function replaceCollectionDomFromDocument(doc: Document) {
  const currentList = document.querySelector<Element>(SEL_LIST_CONTAINER);
  const nextList = doc.querySelector<Element>(SEL_LIST_CONTAINER);
  let replaced = false;

  if (currentList && nextList) {
    currentList.replaceWith(document.importNode(nextList, true));
    replaced = true;
  }

  return replacePagersFromDocument(doc) || replaced;
}

function ajaxSyncPageFromHtml(html: string, url: string, pageNumber: number, expectedLastPage: number): AjaxSyncPage {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = uniqByUrl(scrapeRowsFrom(doc));
  const pageSignature = signatureFrom(doc);
  const activePage = activePageNumberFrom(doc);
  const lastPage = lastPagerPageNumberFrom(doc);

  if (!rows.length || !pageSignature || pageSignature === '0|') {
    throw new AjaxSyncError('ajax-empty-page', 'AJAX page contained no rows', null, true);
  }

  if (activePage !== pageNumber) {
    throw new AjaxSyncError('ajax-page-mismatch', 'AJAX page number mismatch', null, false);
  }

  if (lastPage && lastPage !== expectedLastPage) {
    throw new AjaxSyncError('ajax-last-page-changed', 'AJAX last page changed during sync', null, false);
  }

  if (pageNumber < expectedLastPage && rows.length !== SITE_PAGE_SIZE) {
    throw new AjaxSyncError('ajax-short-page', 'AJAX page returned fewer rows than expected', null, false);
  }

  return {
    pageNumber: pageNumber,
    rows: rows,
    signature: pageSignature,
    lastPage: lastPage,
    url: url
  };
}

async function fetchAjaxSyncPageForTemplate(
  template: BrowserSyncPagerLink,
  pageNumber: number,
  expectedLastPage: number,
  onRetry?: (event: AjaxSyncRetryEvent) => void
): Promise<AjaxSyncPage> {
  return fetchAjaxSyncPage({
    expectedLastPage: expectedLastPage,
    isTrustedUrl: urlPolicy.isTrustedJableUrl,
    onRetry: onRetry,
    pageNumber: pageNumber,
    parsePage: ajaxSyncPageFromHtml,
    template: template
  });
}

async function loadPagerLinkByFetch(link: BrowserSyncPagerLink, oldSig: string) {
  const urls = [link.ajaxUrl, link.href];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url || !urlPolicy.isTrustedJableUrl(url)) continue;

    const fetched = await fetchTextWithTimeout(url, FULL_SYNC_AJAX_FETCH_TIMEOUT_MS);
    if (!fetched.ok || !fetched.text) continue;

    const doc = new DOMParser().parseFromString(fetched.text, 'text/html');
    const nextSig = signatureFrom(doc);
    if (!nextSig || nextSig === '0|' || nextSig === oldSig) continue;
    if (!replaceCollectionDomFromDocument(doc)) continue;

    collectionActionController.schedulePendingOverlay();
    scheduleWebViewContentRules();

    return signature() !== oldSig;
  }

  return false;
}

async function clickOrFetchPagerLink(link: BrowserSyncPagerLink, preferFetch: boolean) {
  const oldSig = signature();

  if (preferFetch && (await loadPagerLinkByFetch(link, oldSig))) return true;

  try {
    link.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {}

  await new Promise(function (resolve) {
    setTimeout(resolve, 200);
  });
  link.el.click();

  const changed = await waitForContainerChange(oldSig, 15000);
  if (changed && signature() !== oldSig) return true;

  return loadPagerLinkByFetch(link, oldSig);
}

function sendProgress(channel: string, payload: unknown) {
  try {
    if (typeof ipcRenderer.sendToHost === 'function') {
      ipcRenderer.sendToHost(channel, payload);
    }
  } catch (error) {}

  ipcRenderer.send('browser:' + channel, payload);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestIdFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return typeof payload.requestId === 'string' ? payload.requestId : null;
}

function syncOptionsFromPayload(payload: unknown): Partial<SyncBrowserCollectionOptions> | null {
  if (!isRecord(payload)) return null;
  return isRecord(payload.options) ? (payload.options as Partial<SyncBrowserCollectionOptions>) : null;
}

function sendPreloadResponse(requestId: string, result: unknown) {
  ipcRenderer.send('browser:preload-response', {
    requestId: requestId,
    ok: true,
    result: result
  });
}

function sendPreloadError(requestId: string, error: unknown) {
  ipcRenderer.send('browser:preload-response', {
    requestId: requestId,
    ok: false,
    error: errorMessage(error)
  });
}

function diagnosePage(): BrowserDiagnosis {
  const documentElement = document.documentElement;
  const body = document.body;

  return {
    url: location.href,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientHeight: documentElement.clientHeight,
    scrollHeight: Math.max(documentElement.scrollHeight, body ? body.scrollHeight : 0)
  };
}

function canElementScrollHorizontally(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (!(el instanceof HTMLElement)) return false;

  const style = window.getComputedStyle(el);
  const overflowX = style ? style.overflowX : '';
  const scrollableOverflow = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';

  return scrollableOverflow && el.scrollWidth > el.clientWidth + 1;
}

function canTargetContinueHorizontalScroll(target: EventTarget | null, direction: TrackpadHistoryDirection) {
  let el = elementFromTarget(target);

  while (el && el !== document.body && el !== document.documentElement) {
    if (canElementScrollHorizontally(el)) {
      if (direction === 'back' && el.scrollLeft > 0) return true;
      if (direction === 'forward' && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
    }

    el = el.parentElement;
  }

  return false;
}

function resetTrackpadHistoryDelta() {
  trackpadHistoryDeltaX = 0;
  trackpadHistoryResetTimer = null;
}

function handleTrackpadHistoryWheel(event: WheelEvent) {
  const deltaX = Number(event.deltaX) || 0;
  const deltaY = Number(event.deltaY) || 0;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (event.defaultPrevented || absX < 1 || absX < absY * 1.5) return;
  if (Date.now() - trackpadHistoryLastSentAt < TRACKPAD_HISTORY_COOLDOWN_MS) return;

  trackpadHistoryDeltaX += deltaX;

  if (trackpadHistoryResetTimer) clearTimeout(trackpadHistoryResetTimer);
  trackpadHistoryResetTimer = setTimeout(resetTrackpadHistoryDelta, TRACKPAD_HISTORY_RESET_MS);

  if (Math.abs(trackpadHistoryDeltaX) < TRACKPAD_HISTORY_THRESHOLD) return;

  // macOS natural horizontal scrolling reports negative deltaX for the back gesture.
  const direction: TrackpadHistoryDirection = trackpadHistoryDeltaX < 0 ? 'back' : 'forward';

  if (canTargetContinueHorizontalScroll(event.target, direction)) {
    resetTrackpadHistoryDelta();
    return;
  }

  event.preventDefault();
  resetTrackpadHistoryDelta();
  trackpadHistoryLastSentAt = Date.now();
  ipcRenderer.send('browser:trackpad-history', direction);
}

function closestAnchor(target: EventTarget | null) {
  let el = elementFromTarget(target);

  while (el && el !== document.documentElement) {
    if (el instanceof HTMLAnchorElement && el.href) return el;
    el = el.parentElement;
  }

  return null;
}

function handleMiddleClickNewTab(event: MouseEvent) {
  if (!event.isTrusted || event.defaultPrevented || event.button !== 1) return;

  const anchor = closestAnchor(event.target);
  if (!anchor) return;

  const href = anchor.getAttribute('href') || anchor.href || '';
  const url = absUrl(href, anchor.baseURI || location.href);

  if (!url || /^javascript:/i.test(url)) return;

  event.preventDefault();
  event.stopPropagation();
  ipcRenderer.send('browser:open-url-new-tab', { url: url });
}

if (IS_MACOS) {
  window.addEventListener('wheel', handleTrackpadHistoryWheel, { capture: true, passive: false });
}

window.addEventListener('auxclick', handleMiddleClickNewTab, { capture: true });

function buttonHasIcon(button: Element | null, iconId: string) {
  if (!button) return false;

  const uses = button.querySelectorAll<SVGUseElement>('use');

  for (let i = 0; i < uses.length; i++) {
    const href =
      uses[i].getAttribute('href') ||
      uses[i].getAttribute('xlink:href') ||
      (uses[i].href && uses[i].href.baseVal) ||
      '';
    if (href === iconId) return true;
  }

  return false;
}

function isJablePage() {
  return urlPolicy.isTrustedJableUrl(location.href);
}

function rankedVideoElement(video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  const area = Math.max(0, rect.width) * Math.max(0, rect.height);
  return area + (video.controls ? 1000 : 0) + (video.closest('.player, .video-player, #player') ? 500 : 0);
}

function mainVideoElement(): HTMLVideoElement | null {
  const videos = document.querySelectorAll<HTMLVideoElement>('video');
  let best: HTMLVideoElement | null = null;
  let bestRank = -1;

  for (let i = 0; i < videos.length; i++) {
    const rank = rankedVideoElement(videos[i]);
    if (!best || rank > bestRank) {
      best = videos[i];
      bestRank = rank;
    }
  }

  return best;
}

function sendTheaterModeChanged(result: TheaterModeResult) {
  ipcRenderer.send('browser:theater-mode-changed', result);
}

ipcRenderer.on('browser:sync-collection-request', function (_event, payload: unknown) {
  const requestId = requestIdFromPayload(payload);
  if (!requestId) return;

  browserSyncController
    .syncCollection(syncOptionsFromPayload(payload))
    .then(function (result) {
      sendPreloadResponse(requestId, result);
    })
    .catch(function (error) {
      sendPreloadError(requestId, error);
    });
});

ipcRenderer.on('browser:apply-deferred-sync-operations-request', function (_event, payload: unknown) {
  const requestId = requestIdFromPayload(payload);
  if (!requestId) return;

  const operations = isRecord(payload) && Array.isArray(payload.operations) ? payload.operations : [];

  browserSyncController
    .applyDeferredSyncOperations(operations)
    .then(function (result) {
      sendPreloadResponse(requestId, result);
    })
    .catch(function (error) {
      sendPreloadError(requestId, error);
    });
});

ipcRenderer.on('browser:sync-lock-state', function (_event, payload: unknown) {
  collectionActionController.updateActiveSyncLocks(payload);
});

ipcRenderer.on('browser:pending-collection-operations', function (_event, payload: unknown) {
  collectionActionController.updatePendingCollectionOperations(payload);
});

ipcRenderer
  .invoke('browser:active-sync-runs')
  .then(function (payload) {
    collectionActionController.updateActiveSyncLocks(payload);
  })
  .catch(function () {});

ipcRenderer
  .invoke('browser:pending-collection-operations')
  .then(function (payload) {
    collectionActionController.updatePendingCollectionOperations(payload);
  })
  .catch(function () {});

ipcRenderer.on('browser:diagnose-request', function (_event, payload: unknown) {
  const requestId = requestIdFromPayload(payload);
  if (!requestId) return;

  try {
    sendPreloadResponse(requestId, diagnosePage());
  } catch (error) {
    sendPreloadError(requestId, error);
  }
});

ipcRenderer.on('browser:set-theater-mode-request', function (_event, payload: unknown) {
  const requestId = requestIdFromPayload(payload);
  if (!requestId) return;

  try {
    const enabled = Boolean(isRecord(payload) && payload.enabled);
    const result = theaterModeController.set(enabled, true);
    sendTheaterModeChanged(result);
    sendPreloadResponse(requestId, result);
  } catch (error) {
    sendPreloadError(requestId, error);
  }
});

ipcRenderer.on('browser:get-theater-mode-request', function (_event, payload: unknown) {
  const requestId = requestIdFromPayload(payload);
  if (!requestId) return;

  try {
    sendPreloadResponse(requestId, theaterModeController.snapshot());
  } catch (error) {
    sendPreloadError(requestId, error);
  }
});

ipcRenderer.on('browser:apply-theater-mode', function (_event, payload: unknown) {
  const enabled = !isRecord(payload) || payload.enabled !== false;

  try {
    theaterModeController.set(enabled, false);
  } catch (error) {}
});

ipcRenderer.on('browser:leave-theater-mode', function () {
  const result = theaterModeController.set(false, false);
  sendTheaterModeChanged(result);
});

hlsPlaybackController.installPlaylistProxyInterception();
hlsPlaybackController.installPlaybackStartedObserver();
collectionActionController.install();
installWebViewContentRules();
videoMetadataController.install();
localPlaybackController.install();
theaterModeController.install();
