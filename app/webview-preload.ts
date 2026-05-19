'use strict';

import type * as Electron from 'electron';
import type {
  BrowserDiagnosis,
  CollectionKey,
  LocalPlaybackSourceResult,
  ScrapedVideoRow,
  SyncBrowserCollectionOptions,
  SyncMode,
  SyncResult
} from './types/jable';
import type { AjaxPagerTemplate, AjaxSyncPage, AjaxSyncRetryEvent } from './browser/webview-preload-helpers';
import {
  AjaxSyncError,
  FULL_SYNC_AJAX_FETCH_TIMEOUT_MS,
  SITE_PAGE_SIZE,
  absoluteUrl,
  activePageNumberFrom,
  ajaxFailureDetail,
  ajaxUrlForPagerLink,
  fetchAjaxPagesWithWindow,
  fetchAjaxSyncPage,
  fetchTextWithTimeout,
  inferPreviewFromImageUrl as inferPreviewFromImageUrlForBase,
  lastPagerPageNumberFrom,
  normalizeAjaxWindowSize,
  normalizePageNumber,
  pagerPageNumberFromElement,
  pagerPageParameter,
  parseMetricNumber,
  samePageUrl,
  scrapeRowsFrom as scrapeRowsFromRoot,
  scrapeVideoBox as scrapeVideoBoxFromElement,
  signatureFrom,
  validateAjaxFirstPage,
  validateAjaxPages,
  videoPathKey
} from './browser/webview-preload-helpers';

