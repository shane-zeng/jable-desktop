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

function absoluteUrl(href: string, baseHref: string) {
  try {
    return new URL(href, baseHref).href;
  } catch (error) {
    return href;
  }
}
