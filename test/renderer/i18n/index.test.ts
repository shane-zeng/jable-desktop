import { beforeEach, describe, expect, it } from 'vitest';
import { LOCALE_STORAGE_KEY, detectLocale, localeOptions, normalizeLocale, setLocale, t } from '@/i18n';

describe('renderer i18n', function () {
  beforeEach(function () {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    setLocale('zh-TW', false);
  });

  it('normalizes locales and falls back to Traditional Chinese', function () {
    expect(normalizeLocale('zh-HK')).toBe('zh-TW');
    expect(normalizeLocale('zh-Hant-TW')).toBe('zh-TW');
    expect(normalizeLocale('en-GB')).toBe('en-US');
    expect(normalizeLocale('ja-JP')).toBe('ja-JP');
    expect(normalizeLocale('ja')).toBe('ja-JP');
    expect(normalizeLocale('ja-JP-u-ca-japanese')).toBe('ja-JP');
  });

  it('lists Japanese in locale options', function () {
    expect(localeOptions).toContainEqual({ value: 'ja-JP', label: '日本語' });
  });

  it('uses stored locale before detected locale', function () {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en-US');

    expect(detectLocale('zh-TW')).toBe('en-US');
  });

  it('translates and interpolates labels', function () {
    setLocale('en-US', false);

    expect(t('library.page', { current: 2, total: 5 })).toBe('Page 2 / 5');
  });

  it('exposes missing keys during tests', function () {
    expect(t('missing.example')).toBe('[missing:missing.example]');
  });
});