type CollectionAction = 'add' | 'remove';
type TrackpadHistoryDirection = 'back' | 'forward';
type ActiveSyncLock = {
  mode: SyncMode;
  syncRunId: string;
};
type DeferredSyncOperation = {
  id: number;
  action: CollectionAction;
  videoUrl?: string | null;
  remoteVideoId: string | null;
  remoteFavType: string | null;
};
type DeferredSyncOperationApplyFailure = {
  id: number;
  url: string;
  message: string;
  blocked: boolean;
};
type PendingCollectionOperation = {
  action: CollectionAction;
  videoUrl: string;
  remoteVideoId: string | null;
  remoteFavType: string | null;
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
type TheaterModeResult = {
  enabled: boolean;
  applied: boolean;
  videoUrl: string | null;
  reason?: string;
};
type DownloadRecordStateSnapshot = {
  videoUrl: string;
  state: string;
};
type HlsPlaylistProxyUrlResult =
  | {
      available: false;
      reason: string;
    }
  | {
      available: true;
      playlistUrl: string;
      sourceUrl: string;
      videoUrl: string;
    };
type PagerLink = AjaxPagerTemplate & {
  el: HTMLAnchorElement;
  href: string;
  id: string;
  label: string;
  pageNumber: number | null;
};
type SendToHostIpcRenderer = Electron.IpcRenderer & {
  sendToHost?: (channel: string, ...args: unknown[]) => void;
};
type ChooseFirstPagerLink = (links: PagerLink[]) => PagerLink | null;
type ChooseNextPagerLink = (links: PagerLink[], currentPage: number | null) => PagerLink | null;
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
const syncUtils = require('./sync/sync-utils') as {
  chooseFirstPagerLink: ChooseFirstPagerLink;
  chooseNextPagerLink: ChooseNextPagerLink;
};
const chooseFirstPagerLink = syncUtils.chooseFirstPagerLink;
const chooseNextPagerLink = syncUtils.chooseNextPagerLink;
const urlPolicy = require('./browser/url-policy') as UrlPolicyModule;

const IS_MACOS = process.platform === 'darwin';
const SEL_LIST_CONTAINER = '#list_videos_my_favourite_videos';
const SEL_PAGER = 'ul.pagination';
const SEL_PAGER_LINKS = 'ul.pagination a.page-link';
const TRACKPAD_HISTORY_THRESHOLD = 180;
const TRACKPAD_HISTORY_COOLDOWN_MS = 700;
const TRACKPAD_HISTORY_RESET_MS = 180;
const COLLECTION_TOGGLE_CONFIRM_TIMEOUT_MS = 4000;
const COLLECTION_TOGGLE_CONFIRM_POLL_MS = 120;
const WEBVIEW_CONTENT_POLICY_SCAN_DELAY_MS = 0;
const LOCAL_PLAYBACK_SCAN_DELAY_MS = 120;
const VIDEO_METADATA_REFRESH_DELAY_MS = 400;
const LOCAL_PLAYBACK_PREVIEW_WIDTH = 213;
const LOCAL_PLAYBACK_PREVIEW_HEIGHT = 120;
const CHINESE_SUBTITLE_NOTICE_TOKEN = '中文字幕版';
const HLS_PROXY_MESSAGE_SOURCE = 'jable-desktop-hls-proxy';
const HLS_PROXY_REQUEST_MESSAGE = 'jable-hls-proxy-url-request';
const HLS_PROXY_RESPONSE_MESSAGE = 'jable-hls-proxy-url-response';
const HLS_PROXY_PAGE_REQUEST_TIMEOUT_MS = 1500;
const HLS_PLAYBACK_USER_GESTURE_TTL_MS = 8000;
const THEATER_MODE_STYLE_ID = 'jable-desktop-theater-style';
const THEATER_MODE_ROOT_CLASS = 'jable-desktop-theater-active';
const THEATER_MODE_TARGET_CLASS = 'jable-desktop-theater-target';
const THEATER_MODE_APPLY_DELAY_MS = 120;
const THEATER_MODE_PLAYER_SELECTORS = [
  '#player',
  '#video-player',
  '#player-container',
  '.player',
  '.video-player',
  '.video-player-wrapper',
  '.video-container',
  '.embed-responsive',
  '.video-js',
  '.jwplayer',
  '.flowplayer',
  '.fp-player',
  '.fluid_video_wrapper',
  '.fluid_player_layout',
  '.dplayer',
  '.xgplayer',
  '.art-video-player',
  '.mejs__container',
  '.mejs-container',
  '.plyr',
  '.plyr__video-wrapper'
];
const THEATER_MODE_CONTROL_SELECTOR =
  '.vjs-control-bar,.jw-controls,.jw-controlbar,.plyr__controls,.fp-controls,.fp-ui,.fluid_controls_container,' +
  '.dplayer-controller,.xgplayer-controls,.art-controls,.mejs__controls,.mejs-controls';
const THEATER_MODE_EDITABLE_SHORTCUT_SELECTOR =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
let trackpadHistoryDeltaX = 0;
let trackpadHistoryLastSentAt = 0;
let trackpadHistoryResetTimer: ReturnType<typeof setTimeout> | null = null;
let webViewContentPolicyScanTimer: ReturnType<typeof setTimeout> | null = null;
let localPlaybackScanTimer: ReturnType<typeof setTimeout> | null = null;
let videoMetadataRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let webViewEnhancementMode = false;
let activeSyncLocks: Partial<Record<CollectionKey, ActiveSyncLock>> = {};
let pendingCollectionOperations: Partial<Record<CollectionKey, PendingCollectionOperation[]>> = {};
let pendingCollectionOverlayTimer: ReturnType<typeof setTimeout> | null = null;
let localPlaybackRequestSequence = 0;
let activeLocalPlaybackVideoUrl: string | null = null;
let activeLocalPlaybackSourceUrl: string | null = null;
let activeLocalPlaybackThumbnailVttUrl: string | null = null;
let activeLocalPlaybackSourcePageChineseSubtitleNotice: boolean | null = null;
let activeLocalPlaybackPreviewRefreshInFlight = false;
let localPlaybackPageReloadScheduled = false;
let theaterModePreferred = false;
let theaterModeAppliedElement: HTMLElement | null = null;
let theaterModeApplyTimer: ReturnType<typeof setTimeout> | null = null;
let theaterModeObserver: MutationObserver | null = null;
let lastVideoMetadataRefreshSignature = '';
let lastHlsPlaybackStartedVideoUrl = '';
let lastHlsPlaybackStartedUserInitiated = false;
let lastHlsPlaybackUserGestureAt = 0;
const hlsPlaybackPageLoadId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : String(Date.now()) + '-' + String(Math.random()).slice(2);
const failedLocalPlaybackSources: Record<string, boolean> = {};
const failedLocalPlaybackVideoUrls: Record<string, boolean> = {};
const localPlaybackRestoreStates = new WeakMap<HTMLVideoElement, LocalPlaybackRestoreState>();
const localPlaybackErrorHandlers = new WeakMap<HTMLVideoElement, LocalPlaybackErrorHandler>();
const localPlaybackPreviewControllers = new WeakMap<HTMLVideoElement, LocalPlaybackPreviewController>();

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

function inferPreviewFromImageUrl(value: string | null | undefined) {
  return inferPreviewFromImageUrlForBase(value, location.href);
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
  const out: PagerLink[] = [];

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
  template: PagerLink,
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

async function loadPagerLinkByFetch(link: PagerLink, oldSig: string) {
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

    scheduleApplyPendingCollectionOperations();
    scheduleWebViewContentRules();

    return signature() !== oldSig;
  }

  return false;
}

async function clickOrFetchPagerLink(link: PagerLink, preferFetch: boolean) {
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

function updateActiveSyncLocks(payload: unknown) {
  const nextLocks: Partial<Record<CollectionKey, ActiveSyncLock>> = {};
  const runs = isRecord(payload) && isRecord(payload.runs) ? payload.runs : {};

  if (isRecord(runs.favourites)) {
    const run = runs.favourites;
    if (typeof run.syncRunId === 'string' && (run.mode === 'quick' || run.mode === 'full')) {
      nextLocks.favourites = { mode: run.mode, syncRunId: run.syncRunId };
    }
  }

  if (isRecord(runs.watch_later)) {
    const run = runs.watch_later;
    if (typeof run.syncRunId === 'string' && (run.mode === 'quick' || run.mode === 'full')) {
      nextLocks.watch_later = { mode: run.mode, syncRunId: run.syncRunId };
    }
  }

  activeSyncLocks = nextLocks;
}

function normalizePendingCollectionOperation(value: unknown): PendingCollectionOperation | null {
  if (!isRecord(value)) return null;

  const action = value.action === 'remove' ? 'remove' : value.action === 'add' ? 'add' : null;
  const videoUrl = typeof value.videoUrl === 'string' ? value.videoUrl : '';
  if (!action || !videoPathKey(videoUrl, location.href)) return null;

  return {
    action: action,
    videoUrl: videoUrl,
    remoteVideoId: typeof value.remoteVideoId === 'string' ? value.remoteVideoId : null,
    remoteFavType: typeof value.remoteFavType === 'string' ? value.remoteFavType : null
  };
}

function updatePendingCollectionOperations(payload: unknown) {
  const nextOperations: Partial<Record<CollectionKey, PendingCollectionOperation[]>> = {};
  const collections = isRecord(payload) && isRecord(payload.collections) ? payload.collections : {};
  const keys: CollectionKey[] = ['favourites', 'watch_later'];

  for (let i = 0; i < keys.length; i++) {
    const collectionKey = keys[i];
    const rawOperations = Array.isArray(collections[collectionKey]) ? collections[collectionKey] : [];
    const operations: PendingCollectionOperation[] = [];

    for (let n = 0; n < rawOperations.length; n++) {
      const operation = normalizePendingCollectionOperation(rawOperations[n]);
      if (operation) operations.push(operation);
    }

    if (operations.length) nextOperations[collectionKey] = operations;
  }

  pendingCollectionOperations = nextOperations;
  scheduleApplyPendingCollectionOperations();
}

function activeSyncLockForCollection(collectionKey: CollectionKey): ActiveSyncLock | null {
  return activeSyncLocks[collectionKey] || null;
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

function closestCollectionActionElement(target: EventTarget | null) {
  let el = elementFromTarget(target);

  while (el && el !== document.documentElement) {
    if (el.tagName === 'BUTTON' && el.classList && el.classList.contains('btn-action')) return el;
    if (el.classList && el.classList.contains('action') && el.hasAttribute('data-fav-video-id')) return el;
    el = el.parentElement;
  }

  return null;
}

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

function collectionKeyForActionElement(el: Element | null): CollectionKey | null {
  if (!el || !el.classList) return null;

  const favType = el.getAttribute('data-fav-type');
  if (favType === '0') return 'favourites';
  if (favType === '1') return 'watch_later';

  if (el.classList.contains('fav') || buttonHasIcon(el, '#icon-heart')) return 'favourites';
  if (buttonHasIcon(el, '#icon-bookmark-inline')) return 'watch_later';
  if (collectionListActionForElement(el)) return collectionKeyForCurrentLocation();

  return null;
}

function remoteFavTypeForCollection(collectionKey: CollectionKey) {
  return collectionKey === 'watch_later' ? '1' : '0';
}

function remoteVideoIdForActionElement(el: Element | null) {
  return el ? el.getAttribute('data-fav-video-id') || '' : '';
}

function remoteFavTypeForActionElement(el: Element | null, collectionKey: CollectionKey) {
  return (el ? el.getAttribute('data-fav-type') || '' : '') || remoteFavTypeForCollection(collectionKey);
}

function collectionListActionForElement(el: Element | null): CollectionAction | null {
  if (!el || !el.classList) return null;

  if (el.classList.contains('fav-remove') || buttonHasIcon(el, '#icon-close')) return 'remove';
  if (el.classList.contains('fav-restore') || buttonHasIcon(el, '#icon-rotate-back')) return 'add';

  return null;
}

function collectionActionForElement(el: Element | null): CollectionAction {
  const listAction = collectionListActionForElement(el);
  if (listAction) return listAction;

  return el && el.classList && el.classList.contains('active') ? 'remove' : 'add';
}

function addUniqueElement(list: Element[], el: Element | null) {
  if (!el || list.indexOf(el) >= 0) return;
  list.push(el);
}

function addCountDelta(counts: Element[], deltas: number[], count: Element | null, delta: number) {
  if (!count || !delta || counts.indexOf(count) >= 0) return;
  counts.push(count);
  deltas.push(delta);
}

function collectionActionElementMatchesFavType(el: Element, collectionKey: CollectionKey, favType: string) {
  const elementFavType = el.getAttribute('data-fav-type') || '';
  if (elementFavType) return elementFavType === favType;
  return collectionKeyForActionElement(el) === collectionKey;
}

function matchingCollectionActionElements(originalElement: Element | null, collectionKey: CollectionKey) {
  const out: Element[] = [];
  const videoId = originalElement ? originalElement.getAttribute('data-fav-video-id') || '' : '';
  const favType = remoteFavTypeForActionElement(originalElement, collectionKey);

  if (originalElement && document.documentElement.contains(originalElement)) addUniqueElement(out, originalElement);

  if (videoId) {
    const elements = document.querySelectorAll<Element>('.action[data-fav-video-id], button[data-fav-video-id]');

    for (let i = 0; i < elements.length; i++) {
      if (elements[i].getAttribute('data-fav-video-id') !== videoId) continue;
      if (!collectionActionElementMatchesFavType(elements[i], collectionKey, favType)) continue;
      addUniqueElement(out, elements[i]);
    }
  }

  if (!out.length) addUniqueElement(out, findCollectionActionElement(collectionKey));

  return out;
}

function applyQueuedCollectionVisualState(
  collectionKey: CollectionKey,
  originalElement: Element | null,
  action: CollectionAction
) {
  const targets = matchingCollectionActionElements(originalElement, collectionKey);
  const counts: Element[] = [];
  const countDeltas: number[] = [];

  // This can be replayed after AJAX pagination, so count changes must stay idempotent.
  for (let i = 0; i < targets.length; i++) {
    const el = targets[i];
    const count = el.querySelector('.count');

    if (collectionListActionForElement(el) || collectionListActionForElement(originalElement)) {
      const imgBox = el && typeof el.closest === 'function' ? el.closest('div.img-box') : null;
      const shouldBeRemoved = action === 'remove';

      if (imgBox) {
        const wasRemoved = imgBox.classList.contains('removed');
        if (wasRemoved !== shouldBeRemoved) addCountDelta(counts, countDeltas, count, action === 'add' ? 1 : -1);
        imgBox.classList.toggle('removed', shouldBeRemoved);
      }

      continue;
    }

    const shouldBeActive = action === 'add';
    const wasActive = el.classList.contains('active');

    if (wasActive !== shouldBeActive) addCountDelta(counts, countDeltas, count, action === 'add' ? 1 : -1);
    el.classList.toggle('active', shouldBeActive);
    el.setAttribute('aria-pressed', shouldBeActive ? 'true' : 'false');
  }

  for (let i = 0; i < counts.length; i++) {
    const current = parseMetricNumber(counts[i].textContent) || 0;
    const next = Math.max(0, current + countDeltas[i]);
    counts[i].textContent = String(next);
  }
}

function actionRequiresLogin(el: Element | null) {
  const actionUrl = el ? el.getAttribute('data-href') || el.getAttribute('href') || '' : '';
  return /\/login-required\/?/.test(actionUrl);
}

function isJablePage() {
  return urlPolicy.isTrustedJableUrl(location.href);
}

function currentVideoUrl() {
  if (!isJablePage()) return null;

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
    if (!buttonHasIcon(svgs[i], iconId)) continue;

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
    img: img ? absUrl(img) : null,
    preview: inferPreviewFromImageUrl(img)
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
    await ipcRenderer.invoke('db:refresh-video-metadata', video);
  } catch (error) {
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

function localPlaybackSourceIsAvailable(
  value: LocalPlaybackSourceResult
): value is Extract<LocalPlaybackSourceResult, { available: true }> {
  return Boolean(value && value.available);
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

function installTheaterModeStyle() {
  if (document.getElementById(THEATER_MODE_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = THEATER_MODE_STYLE_ID;
  style.textContent =
    'html.' +
    THEATER_MODE_ROOT_CLASS +
    ',html.' +
    THEATER_MODE_ROOT_CLASS +
    ' body{' +
    'overflow:hidden!important;' +
    '}' +
    '.' +
    THEATER_MODE_TARGET_CLASS +
    '{' +
    'position:fixed!important;' +
    'inset:0!important;' +
    'width:100vw!important;' +
    'height:100vh!important;' +
    'max-width:none!important;' +
    'max-height:none!important;' +
    'margin:0!important;' +
    'padding:0!important;' +
    'transform:none!important;' +
    'z-index:2147483645!important;' +
    'background:#000!important;' +
    'overflow:hidden!important;' +
    'box-sizing:border-box!important;' +
    '}' +
    '.' +
    THEATER_MODE_TARGET_CLASS +
    ' video,' +
    'video.' +
    THEATER_MODE_TARGET_CLASS +
    ',.' +
    THEATER_MODE_TARGET_CLASS +
    ' .vjs-tech,.' +
    THEATER_MODE_TARGET_CLASS +
    ' iframe{' +
    'width:100%!important;' +
    'height:100%!important;' +
    'max-width:none!important;' +
    'max-height:none!important;' +
    'object-fit:contain!important;' +
    'background:#000!important;' +
    '}' +
    '.' +
    THEATER_MODE_TARGET_CLASS +
    ' .video-js,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .jwplayer,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .flowplayer,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .fp-player,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .fluid_video_wrapper,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .fluid_player_layout,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .dplayer,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .xgplayer,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .art-video-player,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .mejs__container,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .mejs-container,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .plyr{' +
    'width:100%!important;' +
    'height:100%!important;' +
    'max-width:none!important;' +
    'max-height:none!important;' +
    '}' +
    '.' +
    THEATER_MODE_TARGET_CLASS +
    ' .vjs-control-bar,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .jw-controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .jw-controlbar,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .plyr__controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .fp-controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .fp-ui,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .fluid_controls_container,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .dplayer-controller,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .xgplayer-controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .art-controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .mejs__controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .mejs-controls{' +
    'z-index:2147483647!important;' +
    'pointer-events:auto!important;' +
    '}' +
    '.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .vjs-control-bar,.' +
    THEATER_MODE_TARGET_CLASS +
    ' .vjs-user-active .vjs-control-bar{' +
    'display:flex!important;' +
    'visibility:visible!important;' +
    'opacity:1!important;' +
    '}' +
    '.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .jw-controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .jw-controlbar,.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .plyr__controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .fp-controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .fp-ui,.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .fluid_controls_container,.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .dplayer-controller,.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .xgplayer-controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .art-controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .mejs__controls,.' +
    THEATER_MODE_TARGET_CLASS +
    ':hover .mejs-controls{' +
    'visibility:visible!important;' +
    'opacity:1!important;' +
    '}';

  (document.head || document.documentElement).appendChild(style);
}

function theaterModeTargetForVideo(video: HTMLVideoElement): HTMLElement {
  const playerSelector = THEATER_MODE_PLAYER_SELECTORS.join(',');
  let firstPlayerCandidate: HTMLElement | null = null;
  let controlOwner: HTMLElement | null = null;

  for (let element: HTMLElement | null = video; element; element = element.parentElement) {
    if (element === document.body || element === document.documentElement) break;

    if (!firstPlayerCandidate && element.matches(playerSelector)) {
      firstPlayerCandidate = element;
    }

    if (element.querySelector(THEATER_MODE_CONTROL_SELECTOR)) {
      if (element.matches(playerSelector)) return element;
      if (!controlOwner) controlOwner = element;
    }
  }

  if (controlOwner) return controlOwner;
  if (firstPlayerCandidate) return firstPlayerCandidate;
  if (video.parentElement instanceof HTMLElement) return video.parentElement;
  return video;
}

function removeTheaterModeClasses() {
  if (theaterModeApplyTimer) {
    clearTimeout(theaterModeApplyTimer);
    theaterModeApplyTimer = null;
  }

  if (theaterModeAppliedElement) {
    theaterModeAppliedElement.classList.remove(THEATER_MODE_TARGET_CLASS);
    theaterModeAppliedElement = null;
  }

  document.documentElement.classList.remove(THEATER_MODE_ROOT_CLASS);
  if (document.body) document.body.classList.remove(THEATER_MODE_ROOT_CLASS);
}

function stopTheaterModeObserver() {
  if (!theaterModeObserver) return;
  theaterModeObserver.disconnect();
  theaterModeObserver = null;
}

function scheduleTheaterModeApply() {
  if (!theaterModePreferred || theaterModeApplyTimer) return;

  theaterModeApplyTimer = setTimeout(function () {
    theaterModeApplyTimer = null;
    try {
      applyTheaterMode(false);
    } catch (error) {}
  }, THEATER_MODE_APPLY_DELAY_MS);
}

function ensureTheaterModeObserver() {
  if (theaterModeObserver || typeof MutationObserver === 'undefined') return;

  theaterModeObserver = new MutationObserver(function (records) {
    for (let i = 0; i < records.length; i++) {
      if (records[i].type === 'childList' && (records[i].addedNodes.length || records[i].removedNodes.length)) {
        scheduleTheaterModeApply();
        return;
      }
    }
  });
  theaterModeObserver.observe(document.documentElement || document, {
    childList: true,
    subtree: true
  });
}

function theaterModeResult(applied: boolean, reason?: string): TheaterModeResult {
  const videoUrl = currentVideoUrl();
  const result: TheaterModeResult = {
    enabled: theaterModePreferred,
    applied: applied,
    videoUrl: videoUrl
  };

  if (reason) result.reason = reason;
  return result;
}

function applyTheaterMode(failIfMissing: boolean): TheaterModeResult {
  if (!theaterModePreferred) {
    removeTheaterModeClasses();
    stopTheaterModeObserver();
    return theaterModeResult(false, 'disabled');
  }

  ensureTheaterModeObserver();

  if (!currentVideoUrl()) {
    removeTheaterModeClasses();
    if (failIfMissing) {
      theaterModePreferred = false;
      stopTheaterModeObserver();
      throw new Error('No Jable video page found');
    }
    return theaterModeResult(false, 'not_video_page');
  }

  if (document.fullscreenElement) {
    removeTheaterModeClasses();
    return theaterModeResult(false, 'fullscreen');
  }

  const video = mainVideoElement();
  if (!video) {
    removeTheaterModeClasses();
    if (failIfMissing) {
      theaterModePreferred = false;
      stopTheaterModeObserver();
      throw new Error('No video player found');
    }
    return theaterModeResult(false, 'missing_video');
  }

  const target = theaterModeTargetForVideo(video);

  installTheaterModeStyle();
  if (theaterModeAppliedElement && theaterModeAppliedElement !== target) {
    theaterModeAppliedElement.classList.remove(THEATER_MODE_TARGET_CLASS);
  }

  theaterModeAppliedElement = target;
  document.documentElement.classList.add(THEATER_MODE_ROOT_CLASS);
  if (document.body) document.body.classList.add(THEATER_MODE_ROOT_CLASS);
  target.classList.add(THEATER_MODE_TARGET_CLASS);

  return theaterModeResult(true);
}

function setTheaterMode(enabled: boolean, failIfMissing: boolean): TheaterModeResult {
  theaterModePreferred = Boolean(enabled);

  if (!theaterModePreferred) {
    removeTheaterModeClasses();
    stopTheaterModeObserver();
    return theaterModeResult(false, 'disabled');
  }

  return applyTheaterMode(failIfMissing);
}

function sendTheaterModeChanged(result: TheaterModeResult) {
  ipcRenderer.send('browser:theater-mode-changed', result);
}

function isTheaterModeEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(THEATER_MODE_EDITABLE_SHORTCUT_SELECTOR));
}

function isTheaterModeToggleShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === 't' &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !isTheaterModeEditableShortcutTarget(event.target)
  );
}

function toggleTheaterModeFromShortcut(event: KeyboardEvent) {
  if (!isTheaterModeToggleShortcut(event)) return;
  if (!theaterModePreferred && !currentVideoUrl()) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const result = setTheaterMode(!theaterModePreferred, false);
  sendTheaterModeChanged(result);
}

function installTheaterModeController() {
  document.addEventListener('DOMContentLoaded', scheduleTheaterModeApply, { once: true });
  window.addEventListener('pageshow', scheduleTheaterModeApply);
  window.addEventListener('load', scheduleTheaterModeApply, { once: true });
  document.addEventListener('fullscreenchange', function () {
    if (document.fullscreenElement) {
      removeTheaterModeClasses();
      return;
    }

    scheduleTheaterModeApply();
  });
  document.addEventListener(
    'keydown',
    function (event) {
      if (!theaterModePreferred || document.fullscreenElement || (event.key !== 'Escape' && event.key !== 'Esc'))
        return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const result = setTheaterMode(false, false);
      sendTheaterModeChanged(result);
    },
    true
  );
  document.addEventListener('keydown', toggleTheaterModeFromShortcut, true);
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
      imageUrl: absUrl(imageLine, baseUrl)
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
    const left = Math.min(window.innerWidth - halfWidth - edgeMargin, Math.max(halfWidth + edgeMargin, event.clientX));
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
  const controller = localPlaybackPreviewControllers.get(video);
  if (!controller) return;

  controller.dispose();
  localPlaybackPreviewControllers.delete(video);
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

  localPlaybackPreviewControllers.set(video, createLocalPlaybackPreviewController(video, cues));
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
  if (activeLocalPlaybackPreviewRefreshInFlight) return;
  if (!activeLocalPlaybackVideoUrl || !activeLocalPlaybackSourceUrl || activeLocalPlaybackThumbnailVttUrl) return;

  const videoUrl = activeLocalPlaybackVideoUrl;
  const sourceUrl = activeLocalPlaybackSourceUrl;
  const sourcePageChineseSubtitleNotice = activeLocalPlaybackSourcePageChineseSubtitleNotice;
  activeLocalPlaybackPreviewRefreshInFlight = true;

  try {
    const result = (await ipcRenderer.invoke('download:local-playback-source', {
      videoUrl: videoUrl,
      sourcePageChineseSubtitleNotice: sourcePageChineseSubtitleNotice
    })) as LocalPlaybackSourceResult;
    if (!localPlaybackSourceIsAvailable(result) || !result.thumbnailVttUrl) return;
    if (activeLocalPlaybackVideoUrl !== videoUrl || activeLocalPlaybackSourceUrl !== sourceUrl) return;

    const video = mainVideoElement();
    if (!video || video.dataset.jableLocalPlaybackSource !== sourceUrl) return;

    activeLocalPlaybackThumbnailVttUrl = result.thumbnailVttUrl;
    await installLocalPlaybackPreview(video, result.thumbnailVttUrl);
  } catch (error) {
  } finally {
    activeLocalPlaybackPreviewRefreshInFlight = false;
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
  if (localPlaybackRestoreStates.has(video)) return;

  const sources = Array.from(video.querySelectorAll<HTMLSourceElement>('source')).map(snapshotLocalPlaybackSource);
  localPlaybackRestoreStates.set(video, {
    hadSrc: video.hasAttribute('src'),
    src: video.getAttribute('src') || '',
    sources: sources
  });
}

function restoreLocalPlaybackVideo(video: HTMLVideoElement) {
  const handler = localPlaybackErrorHandlers.get(video);
  if (handler) {
    video.removeEventListener('error', handler);
    localPlaybackErrorHandlers.delete(video);
  }
  removeLocalPlaybackPreview(video);

  const state = localPlaybackRestoreStates.get(video);
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
  localPlaybackRestoreStates.delete(video);
  activeLocalPlaybackVideoUrl = null;
  activeLocalPlaybackSourceUrl = null;
  activeLocalPlaybackThumbnailVttUrl = null;
  activeLocalPlaybackSourcePageChineseSubtitleNotice = null;

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

  failedLocalPlaybackVideoUrls[videoUrl] = true;
  if (localPlaybackPageReloadScheduled) return true;

  localPlaybackPageReloadScheduled = true;
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
  const videoUrl = activeLocalPlaybackVideoUrl || currentVideoUrl();
  if (sourceUrl) failedLocalPlaybackSources[sourceUrl] = true;
  if (videoUrl) failedLocalPlaybackVideoUrls[videoUrl] = true;
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

  const oldHandler = localPlaybackErrorHandlers.get(video);
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
  activeLocalPlaybackVideoUrl = videoUrl;
  activeLocalPlaybackSourceUrl = sourceUrl;
  activeLocalPlaybackThumbnailVttUrl = thumbnailVttUrl;
  activeLocalPlaybackSourcePageChineseSubtitleNotice = sourcePageNotice.sourcePageChineseSubtitleNotice;

  const handler = function () {
    markLocalPlaybackFailed(video);
  };
  localPlaybackErrorHandlers.set(video, handler);
  video.addEventListener('error', handler, { once: true });

  restoreLocalPlaybackTimeline(video, resumeTime, playbackRate, wasPlaying);

  try {
    video.load();
  } catch (error) {}

  void installLocalPlaybackPreview(video, thumbnailVttUrl);
}

async function applyLocalPlaybackSource() {
  localPlaybackScanTimer = null;
  const videoUrl = currentVideoUrl();
  const sequence = ++localPlaybackRequestSequence;

  if (!videoUrl) {
    restoreLocalPlaybackVideos();
    return;
  }
  if (failedLocalPlaybackVideoUrls[videoUrl]) return;

  const sourcePageNotice = readCurrentLocalPlaybackSourcePageNotice();
  if (
    activeLocalPlaybackVideoUrl === videoUrl &&
    activeLocalPlaybackSourceUrl &&
    activeLocalPlaybackSourcePageChineseSubtitleNotice === sourcePageNotice.sourcePageChineseSubtitleNotice &&
    !failedLocalPlaybackSources[activeLocalPlaybackSourceUrl]
  ) {
    const activeVideo = mainVideoElement();
    if (activeVideo) {
      setLocalPlaybackSource(
        activeVideo,
        videoUrl,
        activeLocalPlaybackSourceUrl,
        activeLocalPlaybackThumbnailVttUrl,
        sourcePageNotice
      );
    }
    return;
  }

  let result: LocalPlaybackSourceResult;
  try {
    result = (await ipcRenderer.invoke('download:local-playback-source', {
      videoUrl: videoUrl,
      sourcePageChineseSubtitleNotice: sourcePageNotice.sourcePageChineseSubtitleNotice,
      sourcePageSubtitleNoticeText: sourcePageNotice.sourcePageSubtitleNoticeText
    })) as LocalPlaybackSourceResult;
  } catch (error) {
    return;
  }

  if (sequence !== localPlaybackRequestSequence || currentVideoUrl() !== videoUrl) return;

  if (!localPlaybackSourceIsAvailable(result)) {
    handleLocalPlaybackUnavailable(videoUrl);
    return;
  }

  if (failedLocalPlaybackSources[result.sourceUrl]) return;

  const video = mainVideoElement();
  if (!video) return;

  setLocalPlaybackSource(video, result.videoUrl, result.sourceUrl, result.thumbnailVttUrl, sourcePageNotice);
}

function scheduleLocalPlaybackSourceCheck() {
  if (localPlaybackScanTimer) return;
  localPlaybackScanTimer = setTimeout(applyLocalPlaybackSource, LOCAL_PLAYBACK_SCAN_DELAY_MS);
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
  ipcRenderer.on('downloads-changed', function (_event, records) {
    for (const videoUrl in failedLocalPlaybackVideoUrls) delete failedLocalPlaybackVideoUrls[videoUrl];

    if (activeLocalPlaybackVideoUrl && activeLocalPlaybackSourceUrl) {
      const state = downloadRecordStateForVideo(downloadRecordStateSnapshots(records), activeLocalPlaybackVideoUrl);
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

function hlsProxyMessageData(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function installHlsPlaylistProxyBridge() {
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;

    const data = hlsProxyMessageData(event.data);
    if (!data || data.source !== HLS_PROXY_MESSAGE_SOURCE || data.type !== HLS_PROXY_REQUEST_MESSAGE) return;

    const requestId = typeof data.requestId === 'string' ? data.requestId : '';
    const playlistUrl = typeof data.playlistUrl === 'string' ? data.playlistUrl : '';
    const currentVideo = readCurrentVideoDetails();
    const sourcePageNotice = readCurrentLocalPlaybackSourcePageNotice();
    const title = (currentVideo && currentVideo.title) || cleanVideoTitle(data.title) || '';
    const videoUrl = typeof data.videoUrl === 'string' ? data.videoUrl : '';
    if (!requestId || !playlistUrl || !videoUrl) return;

    ipcRenderer
      .invoke('hls:playlist-proxy-url', {
        playlistUrl: playlistUrl,
        pageLoadId: hlsPlaybackPageLoadId,
        title: title,
        views: currentVideo ? currentVideo.views : null,
        likes: currentVideo ? currentVideo.likes : null,
        img: currentVideo ? currentVideo.img : null,
        preview: currentVideo ? currentVideo.preview : null,
        sourcePageChineseSubtitleNotice: sourcePageNotice.sourcePageChineseSubtitleNotice,
        sourcePageSubtitleNoticeText: sourcePageNotice.sourcePageSubtitleNoticeText,
        videoUrl: videoUrl
      })
      .then(function (result: HlsPlaylistProxyUrlResult) {
        window.postMessage(
          {
            source: HLS_PROXY_MESSAGE_SOURCE,
            type: HLS_PROXY_RESPONSE_MESSAGE,
            requestId: requestId,
            result: result
          },
          '*'
        );
      })
      .catch(function (error) {
        window.postMessage(
          {
            source: HLS_PROXY_MESSAGE_SOURCE,
            type: HLS_PROXY_RESPONSE_MESSAGE,
            requestId: requestId,
            result: {
              available: false,
              reason: error instanceof Error ? error.message : String(error)
            }
          },
          '*'
        );
      });
  });
}

function hlsPlaylistProxyPageScript() {
  return (
    '(' +
    function (
      messageSource: string,
      requestMessageType: string,
      responseMessageType: string,
      requestTimeoutMs: number
    ) {
      const windowRecord = window as unknown as Record<string, unknown>;
      if (windowRecord.__jableDesktopHlsProxyInstalled) return;
      windowRecord.__jableDesktopHlsProxyInstalled = true;

      let nextRequestId = 1;
      const pending: Record<
        string,
        {
          resolve(value: string | null): void;
          timer: ReturnType<typeof setTimeout>;
        }
      > = {};

      function currentPageVideoUrl() {
        try {
          const parsed = new URL(location.href);
          if (!/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return '';
          if (!/\/$/.test(parsed.pathname)) parsed.pathname += '/';
          parsed.search = '';
          parsed.hash = '';
          return parsed.href;
        } catch (error) {
          return '';
        }
      }

      function remotePlaylistUrl(value: unknown) {
        try {
          const parsed = new URL(String(value || ''), location.href);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
          if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') return '';
          return parsed.pathname.toLowerCase().indexOf('.m3u8') !== -1 ? parsed.href : '';
        } catch (error) {
          return '';
        }
      }

      function requestProxyUrl(playlistUrl: string) {
        const videoUrl = currentPageVideoUrl();
        if (!videoUrl) return Promise.resolve(null);

        const requestId = 'hls-proxy-' + nextRequestId++;
        return new Promise<string | null>(function (resolve) {
          const timer = setTimeout(function () {
            delete pending[requestId];
            resolve(null);
          }, requestTimeoutMs);

          pending[requestId] = {
            resolve: resolve,
            timer: timer
          };

          window.postMessage(
            {
              source: messageSource,
              type: requestMessageType,
              requestId: requestId,
              playlistUrl: playlistUrl,
              title: document.title || '',
              videoUrl: videoUrl
            },
            '*'
          );
        });
      }

      window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.source !== messageSource || data.type !== responseMessageType) return;

        const requestId = typeof data.requestId === 'string' ? data.requestId : '';
        const pendingRequest = pending[requestId];
        if (!pendingRequest) return;

        clearTimeout(pendingRequest.timer);
        delete pending[requestId];

        const result = data.result;
        pendingRequest.resolve(
          result && result.available && typeof result.sourceUrl === 'string' ? result.sourceUrl : null
        );
      });

      const nativeFetch = window.fetch;
      if (typeof nativeFetch === 'function') {
        window.fetch = function (...fetchArguments: Parameters<typeof window.fetch>) {
          const self = this;
          const input = fetchArguments[0];
          const init = fetchArguments[1];
          const playlistUrl = remotePlaylistUrl(input instanceof Request ? input.url : input);
          if (!playlistUrl) return nativeFetch.apply(self, fetchArguments);

          return requestProxyUrl(playlistUrl).then(function (sourceUrl) {
            if (!sourceUrl) return nativeFetch.apply(self, fetchArguments);
            if (input instanceof Request) {
              return nativeFetch.call(self, sourceUrl, init);
            }
            return nativeFetch.call(self, sourceUrl, init);
          });
        };
      }

      const nativeOpen = XMLHttpRequest.prototype.open as (...args: unknown[]) => void;
      const nativeSend = XMLHttpRequest.prototype.send as (...args: unknown[]) => void;
      const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
      const nativeOverrideMimeType = XMLHttpRequest.prototype.overrideMimeType;

      XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...openArguments: unknown[]) {
        const method = String(openArguments[0] || '');
        const url = openArguments[1] as string | URL;
        const async = openArguments[2] as boolean | undefined;
        const username = openArguments[3] as string | null | undefined;
        const password = openArguments[4] as string | null | undefined;
        const playlistUrl = remotePlaylistUrl(url);
        if (!playlistUrl || async === false) {
          return nativeOpen.apply(this, openArguments);
        }

        (this as unknown as Record<string, unknown>).__jableDesktopHlsProxyOpen = {
          async: async,
          headers: [],
          method: method,
          mimeType: null,
          password: password,
          playlistUrl: playlistUrl,
          username: username
        };
      } as typeof XMLHttpRequest.prototype.open;

      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        const state = (this as unknown as Record<string, unknown>).__jableDesktopHlsProxyOpen as
          | { headers: Array<[string, string]> }
          | undefined;
        if (state) {
          state.headers.push([name, value]);
          return;
        }

        return nativeSetRequestHeader.call(this, name, value);
      };

      XMLHttpRequest.prototype.overrideMimeType = function (mimeType) {
        const state = (this as unknown as Record<string, unknown>).__jableDesktopHlsProxyOpen as
          | { mimeType: string | null }
          | undefined;
        if (state) {
          state.mimeType = mimeType;
          return;
        }

        return nativeOverrideMimeType.call(this, mimeType);
      };

      XMLHttpRequest.prototype.send = function (...sendArguments: unknown[]) {
        const body = sendArguments[0] as unknown;
        const xhr = this;
        const state = (xhr as unknown as Record<string, unknown>).__jableDesktopHlsProxyOpen as
          | {
              async?: boolean;
              headers: Array<[string, string]>;
              method: string;
              mimeType: string | null;
              password?: string | null;
              playlistUrl: string;
              username?: string | null;
            }
          | undefined;
        if (!state) return nativeSend.apply(xhr, sendArguments);

        delete (xhr as unknown as Record<string, unknown>).__jableDesktopHlsProxyOpen;
        const responseType = xhr.responseType;
        const timeout = xhr.timeout;
        const withCredentials = xhr.withCredentials;

        requestProxyUrl(state.playlistUrl).then(function (sourceUrl) {
          nativeOpen.call(
            xhr,
            state.method,
            sourceUrl || state.playlistUrl,
            typeof state.async === 'undefined' ? true : state.async,
            state.username || null,
            state.password || null
          );
          xhr.timeout = timeout;
          xhr.withCredentials = withCredentials;
          if (responseType) xhr.responseType = responseType;
          if (state.mimeType) nativeOverrideMimeType.call(xhr, state.mimeType);
          for (let i = 0; i < state.headers.length; i++) {
            nativeSetRequestHeader.call(xhr, state.headers[i][0], state.headers[i][1]);
          }
          nativeSend.call(xhr, body || null);
        });
      };
    }.toString() +
    ')(' +
    JSON.stringify(HLS_PROXY_MESSAGE_SOURCE) +
    ',' +
    JSON.stringify(HLS_PROXY_REQUEST_MESSAGE) +
    ',' +
    JSON.stringify(HLS_PROXY_RESPONSE_MESSAGE) +
    ',' +
    String(HLS_PROXY_PAGE_REQUEST_TIMEOUT_MS) +
    ');'
  );
}

function injectHlsPlaylistProxyPageScript() {
  const script = document.createElement('script');
  script.textContent = hlsPlaylistProxyPageScript();
  (document.documentElement || document.head || document).appendChild(script);
  script.remove();
}

function installHlsPlaylistProxyInterception() {
  installHlsPlaylistProxyBridge();
  injectHlsPlaylistProxyPageScript();
}

function markHlsPlaybackUserGesture(event: Event) {
  const target = event.target;
  if (target instanceof HTMLElement && target.matches(THEATER_MODE_EDITABLE_SHORTCUT_SELECTOR)) return;
  lastHlsPlaybackUserGestureAt = Date.now();
}

function hlsPlaybackWasUserInitiated() {
  return Date.now() - lastHlsPlaybackUserGestureAt <= HLS_PLAYBACK_USER_GESTURE_TTL_MS;
}

function notifyHlsPlaybackStarted() {
  const videoUrl = currentVideoUrl();
  const userInitiatedPlayback = hlsPlaybackWasUserInitiated();
  if (
    !videoUrl ||
    (videoUrl === lastHlsPlaybackStartedVideoUrl && (!userInitiatedPlayback || lastHlsPlaybackStartedUserInitiated))
  ) {
    return;
  }

  lastHlsPlaybackStartedVideoUrl = videoUrl;
  lastHlsPlaybackStartedUserInitiated = userInitiatedPlayback;
  const currentVideo = readCurrentVideoDetails();
  const sourcePageNotice = readCurrentLocalPlaybackSourcePageNotice();
  ipcRenderer.send('hls:playback-started', {
    videoUrl: videoUrl,
    pageLoadId: hlsPlaybackPageLoadId,
    userInitiatedPlayback: userInitiatedPlayback,
    title: currentVideo ? currentVideo.title : null,
    views: currentVideo ? currentVideo.views : null,
    likes: currentVideo ? currentVideo.likes : null,
    img: currentVideo ? currentVideo.img : null,
    preview: currentVideo ? currentVideo.preview : null,
    sourcePageChineseSubtitleNotice: sourcePageNotice.sourcePageChineseSubtitleNotice,
    sourcePageSubtitleNoticeText: sourcePageNotice.sourcePageSubtitleNoticeText
  });
}

function installHlsPlaybackStartedObserver() {
  document.addEventListener('pointerdown', markHlsPlaybackUserGesture, true);
  document.addEventListener('click', markHlsPlaybackUserGesture, true);
  document.addEventListener('touchstart', markHlsPlaybackUserGesture, true);
  document.addEventListener('keydown', markHlsPlaybackUserGesture, true);
  document.addEventListener(
    'play',
    function (event) {
      if (event.target instanceof HTMLVideoElement) notifyHlsPlaybackStarted();
    },
    true
  );
  document.addEventListener(
    'playing',
    function (event) {
      if (event.target instanceof HTMLVideoElement) notifyHlsPlaybackStarted();
    },
    true
  );
}

function readVideoDetailsForActionElement(
  el: Element | null,
  collectionKey?: CollectionKey | null
): ScrapedVideoRow | null {
  const box = el && typeof el.closest === 'function' ? el.closest('div.video-img-box') : null;
  const row = scrapeVideoBox(box);
  if (row && collectionKeyForCurrentLocation() === collectionKey) row.siteOrder = siteOrderForVideoBox(box);

  return row || readCurrentVideoDetails();
}

function findCollectionActionElement(collectionKey: CollectionKey) {
  const elements = document.querySelectorAll<Element>('button.btn-action, .action[data-fav-video-id]');

  for (let i = 0; i < elements.length; i++) {
    if (collectionKeyForActionElement(elements[i]) === collectionKey) return elements[i];
  }

  return null;
}

function hasPendingCollectionOperations() {
  return Boolean(
    (pendingCollectionOperations.favourites && pendingCollectionOperations.favourites.length) ||
    (pendingCollectionOperations.watch_later && pendingCollectionOperations.watch_later.length)
  );
}

function pendingOperationMatchesActionElement(
  operation: PendingCollectionOperation,
  collectionKey: CollectionKey,
  actionElement: Element
) {
  const remoteVideoId = remoteVideoIdForActionElement(actionElement);
  if (remoteVideoId && operation.remoteVideoId === remoteVideoId) {
    const remoteFavType = remoteFavTypeForActionElement(actionElement, collectionKey);
    return !operation.remoteFavType || operation.remoteFavType === remoteFavType;
  }

  const row = readVideoDetailsForActionElement(actionElement, collectionKey);
  return row ? videoPathKey(row.url, location.href) === videoPathKey(operation.videoUrl, location.href) : false;
}

function pendingCollectionOperationForActionElement(collectionKey: CollectionKey, actionElement: Element) {
  const operations = pendingCollectionOperations[collectionKey] || [];

  for (let i = operations.length - 1; i >= 0; i--) {
    if (pendingOperationMatchesActionElement(operations[i], collectionKey, actionElement)) return operations[i];
  }

  return null;
}

function applyPendingCollectionOperationsToPage() {
  pendingCollectionOverlayTimer = null;
  if (!hasPendingCollectionOperations()) return;

  const actionElements = document.querySelectorAll<Element>('button.btn-action, .action[data-fav-video-id]');

  for (let i = 0; i < actionElements.length; i++) {
    const collectionKey = collectionKeyForActionElement(actionElements[i]);
    if (!collectionKey) continue;

    const operation = pendingCollectionOperationForActionElement(collectionKey, actionElements[i]);
    if (!operation) continue;

    applyQueuedCollectionVisualState(collectionKey, actionElements[i], operation.action);
  }
}

function scheduleApplyPendingCollectionOperations() {
  if (!hasPendingCollectionOperations()) return;
  if (pendingCollectionOverlayTimer) return;
  pendingCollectionOverlayTimer = setTimeout(applyPendingCollectionOperationsToPage, 0);
}

function installPendingCollectionOperationOverlay() {
  scheduleApplyPendingCollectionOperations();
  document.addEventListener('DOMContentLoaded', scheduleApplyPendingCollectionOperations, { once: true });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleApplyPendingCollectionOperations();
  });
  window.addEventListener('focus', scheduleApplyPendingCollectionOperations);
  window.addEventListener('pageshow', scheduleApplyPendingCollectionOperations);
  window.addEventListener('load', scheduleApplyPendingCollectionOperations, { once: true });

  if (typeof MutationObserver === 'undefined') return;

  const target = document.documentElement || document;
  const observer = new MutationObserver(function (records) {
    for (let i = 0; i < records.length; i++) {
      if (records[i].type === 'childList' && (records[i].addedNodes.length || records[i].removedNodes.length)) {
        scheduleApplyPendingCollectionOperations();
        return;
      }
    }
  });
  observer.observe(target, {
    childList: true,
    subtree: true
  });
}

function collectionActionActiveState(collectionKey: CollectionKey, originalElement: Element | null) {
  const el =
    originalElement && document.documentElement.contains(originalElement)
      ? originalElement
      : findCollectionActionElement(collectionKey);

  return el ? el.classList.contains('active') : null;
}

function findMatchingCollectionActionElement(originalElement: Element | null) {
  if (!originalElement) return null;

  const videoId = originalElement.getAttribute('data-fav-video-id') || '';
  const favType = originalElement.getAttribute('data-fav-type') || '';
  if (!videoId) return null;

  const elements = document.querySelectorAll<Element>('.action[data-fav-video-id]');

  for (let i = 0; i < elements.length; i++) {
    if (elements[i].getAttribute('data-fav-video-id') !== videoId) continue;
    if (favType && elements[i].getAttribute('data-fav-type') !== favType) continue;
    return elements[i];
  }

  return null;
}

function collectionListRemovedState(originalElement: Element | null) {
  const el =
    originalElement && document.documentElement.contains(originalElement)
      ? originalElement
      : findMatchingCollectionActionElement(originalElement);
  const imgBox = el && typeof el.closest === 'function' ? el.closest('div.img-box') : null;

  return imgBox ? imgBox.classList.contains('removed') : null;
}

function collectionActionMatchesState(
  collectionKey: CollectionKey,
  originalElement: Element | null,
  action: CollectionAction
) {
  if (collectionListActionForElement(originalElement)) {
    return collectionListRemovedState(originalElement) === (action === 'remove');
  }

  return collectionActionActiveState(collectionKey, originalElement) === (action === 'add');
}

function waitForCollectionActionState(
  collectionKey: CollectionKey,
  originalElement: Element | null,
  action: CollectionAction
) {
  return new Promise<boolean>(function (resolve) {
    const target = document.body || document.documentElement;
    const deadline = Date.now() + COLLECTION_TOGGLE_CONFIRM_TIMEOUT_MS;
    let observer: MutationObserver | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    function finish(ok: boolean) {
      if (done) return;
      done = true;
      if (observer) observer.disconnect();
      if (pollTimer) clearTimeout(pollTimer);
      resolve(ok);
    }

    function check() {
      if (done) return;

      if (collectionActionMatchesState(collectionKey, originalElement, action)) {
        finish(true);
        return;
      }

      if (Date.now() > deadline) {
        finish(false);
        return;
      }

      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(check, COLLECTION_TOGGLE_CONFIRM_POLL_MS);
    }

    observer = new MutationObserver(check);
    observer.observe(target, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });
    setTimeout(check, 0);
  });
}

