'use strict';

import type * as Electron from 'electron';
import type {
  BrowserDiagnosis,
  CollectionKey,
  ScrapedVideoRow,
  SyncBrowserCollectionOptions,
  SyncMode,
  SyncResult
} from './types/jable';

type CollectionAction = 'add' | 'remove';
type TrackpadHistoryDirection = 'back' | 'forward';
type PagerLink = {
  el: HTMLAnchorElement;
  id: string;
  label: string;
  pageNumber: number | null;
};
type SendToHostIpcRenderer = Electron.IpcRenderer & {
  sendToHost?: (channel: string, ...args: unknown[]) => void;
};
type ChooseNextPagerLink = (links: PagerLink[], currentPage: number | null) => PagerLink | null;
type UrlPolicyModule = {
  isTrustedJableUrl(value: unknown): boolean;
};

const electron: typeof Electron = require('electron');
const ipcRenderer = electron.ipcRenderer as SendToHostIpcRenderer;
const chooseNextPagerLink = (require('./sync-utils') as { chooseNextPagerLink: ChooseNextPagerLink })
  .chooseNextPagerLink;
const urlPolicy = require('./url-policy') as UrlPolicyModule;

const IS_MACOS = process.platform === 'darwin';
const SEL_LIST_CONTAINER = '#list_videos_my_favourite_videos';
const SEL_TITLES = 'div.detail h6.title a';
const SEL_PAGER = 'ul.pagination';
const SEL_PAGER_LINKS = 'ul.pagination a.page-link';
const SITE_PAGE_SIZE = 24;
const TRACKPAD_HISTORY_THRESHOLD = 180;
const TRACKPAD_HISTORY_COOLDOWN_MS = 700;
const TRACKPAD_HISTORY_RESET_MS = 180;
const COLLECTION_TOGGLE_CONFIRM_TIMEOUT_MS = 4000;
const COLLECTION_TOGGLE_CONFIRM_POLL_MS = 120;
let trackpadHistoryDeltaX = 0;
let trackpadHistoryLastSentAt = 0;
let trackpadHistoryResetTimer: ReturnType<typeof setTimeout> | null = null;

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node && target.parentElement) return target.parentElement;
  return null;
}

