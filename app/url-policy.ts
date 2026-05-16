'use strict';

import type { CollectionKey } from './types/jable';

export type JableOrigin = 'https://jable.tv' | 'https://fs1.app';

export const JABLE_PRIMARY_ORIGIN: JableOrigin = 'https://jable.tv';
export const JABLE_FALLBACK_ORIGIN: JableOrigin = 'https://fs1.app';
export const JABLE_ORIGINS: JableOrigin[] = [JABLE_PRIMARY_ORIGIN, JABLE_FALLBACK_ORIGIN];
export const GITHUB_RELEASE_ORIGIN = 'https://github.com';
export const GITHUB_RELEASE_REPO = 'shane-zeng/jable-desktop';
export const GITHUB_RELEASE_PATH_PREFIX = '/' + GITHUB_RELEASE_REPO + '/releases';

function parseUrl(value: unknown, base?: string): URL | null {
  const text = String(value || '').trim();
  if (!text) return null;

  try {
    return new URL(text, base);
  } catch (error) {
    return null;
  }
}

export function isSafeBrowserUrl(value: unknown, base?: string): boolean {
  const parsed = parseUrl(value, base);
  return Boolean(parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:'));
}

export function isKnownJableOrigin(value: unknown): value is JableOrigin {
  return JABLE_ORIGINS.indexOf(String(value || '') as JableOrigin) !== -1;
}

export function jableOriginFromUrl(value: unknown, base?: string): JableOrigin | null {
  const parsed = parseUrl(value, base);
  if (!parsed || parsed.protocol !== 'https:') return null;
  return isKnownJableOrigin(parsed.origin) ? parsed.origin : null;
}

export function isTrustedJableUrl(value: unknown, base?: string): boolean {
  return Boolean(jableOriginFromUrl(value, base));
}

export function isTrustedJableVideoUrl(value: unknown, base?: string): boolean {
  const parsed = parseUrl(value, base);
  if (!parsed || !isTrustedJableUrl(parsed.href)) return false;

  const parts = parsed.pathname.split('/').filter(Boolean);
  return parts[0] === 'videos' && parts.length >= 2;
}

export function alternateJableOrigin(origin: unknown): JableOrigin | null {
  if (origin === JABLE_PRIMARY_ORIGIN) return JABLE_FALLBACK_ORIGIN;
  if (origin === JABLE_FALLBACK_ORIGIN) return JABLE_PRIMARY_ORIGIN;
  return null;
}

export function rewriteJableUrlOrigin(value: unknown, origin: JableOrigin): string {
  const parsed = parseUrl(value);
  if (!parsed) return String(value || '');
  if (!isTrustedJableUrl(parsed.href)) return parsed.href;

  const target = new URL(origin);
  parsed.protocol = target.protocol;
  parsed.host = target.host;
  return parsed.href;
}

export function canonicalJableUrl(value: unknown): string {
  return rewriteJableUrlOrigin(value, JABLE_PRIMARY_ORIGIN);
}

export function canonicalJableVideoUrl(value: unknown): string | null {
  const parsed = parseUrl(value);
  if (!parsed || !isTrustedJableVideoUrl(parsed.href)) return null;

  const target = new URL(JABLE_PRIMARY_ORIGIN);
  parsed.protocol = target.protocol;
  parsed.host = target.host;
  parsed.search = '';
  parsed.hash = '';
  if (!parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname + '/';

  return parsed.href;
}

export function fallbackJableUrl(value: unknown): string | null {
  const origin = jableOriginFromUrl(value);
  if (origin !== JABLE_PRIMARY_ORIGIN) return null;
  return rewriteJableUrlOrigin(value, JABLE_FALLBACK_ORIGIN);
}

export function jableCollectionPath(collectionKey: CollectionKey): string {
  return collectionKey === 'watch_later' ? '/my/favourites/videos-watch-later/' : '/my/favourites/videos/';
}

export function jableCollectionUrl(collectionKey: CollectionKey, origin: JableOrigin = JABLE_PRIMARY_ORIGIN): string {
  return origin + jableCollectionPath(collectionKey);
}

export function isJableCollectionUrl(collectionKey: CollectionKey, value: unknown): boolean {
  const parsed = parseUrl(value);
  if (!parsed || !isTrustedJableUrl(parsed.href)) return false;

  const expectedPath = jableCollectionPath(collectionKey);
  return parsed.pathname.replace(/\/?$/, '/') === expectedPath;
}

export function isAllowedExternalReleaseUrl(value: unknown): boolean {
  const parsed = parseUrl(value);
  if (!parsed || parsed.origin !== GITHUB_RELEASE_ORIGIN) return false;
  if (parsed.username || parsed.password) return false;

  return (
    parsed.pathname === GITHUB_RELEASE_PATH_PREFIX || parsed.pathname.indexOf(GITHUB_RELEASE_PATH_PREFIX + '/') === 0
  );
}