async function applyCollectionToggle(collectionKey: CollectionKey, action: CollectionAction, video: ScrapedVideoRow) {
  try {
    await ipcRenderer.invoke('db:apply-collection-toggle', {
      collectionKey: collectionKey,
      action: action,
      video: video,
      sourceUrl: location.href
    });
  } catch (error) {
    console.warn('[JableDesktopScraper] collection toggle sync failed', error);
  }
}

function videoForCollectionToggleOperation(
  video: ScrapedVideoRow,
  actionElement: Element | null,
  action: CollectionAction
) {
  if (action === 'add' && collectionListActionForElement(actionElement) === 'add') {
    return Object.assign({}, video, { siteOrder: null });
  }

  return video;
}

async function queueCollectionToggle(
  collectionKey: CollectionKey,
  action: CollectionAction,
  video: ScrapedVideoRow,
  actionElement: Element | null,
  syncLock: ActiveSyncLock
) {
  const rollbackAction = action === 'add' ? 'remove' : 'add';
  const queuedVideo = videoForCollectionToggleOperation(video, actionElement, action);
  applyQueuedCollectionVisualState(collectionKey, actionElement, action);

  try {
    return await ipcRenderer.invoke('db:apply-collection-toggle', {
      collectionKey: collectionKey,
      action: action,
      deferRemote: true,
      remoteVideoId: remoteVideoIdForActionElement(actionElement),
      remoteFavType: remoteFavTypeForActionElement(actionElement, collectionKey),
      syncRunId: syncLock.syncRunId,
      video: queuedVideo,
      sourceUrl: location.href
    });
  } catch (error) {
    applyQueuedCollectionVisualState(collectionKey, actionElement, rollbackAction);
    console.warn('[JableDesktopScraper] collection toggle queue failed', error);
    return null;
  }
}

