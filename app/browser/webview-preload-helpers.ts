'use strict';

import { DEFAULT_APP_SETTINGS, FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS, PAGE_SIZE } from '../app-contract';
import type { ScrapedVideoRow } from '../types/jable';

export const SITE_PAGE_SIZE = PAGE_SIZE;
export const DEFAULT_FULL_SYNC_AJAX_WINDOW_SIZE = DEFAULT_APP_SETTINGS.fullSyncAjaxWindowSize;
export const MAX_FULL_SYNC_AJAX_WINDOW_SIZE = FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS.max;
export const FULL_SYNC_AJAX_FETCH_TIMEOUT_MS = 15000;
export const FULL_SYNC_AJAX_MIN_PAGE_DELAY_MS = 500;
export const FULL_SYNC_AJAX_MAX_PAGE_DELAY_MS = 1500;
export const FULL_SYNC_AJAX_MAX_RETRIES = 3;
export const FULL_SYNC_AJAX_BACKOFF_BASE_MS = 1000;
export const FULL_SYNC_AJAX_BACKOFF_MAX_MS = 10000;

export type AjaxPagerTemplate = {
  ajaxUrl: string | null;
  pageParamName: string | null;
  pageParamWidth: number;
};
export type AjaxSyncPage = {
  pageNumber: number;
  rows: ScrapedVideoRow[];
  signature: string;
  lastPage: number | null;
  url: string;
};
export type FetchTextSuccess = {
  ok: true;
  retryAfterMs: null;
  status: number;
  text: string;
};
export type FetchTextFailure = {
  ok: false;
  detail: string;
  reason: string;
  retryable: boolean;
  retryAfterMs: number | null;
  status: number | null;
};
export type FetchTextResult = FetchTextSuccess | FetchTextFailure;
export type AjaxSyncRetryEvent = {
  attempt: number;
  delayMs: number;
  maxRetries: number;
  pageNumber: number;
  reason: string;
};
export type AjaxHtmlRetryOptions = {
  fetchText?: (url: string, timeoutMs: number) => Promise<FetchTextResult>;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};
export type FetchAjaxSyncPageOptions = {
  expectedLastPage: number;
  fetchText?: (url: string, timeoutMs: number) => Promise<FetchTextResult>;
  isTrustedUrl(value: unknown): boolean;
  onRetry?: (event: AjaxSyncRetryEvent) => void;
  pageNumber: number;
  parsePage(html: string, url: string, pageNumber: number, expectedLastPage: number): AjaxSyncPage;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  template: AjaxPagerTemplate;
};
export type AjaxPageWindowOptions<T> = {
  end: number;
  fetchPage(pageNumber: number, index: number): Promise<T>;
  onPageStart?: (pageNumber: number, index: number) => void;
  pageDelayMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  start: number;
  windowSize: number;
};

export class AjaxSyncError extends Error {
  detail: string;
  reason: string;
  retryable: boolean;
  status: number | null;

  constructor(reason: string, detail?: string, status?: number | null, retryable?: boolean) {
    super(detail || reason);
    this.name = 'AjaxSyncError';
    this.detail = detail || reason;
    this.reason = reason;
    this.retryable = Boolean(retryable);
    this.status = typeof status === 'number' ? status : null;
  }
}

export function normalizeAjaxWindowSize(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_FULL_SYNC_AJAX_WINDOW_SIZE;
  return Math.max(FULL_SYNC_AJAX_WINDOW_SIZE_LIMITS.min, Math.min(MAX_FULL_SYNC_AJAX_WINDOW_SIZE, Math.round(number)));
}

export function videoPathKey(value: unknown, baseHref: string) {
  if (!value) return '';

  try {
    const parsed = new URL(String(value), baseHref);
    if (!/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return '';
    if (!/\/$/.test(parsed.pathname)) parsed.pathname += '/';
    return parsed.pathname;
  } catch (error) {
    return '';
  }
}

export function rowUrlSignature(rows: ScrapedVideoRow[]) {
  const urls: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    urls.push(rows[i].url || '');
  }

  return urls.join('|');
}

export function parseMetricNumber(value: unknown) {
  const number = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return isFinite(number) && number > 0 ? number : null;
}

export function normalizePageNumber(value: unknown) {
  const n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return isFinite(n) && n > 0 ? n : 1;
}

export function readPageNumber(value: unknown): number | null {
  const n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return isFinite(n) && n > 0 ? n : null;
}

export function samePageUrl(left: unknown, right: unknown, baseHref: string) {
  const leftUrl = absoluteUrl(String(left || ''), baseHref);
  const rightUrl = absoluteUrl(String(right || ''), baseHref);

  return leftUrl.replace(/\/?$/, '/') === rightUrl.replace(/\/?$/, '/');
}