function absUrl(href: string, base?: string) {
  try {
    return new URL(href, base || location.href).href;
  } catch (error) {
    return href;
  }
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

function parseMetricNumber(value: unknown) {
  const number = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return isFinite(number) && number > 0 ? number : null;
}

function inferPreviewFromImageUrl(value: string | null | undefined) {
  if (!value) return null;

  const url = absUrl(value);
  const match = url.match(
    /^(https?:\/\/[^?#]+\/contents\/videos_screenshots\/\d+\/(\d+)\/)(?:preview\.jpg|320x180\/1\.jpg|[^?#]+)(?:[?#].*)?$/
  );

  return match ? match[1] + match[2] + '_preview.mp4' : null;
}

function canonicalVideoHrefFromBox(box: Element | null, fallbackAnchor: HTMLAnchorElement | null) {
  const anchors = box
    ? box.querySelectorAll<HTMLAnchorElement>('div.img-box a[href], div.detail h6.title a[href]')
    : [];

  for (let i = 0; i < anchors.length; i++) {
    const href = anchors[i].getAttribute('href') || '';

    try {
      const parsed = new URL(href, anchors[i].baseURI || location.href);
      if (/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return parsed.href;
    } catch (error) {}
  }

  return fallbackAnchor
    ? absUrl(fallbackAnchor.getAttribute('href') || '', fallbackAnchor.baseURI || location.href)
    : '';
}

function scrapeVideoBox(box: Element | null): ScrapedVideoRow | null {
  if (!box) return null;

  const a = box.querySelector<HTMLAnchorElement>('div.detail h6.title a');
  if (!a) return null;

  const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
  const href = canonicalVideoHrefFromBox(box, a);
  const img = box.querySelector<HTMLImageElement>('div.img-box img');
  const imgSrc = img ? img.getAttribute('data-src') || img.getAttribute('src') || '' : '';
  const previewSrc = img ? img.getAttribute('data-preview') || '' : '';
  let views: number | null = null;
  let likes: number | null = null;
  const sub = box.querySelector('div.detail p.sub-title');

  if (sub) {
    const texts: string[] = [];
    for (let n = 0; n < sub.childNodes.length; n++) {
      const node = sub.childNodes[n];
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) texts.push(text);
      }
    }

    if (texts.length >= 1) views = parseMetricNumber(texts[0]);
    if (texts.length >= 2) likes = parseMetricNumber(texts[1]);
  }

  if (!href) return null;

  return {
    title: title,
    url: absUrl(href),
    views: views,
    likes: likes,
    img: imgSrc ? absUrl(imgSrc) : null,
    preview: previewSrc ? absUrl(previewSrc) : inferPreviewFromImageUrl(imgSrc)
  };
}

function scrapeCurrentPage() {
  const out: ScrapedVideoRow[] = [];
  const boxes = document.querySelectorAll('div.video-img-box');

  for (let i = 0; i < boxes.length; i++) {
    const row = scrapeVideoBox(boxes[i]);
    if (row) out.push(row);
  }

  return out;
}

function normalizePageNumber(value: unknown) {
  const n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return isFinite(n) && n > 0 ? n : 1;
}

function currentPageNumber() {
  const active = document.querySelector<Element>(
    [
      'ul.pagination span.page-link.active',
      'ul.pagination a.page-link.active',
      'ul.pagination .page-item.active .page-link',
      'ul.pagination [aria-current="page"]'
    ].join(', ')
  );
  return active ? normalizePageNumber(active.textContent) : 1;
}

function signature() {
  const list = document.querySelectorAll<HTMLAnchorElement>(SEL_TITLES);
  const count = list.length;
  const first = count ? list[0].getAttribute('href') || '' : '';
  return count + '|' + first;
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
    let pageNumber = /^\d+$/.test(text) ? normalizePageNumber(text) : null;
    const params = anchor.getAttribute('data-parameters') || '';
    const match = params.match(/(?:^|;)from(?:_my_fav_videos)?:\s*(\d+)/);
    let id: string;

    if (match) id = match[1];
    else if (/^\d+$/.test(text)) id = text;
    else id = text || 'a_' + i;

    if (!pageNumber && match) {
      pageNumber = Math.floor(parseInt(match[1], 10) / SITE_PAGE_SIZE) + 1;
    }

    out.push({ el: anchor, id: id, label: text, pageNumber: pageNumber });
  }

  return out;
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

  return null;
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

function cleanVideoTitle(value: unknown) {
  let text = normalizePageText(value);
  if (!text) return null;

  text = text.replace(/\s*[-|]\s*Jable\.TV\s*$/i, '').trim();
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

function readVideoDetailsForActionElement(el: Element | null): ScrapedVideoRow | null {
  const box = el && typeof el.closest === 'function' ? el.closest('div.video-img-box') : null;
  const row = scrapeVideoBox(box);

  return row || readCurrentVideoDetails();
}

function findCollectionActionElement(collectionKey: CollectionKey) {
  const elements = document.querySelectorAll<Element>('button.btn-action, .action[data-fav-video-id]');

  for (let i = 0; i < elements.length; i++) {
    if (collectionKeyForActionElement(elements[i]) === collectionKey) return elements[i];
  }

  return null;
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

async function handleCollectionButtonClick(event: MouseEvent) {
  if (!event.isTrusted || event.defaultPrevented) return;

  const actionElement = closestCollectionActionElement(event.target);
  const collectionKey = collectionKeyForActionElement(actionElement);
  if (!collectionKey || actionRequiresLogin(actionElement)) return;

  const video = readVideoDetailsForActionElement(actionElement);
  if (!video) return;

  const action = collectionActionForElement(actionElement);

  if (await waitForCollectionActionState(collectionKey, actionElement, action)) {
    await applyCollectionToggle(collectionKey, action, readVideoDetailsForActionElement(actionElement) || video);
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
  let totalRows = 0;
  let totalPages = 0;
  let logicalPage = startPage || currentPageNumber();
  let lastScrapedPage: number | null = null;
  let lastKnownUrl: string | null = null;
  let stoppedByKnownPage = false;
  let incompleteReason: string | null = null;

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
      lastKnownUrl: lastKnownUrl
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

  async function recordCurrentPage(pageNumber?: number | null) {
    const rows = uniqByUrl(scrapeCurrentPage());
    lastScrapedPage = pageNumber || logicalPage || currentPageNumber();
    logicalPage = lastScrapedPage;

    for (let r = 0; r < rows.length; r++) {
      rows[r].siteOrder = siteOrderOffset + totalRows + r + 1;
    }

    totalRows += rows.length;
    totalPages++;

    if (rows.length) lastKnownUrl = rows[rows.length - 1].url;

    const allKnown = await checkRowsKnown(rows);

    sendProgress('sync-page', {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      page: lastScrapedPage,
      rows: rows,
      url: location.href
    });

    if (allKnown) {
      stoppedByKnownPage = true;
      return true;
    }

    return false;
  }

  if (await recordCurrentPage()) {
    return result(true);
  }

  if (batchLimit && totalPages >= batchLimit) {
    if (chooseNextPagerLink(readPagerLinks(), logicalPage)) {
      incompleteReason = 'batch-limit';
      return result(false);
    }

    return result(true);
  }

  while (true) {
    const links = readPagerLinks();
    const next = chooseNextPagerLink(links, logicalPage);
    if (!next) break;

    const oldSig = signature();

    try {
      next.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {}

    await new Promise(function (resolve) {
      setTimeout(resolve, 200);
    });
    next.el.click();
    const changed = await waitForContainerChange(oldSig, 15000);

    if (!changed || signature() === oldSig) {
      incompleteReason = 'page-unchanged';
      return result(false);
    }

    logicalPage = next.pageNumber || currentPageNumber();

    sendProgress('sync-progress', {
      collectionKey: collectionKey,
      mode: mode,
      syncRunId: syncRunId,
      page: logicalPage,
      message: 'page-loaded'
    });

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

ipcRenderer.on('browser:diagnose-request', function (_event, payload: unknown) {
  const requestId = requestIdFromPayload(payload);
  if (!requestId) return;

  try {
    sendPreloadResponse(requestId, diagnosePage());
  } catch (error) {
    sendPreloadError(requestId, error);
  }
});