async function handleCollectionButtonClick(event: MouseEvent) {
  if (!event.isTrusted || event.defaultPrevented) return;

  const actionElement = closestCollectionActionElement(event.target);
  const collectionKey = collectionKeyForActionElement(actionElement);
  if (!collectionKey || actionRequiresLogin(actionElement)) return;

  const video = readVideoDetailsForActionElement(actionElement, collectionKey);
  if (!video) return;

  const action = collectionActionForElement(actionElement);
  const syncLock = activeSyncLockForCollection(collectionKey);

  if (syncLock) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    await queueCollectionToggle(collectionKey, action, video, actionElement, syncLock);
    return;
  }

  if (await waitForCollectionActionState(collectionKey, actionElement, action)) {
    const toggledVideo = readVideoDetailsForActionElement(actionElement, collectionKey) || video;
    await applyCollectionToggle(
      collectionKey,
      action,
      videoForCollectionToggleOperation(toggledVideo, actionElement, action)
    );
  }
}

document.addEventListener('click', handleCollectionButtonClick, { capture: true });

async function syncCollection(options?: Partial<SyncBrowserCollectionOptions> | null): Promise<SyncResult> {
  const syncOptions = options || {};

  const collectionKey = syncOptions.collectionKey as CollectionKey;
  const mode: SyncMode = syncOptions.mode || 'quick';
  const syncRunId = syncOptions.syncRunId || '';
  const siteOrderOffset = Number(syncOptions.siteOrderOffset) || 0;
  const startPage = Number(syncOptions.startPage) || null;
  const batchLimit = Number(syncOptions.batchLimit) || null;
  const ajaxWindowSize = normalizeAjaxWindowSize(syncOptions.ajaxWindowSize);
  let totalRows = 0;
  let totalPages = 0;
  let logicalPage = currentPageNumber() || startPage || 1;
  let lastScrapedPage: number | null = null;
  let lastKnownUrl: string | null = null;
  let stoppedByKnownPage = false;
  let incompleteReason: string | null = null;
  let ajaxFallbackReason: string | null = null;
  let ajaxRetryCount = 0;
  let preferFetchPager = false;

  function result(completed: boolean): SyncResult {
    return {
      completed: completed,
      mode: mode,
      syncRunId: syncRunId,
      incompleteReason: completed ? null : incompleteReason,
      stoppedByKnownPage: stoppedByKnownPage,
      totalPages: totalPages,
      totalRows: totalRows,
      lastScrapedPage: lastScrapedPage,
      lastKnownUrl: lastKnownUrl,
      ajaxFallbackReason: ajaxFallbackReason,
      ajaxRetryCount: ajaxRetryCount
    };
  }

  async function checkRowsKnown(rows: ScrapedVideoRow[]) {
    if (!syncOptions.stopOnKnownPage || !rows.length) return false;

    const urls: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      urls.push(rows[i].url);
    }

    try {
      return await ipcRenderer.invoke('db:collection-urls-known', {
        collectionKey: collectionKey,
        urls: urls
      });
    } catch (error) {
      console.warn('[JableDesktopScraper] known URL check failed; continuing sync', error);
      return false;
    }
  }

  async function saveRowsForPage(rows: ScrapedVideoRow[], pageNumber: number | null | undefined, pageUrl: string) {
    rows = uniqByUrl(rows);
    lastScrapedPage = pageNumber || logicalPage || currentPageNumber() || 1;
    logicalPage = lastScrapedPage;

    for (let r = 0; r < rows.length; r++) {
      rows[r].siteOrder = siteOrderOffset + totalRows + r + 1;
    }

    totalRows += rows.length;
    totalPages++;

    if (rows.length) lastKnownUrl = rows[rows.length - 1].url;

    const allKnown = await checkRowsKnown(rows);

    const payload = {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      page: lastScrapedPage,
      rows: rows,
      url: pageUrl
    };

    await ipcRenderer.invoke('db:save-sync-page', payload);
    sendProgress('sync-page', payload);

    if (allKnown) {
      stoppedByKnownPage = true;
      return true;
    }

    return false;
  }

  async function recordCurrentPage(pageNumber?: number | null) {
    return saveRowsForPage(scrapeCurrentPage(), pageNumber, location.href);
  }

  async function syncRemainingPagesWithAjaxPrefetch(firstPageRows: ScrapedVideoRow[], firstPageSignature: string) {
    if (mode !== 'full' || startPage || batchLimit || syncOptions.stopOnKnownPage) return false;
    if ((logicalPage || 1) !== 1) return false;

    const links = readPagerLinks();
    const next = chooseNextPagerLink(links, logicalPage);
    const lastPage = lastPagerPageNumberFrom(document);
    if (!next || !next.ajaxUrl || !next.pageParamName || !lastPage || lastPage <= (logicalPage || 1)) return false;

    try {
      const pages = await fetchAjaxPagesWithWindow({
        end: lastPage,
        fetchPage: function (pageNumber) {
          return fetchAjaxSyncPageForTemplate(next, pageNumber, lastPage, function (retry) {
            ajaxRetryCount++;
            sendProgress('sync-progress', {
              collectionKey: collectionKey,
              mode: mode,
              syncRunId: syncRunId,
              page: retry.pageNumber,
              message: 'ajax-page-retry',
              reason: retry.reason,
              attempt: retry.attempt,
              maxRetries: retry.maxRetries,
              delayMs: retry.delayMs
            });
          });
        },
        onPageStart: function (pageNumber) {
          sendProgress('sync-progress', {
            collectionKey: collectionKey,
            mode: mode,
            syncRunId: syncRunId,
            page: pageNumber,
            message: 'ajax-page-loading'
          });
        },
        start: (logicalPage || 1) + 1,
        windowSize: ajaxWindowSize
      });
      const firstPageCheck = await fetchAjaxSyncPageForTemplate(next, 1, lastPage, function (retry) {
        ajaxRetryCount++;
        sendProgress('sync-progress', {
          collectionKey: collectionKey,
          mode: mode,
          syncRunId: syncRunId,
          page: retry.pageNumber,
          message: 'ajax-page-retry',
          reason: retry.reason,
          attempt: retry.attempt,
          maxRetries: retry.maxRetries,
          delayMs: retry.delayMs
        });
      });

      validateAjaxFirstPage(firstPageRows, firstPageSignature, firstPageCheck);
      validateAjaxPages(firstPageRows, pages);

      for (let i = 0; i < pages.length; i++) {
        await saveRowsForPage(pages[i].rows, pages[i].pageNumber, pages[i].url);
      }

      return true;
    } catch (error) {
      ajaxFallbackReason = ajaxFailureDetail(error);
      sendProgress('sync-progress', {
        collectionKey: collectionKey,
        mode: mode,
        syncRunId: syncRunId,
        page: logicalPage || 1,
        message: 'ajax-prefetch-fallback',
        reason: ajaxFallbackReason
      });
      console.warn(
        '[JableDesktopScraper] ajax prefetch failed; falling back to sequential paging',
        ajaxFallbackReason,
        error
      );
      return false;
    }
  }

  async function loadNextPage() {
    const links = readPagerLinks();
    const next = chooseNextPagerLink(links, logicalPage);
    if (!next) return 'done';

    const changed = await clickOrFetchPagerLink(next, preferFetchPager);

    if (!changed) {
      incompleteReason = 'page-unchanged';
      return 'failed';
    }

    preferFetchPager = Boolean(next.ajaxUrl);
    logicalPage = next.pageNumber || currentPageNumber() || logicalPage;

    sendProgress('sync-progress', {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      page: logicalPage,
      message: 'page-loaded'
    });

    return 'loaded';
  }

  async function ensureFirstPage() {
    const pageNumber = currentPageNumber();
    logicalPage = pageNumber || logicalPage || 1;

    if (pageNumber === 1) return true;

    const first = chooseFirstPagerLink(readPagerLinks());
    if (!first) {
      incompleteReason = 'first-page-unavailable';
      return false;
    }

    const changed = await clickOrFetchPagerLink(first, preferFetchPager);
    if (!changed) {
      if (currentPageNumber() === 1) {
        logicalPage = 1;
        return true;
      }

      incompleteReason = 'first-page-unchanged';
      return false;
    }

    preferFetchPager = Boolean(first.ajaxUrl);
    logicalPage = 1;

    sendProgress('sync-progress', {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      page: logicalPage,
      message: 'first-page-loaded'
    });

    return true;
  }

  if (!startPage && !(await ensureFirstPage())) {
    return result(false);
  }

  if (startPage && logicalPage <= startPage) {
    const nextState = await loadNextPage();
    if (nextState === 'failed') return result(false);
    if (nextState === 'done') return result(true);
  }

  const firstPageRows = uniqByUrl(scrapeCurrentPage());
  const firstPageSignature = signature();
  if (await saveRowsForPage(firstPageRows, null, location.href)) {
    return result(true);
  }

  if (batchLimit && totalPages >= batchLimit) {
    if (chooseNextPagerLink(readPagerLinks(), logicalPage)) {
      incompleteReason = 'batch-limit';
      return result(false);
    }

    return result(true);
  }

  if (await syncRemainingPagesWithAjaxPrefetch(firstPageRows, firstPageSignature)) {
    return result(true);
  }

  while (true) {
    const nextState = await loadNextPage();
    if (nextState === 'done') break;
    if (nextState === 'failed') return result(false);

    if (await recordCurrentPage(logicalPage)) return result(true);
    if (batchLimit && totalPages >= batchLimit) {
      if (chooseNextPagerLink(readPagerLinks(), logicalPage)) {
        incompleteReason = 'batch-limit';
        return result(false);
      }

      break;
    }

    await new Promise(function (resolve) {
      setTimeout(resolve, 500 + Math.random() * 500);
    });
  }

  return result(true);
}