export function parseBlockParameters(value: string) {
  const params = new URLSearchParams();
  const parts = value.split(';');

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const separator = part.indexOf(':');
    if (separator <= 0) continue;

    const keys = part.slice(0, separator).split('+');
    let paramValue = part.slice(separator + 1);

    try {
      paramValue = decodeURIComponent(paramValue).replace(/[+]/g, ' ');
    } catch (error) {}

    for (let k = 0; k < keys.length; k++) {
      const key = keys[k].trim();
      if (key) params.set(key, paramValue);
    }
  }

  return params;
}

export function ajaxUrlForPagerLink(blockId: string, parameters: string, currentHref: string) {
  if (!blockId) return null;

  try {
    const url = new URL(currentHref);
    const params = parseBlockParameters(parameters);

    url.hash = '';
    url.searchParams.set('mode', 'async');
    url.searchParams.set('function', 'get_block');
    url.searchParams.set('block_id', blockId);
    params.forEach(function (value, key) {
      url.searchParams.set(key, value);
    });

    return url.href;
  } catch (error) {
    return null;
  }
}

export function ajaxUrlForPage(template: AjaxPagerTemplate, pageNumber: number) {
  if (!template.ajaxUrl || !template.pageParamName) return null;

  try {
    const url = new URL(template.ajaxUrl);
    const value = String(pageNumber).padStart(template.pageParamWidth || 1, '0');
    url.searchParams.set(template.pageParamName, value);
    return url.href;
  } catch (error) {
    return null;
  }
}

export function parseRetryAfterMs(value: string | null, nowMs = Date.now()) {
  if (!value) return null;

  const seconds = Number(value);
  if (isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const timestamp = Date.parse(value);
  if (!isNaN(timestamp)) return Math.max(0, timestamp - nowMs);

  return null;
}

export function retryAfterMsFromHeaders(headers: Headers) {
  return parseRetryAfterMs(headers.get('retry-after'));
}

export function isRetryableAjaxStatus(status: number) {
  return status === 403 || status === 429 || status >= 500;
}

export function fetchFailureDetail(reason: string, status?: number | null, statusText?: string | null) {
  if (typeof status === 'number') {
    return ['HTTP', String(status), statusText || ''].join(' ').trim();
  }
  if (reason === 'timeout') return 'request timeout';
  if (reason === 'network-error') return 'network error';
  if (reason === 'empty-response') return 'empty response';
  return reason;
}

export function randomDelayMs(min: number, max: number, random = Math.random) {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  return Math.floor(lower + random() * (upper - lower + 1));
}

export function ajaxRetryDelayMs(attempt: number, retryAfterMs: number | null, random: () => number = Math.random) {
  if (retryAfterMs !== null) return retryAfterMs + randomDelayMs(250, 1000, random);

  const backoff = Math.min(
    FULL_SYNC_AJAX_BACKOFF_MAX_MS,
    FULL_SYNC_AJAX_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempt - 1))
  );
  return backoff + randomDelayMs(250, 1000, random);
}

export function sleepMs(ms: number) {
  return new Promise<void>(function (resolve) {
    setTimeout(resolve, Math.max(0, Math.round(ms)));
  });
}

export async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<FetchTextResult> {
  const controller = new AbortController();
  const timer = setTimeout(function () {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      method: 'GET',
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: fetchFailureDetail('http-' + response.status, response.status, response.statusText),
        reason: 'http-' + response.status,
        retryable: isRetryableAjaxStatus(response.status),
        retryAfterMs: retryAfterMsFromHeaders(response.headers),
        status: response.status
      };
    }

    return {
      ok: true,
      retryAfterMs: null,
      status: response.status,
      text: await response.text()
    };
  } catch (error) {
    const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
    const reason = name === 'AbortError' ? 'timeout' : 'network-error';
    return {
      ok: false,
      detail: fetchFailureDetail(reason),
      reason: reason,
      retryable: true,
      retryAfterMs: null,
      status: null
    };
  } finally {
    clearTimeout(timer);
  }
}

export function ajaxFailureDetail(error: unknown) {
  if (error instanceof AjaxSyncError) return error.detail;
  return error instanceof Error ? error.message : String(error);
}

export async function fetchAjaxHtmlWithRetry(
  url: string,
  pageNumber: number,
  onRetry?: (event: AjaxSyncRetryEvent) => void,
  options?: AjaxHtmlRetryOptions | null
) {
  const fetchText = options?.fetchText || fetchTextWithTimeout;
  const random = options?.random || Math.random;
  const sleep = options?.sleep || sleepMs;
  let lastError: AjaxSyncError | null = null;

  for (let attempt = 0; attempt <= FULL_SYNC_AJAX_MAX_RETRIES; attempt++) {
    const fetched = await fetchText(url, FULL_SYNC_AJAX_FETCH_TIMEOUT_MS);
    const retryAfterMs = fetched.ok ? null : fetched.retryAfterMs;

    if (fetched.ok) {
      if (fetched.text.trim()) return fetched.text;
      lastError = new AjaxSyncError('empty-response', fetchFailureDetail('empty-response'), null, true);
    } else {
      lastError = new AjaxSyncError(fetched.reason, fetched.detail, fetched.status, fetched.retryable);
    }

    if (!lastError.retryable || attempt >= FULL_SYNC_AJAX_MAX_RETRIES) throw lastError;

    const delayMs = ajaxRetryDelayMs(attempt + 1, retryAfterMs, random);
    if (onRetry) {
      onRetry({
        attempt: attempt + 1,
        delayMs: delayMs,
        maxRetries: FULL_SYNC_AJAX_MAX_RETRIES,
        pageNumber: pageNumber,
        reason: lastError.detail
      });
    }
    await sleep(delayMs);
  }

  throw lastError || new AjaxSyncError('ajax-empty-response', 'empty response', null, true);
}

