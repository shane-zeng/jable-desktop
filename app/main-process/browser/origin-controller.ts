'use strict';

import type { BrowserLoadFailure } from './tab-manager';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;

export type BrowserOriginControllerContext = {
  fallbackJableUrl(value: unknown): string | null;
  fallbackOrigin: string;
  forwardBrowserMessage(channel: string, payload: unknown): void;
  isSafeBrowserUrl(value: unknown): boolean;
  primaryOrigin: string;
  rewriteJableUrlOrigin(value: unknown, origin: string): string;
  t(key: string, params?: TranslationParams | null): string;
};

export type BrowserOriginController = {
  activeOrigin(): string;
  activateFallbackOrigin(): void;
  fallbackUrlForLoadFailure(failure: BrowserLoadFailure | null | undefined): string | null;
  normalizeNavigationUrl(value: unknown): string;
};

export function createBrowserOriginController(context: BrowserOriginControllerContext): BrowserOriginController {
  let activeJableOrigin = context.primaryOrigin;

  function activeOrigin() {
    return activeJableOrigin;
  }

  function notifyJableOriginFallback(origin: string) {
    context.forwardBrowserMessage('jable-origin-fallback', { origin: origin });
  }

  function normalizeNavigationUrl(value: unknown): string {
    const url = String(value || '').trim();
    if (!url) return '';
    if (!context.isSafeBrowserUrl(url)) throw new Error(context.t('errors.unsupportedUrlProtocol'));
    return context.rewriteJableUrlOrigin(url, activeJableOrigin);
  }

  function activateFallbackOrigin() {
    if (activeJableOrigin === context.fallbackOrigin) return;
    activeJableOrigin = context.fallbackOrigin;
    notifyJableOriginFallback(activeJableOrigin);
  }

  function fallbackUrlForLoadFailure(failure: BrowserLoadFailure | null | undefined): string | null {
    if (!failure || failure.errorCode === -3) return null;
    if (activeJableOrigin !== context.primaryOrigin) return null;
    return context.fallbackJableUrl(failure.url);
  }

  return {
    activeOrigin: activeOrigin,
    activateFallbackOrigin: activateFallbackOrigin,
    fallbackUrlForLoadFailure: fallbackUrlForLoadFailure,
    normalizeNavigationUrl: normalizeNavigationUrl
  };
}