async function applyDeferredSyncOperationOnce(operation: DeferredSyncOperation, baseUrl: string) {
  if (!operation.remoteVideoId) throw new Error('Missing remote video id');

  const params = new URLSearchParams();
  params.set('mode', 'async');
  params.set('format', 'json');
  params.set('action', operation.action === 'remove' ? 'delete_from_favourites' : 'add_to_favourites');
  params.set('video_id', operation.remoteVideoId);
  params.append('video_ids[]', operation.remoteVideoId);
  params.set('fav_type', operation.remoteFavType || '0');
  params.set('playlist_id', '0');

  const response = await fetch(baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + params.toString(), {
    cache: 'no-store',
    credentials: 'same-origin',
    method: 'GET'
  });
  const text = await response.text();
  let body: { status?: unknown; errors?: Array<{ code?: unknown }> } | null = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {}

  if (!response.ok) throw new Error('HTTP ' + response.status);
  if (body && body.status === 'failure') {
    const code = body.errors && body.errors[0] && body.errors[0].code;
    throw new Error(String(code || 'Remote operation failed'));
  }
}

async function applyDeferredSyncOperationWithSingleRetry(operation: DeferredSyncOperation, baseUrl: string) {
  try {
    await applyDeferredSyncOperationOnce(operation, baseUrl);
  } catch (error) {
    await applyDeferredSyncOperationOnce(operation, baseUrl);
  }
}