export async function fetchAjaxSyncPage(options: FetchAjaxSyncPageOptions): Promise<AjaxSyncPage> {
  const url = ajaxUrlForPage(options.template, options.pageNumber);
  if (!url || !options.isTrustedUrl(url)) {
    throw new AjaxSyncError('ajax-url-unavailable', 'AJAX URL unavailable', null, false);
  }

  const random = options.random || Math.random;
  const sleep = options.sleep || sleepMs;
  for (let attempt = 0; attempt <= FULL_SYNC_AJAX_MAX_RETRIES; attempt++) {
    const html = await fetchAjaxHtmlWithRetry(url, options.pageNumber, options.onRetry, {
      fetchText: options.fetchText,
      random: random,
      sleep: sleep
    });

    try {
      return options.parsePage(html, url, options.pageNumber, options.expectedLastPage);
    } catch (error) {
      if (!(error instanceof AjaxSyncError) || !error.retryable || attempt >= FULL_SYNC_AJAX_MAX_RETRIES) {
        throw error;
      }

      const delayMs = ajaxRetryDelayMs(attempt + 1, null, random);
      if (options.onRetry) {
        options.onRetry({
          attempt: attempt + 1,
          delayMs: delayMs,
          maxRetries: FULL_SYNC_AJAX_MAX_RETRIES,
          pageNumber: options.pageNumber,
          reason: error.detail
        });
      }
      await sleep(delayMs);
    }
  }

  throw new AjaxSyncError('ajax-empty-page', 'AJAX page contained no rows', null, true);
}

export function validateAjaxPages(firstPageRows: ScrapedVideoRow[], pages: AjaxSyncPage[]) {
  const seen: Record<string, boolean> = {};

  for (let i = 0; i < firstPageRows.length; i++) {
    seen[firstPageRows[i].url] = true;
  }

  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    for (let r = 0; r < page.rows.length; r++) {
      const url = page.rows[r].url;
      if (seen[url]) throw new AjaxSyncError('ajax-duplicate-url', 'AJAX page returned a duplicate URL', null, false);
      seen[url] = true;
    }
  }
}

export function validateAjaxFirstPage(
  firstPageRows: ScrapedVideoRow[],
  firstPageSignature: string,
  firstPageCheck: AjaxSyncPage
) {
  if (firstPageCheck.signature !== firstPageSignature) {
    throw new AjaxSyncError(
      'ajax-first-page-signature-changed',
      'AJAX first page signature changed during sync',
      null,
      false
    );
  }
  if (rowUrlSignature(firstPageCheck.rows) !== rowUrlSignature(firstPageRows)) {
    throw new AjaxSyncError('ajax-first-page-rows-changed', 'AJAX first page rows changed during sync', null, false);
  }
}

export async function fetchAjaxPagesWithWindow<T>(options: AjaxPageWindowOptions<T>) {
  const pageNumbers: number[] = [];
  const pages: T[] = [];
  const sleep = options.sleep || sleepMs;
  const pageDelayMs =
    options.pageDelayMs ||
    function () {
      return randomDelayMs(FULL_SYNC_AJAX_MIN_PAGE_DELAY_MS, FULL_SYNC_AJAX_MAX_PAGE_DELAY_MS);
    };
  let nextIndex = 0;
  let failure: unknown = null;

  for (let pageNumber = options.start; pageNumber <= options.end; pageNumber++) {
    pageNumbers.push(pageNumber);
  }

  async function worker() {
    while (!failure) {
      const index = nextIndex;
      nextIndex++;
      if (index >= pageNumbers.length) return;

      const pageNumber = pageNumbers[index];
      if (options.onPageStart) options.onPageStart(pageNumber, index);

      try {
        pages[index] = await options.fetchPage(pageNumber, index);
      } catch (error) {
        failure = error;
        return;
      }

      await sleep(pageDelayMs());
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(options.windowSize, pageNumbers.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  if (failure) throw failure;

  return pages;
}

function absoluteUrl(href: string, baseHref: string) {
  try {
    return new URL(href, baseHref).href;
  } catch (error) {
    return href;
  }
}