function deferredSyncOperationFailure(
  operation: DeferredSyncOperation,
  message: string,
  blocked: boolean
): DeferredSyncOperationApplyFailure {
  return {
    id: operation.id,
    url: String(operation.videoUrl || ''),
    message: message,
    blocked: blocked
  };
}

async function applyDeferredSyncOperations(operations: DeferredSyncOperation[]) {
  const applied: number[] = [];
  const failed: DeferredSyncOperationApplyFailure[] = [];
  const baseUrl = String(location.href || '').split('#')[0];

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];

    try {
      await applyDeferredSyncOperationWithSingleRetry(operation, baseUrl);
      applied.push(operation.id);
    } catch (error) {
      failed.push(
        deferredSyncOperationFailure(operation, error instanceof Error ? error.message : String(error), false)
      );

      for (let blocked = i + 1; blocked < operations.length; blocked++) {
        failed.push(deferredSyncOperationFailure(operations[blocked], 'Blocked by earlier failed operation', true));
      }

      break;
    }
  }

  return {
    applied: applied,
    failed: failed
  };
}

ipcRenderer.on('browser:sync-collection-request', function (_event, payload: unknown) {
  const requestId = requestIdFromPayload(payload);
  if (!requestId) return;

  syncCollection(syncOptionsFromPayload(payload))
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

  applyDeferredSyncOperations(operations as DeferredSyncOperation[])
    .then(function (result) {
      sendPreloadResponse(requestId, result);
    })
    .catch(function (error) {
      sendPreloadError(requestId, error);
    });
});

ipcRenderer.on('browser:sync-lock-state', function (_event, payload: unknown) {
  updateActiveSyncLocks(payload);
});

ipcRenderer.on('browser:pending-collection-operations', function (_event, payload: unknown) {
  updatePendingCollectionOperations(payload);
});

ipcRenderer
  .invoke('browser:active-sync-runs')
  .then(updateActiveSyncLocks)
  .catch(function () {});

ipcRenderer
  .invoke('browser:pending-collection-operations')
  .then(updatePendingCollectionOperations)
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
    const result = setTheaterMode(enabled, true);
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
    sendPreloadResponse(requestId, {
      enabled: theaterModePreferred,
      applied: Boolean(theaterModeAppliedElement),
      videoUrl: currentVideoUrl()
    });
  } catch (error) {
    sendPreloadError(requestId, error);
  }
});

ipcRenderer.on('browser:apply-theater-mode', function (_event, payload: unknown) {
  const enabled = !isRecord(payload) || payload.enabled !== false;

  try {
    setTheaterMode(enabled, false);
  } catch (error) {}
});

ipcRenderer.on('browser:leave-theater-mode', function () {
  const result = setTheaterMode(false, false);
  sendTheaterModeChanged(result);
});

installHlsPlaylistProxyInterception();
installHlsPlaybackStartedObserver();
installPendingCollectionOperationOverlay();
installWebViewContentRules();
installVideoMetadataRefresh();
installLocalPlaybackReplacement();
installTheaterModeController();
