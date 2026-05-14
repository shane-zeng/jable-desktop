'use strict';

import zhTW = require('./locales/zh-TW.json');
import enUS = require('./locales/en-US.json');
import jaJP = require('./locales/ja-JP.json');

type SupportedLocale = 'zh-TW' | 'en-US' | 'ja-JP';
type LocaleMessages = Record<string, unknown>;
type InterpolationParams = Record<string, string | number | boolean | null | undefined>;

var DEFAULT_LOCALE: SupportedLocale = 'zh-TW';
var SUPPORTED_LOCALES: SupportedLocale[] = ['zh-TW', 'en-US', 'ja-JP'];
var messages: Record<SupportedLocale, LocaleMessages> = {
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP
};

function normalizeLocale(value: unknown): SupportedLocale {
  var locale = String(value || '').toLowerCase();

  if (locale === 'en' || locale.indexOf('en-') === 0) return 'en-US';
  if (locale === 'ja' || locale.indexOf('ja-') === 0) return 'ja-JP';
  if (
    locale === 'zh' ||
    locale === 'zh-tw' ||
    locale === 'zh-hk' ||
    locale === 'zh-mo' ||
    locale.indexOf('zh-hant') === 0
  ) {
    return 'zh-TW';
  }

  return DEFAULT_LOCALE;
}

function messageAt(locale: SupportedLocale, key: string): string | null {
  var current: unknown = messages[locale];
  var parts = String(key || '').split('.');

  for (var i = 0; i < parts.length; i++) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, parts[i])) {
      return null;
    }

    current = (current as LocaleMessages)[parts[i]];
  }

  return typeof current === 'string' ? current : null;
}

function interpolate(template: unknown, params?: InterpolationParams | null): string {
  params = params || {};

  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, key) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) return match;
    if (params[key] === null || typeof params[key] === 'undefined') return '';
    return String(params[key]);
  });
}

function shouldExposeMissingKeys(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

function missingKey(key: string): string {
  return shouldExposeMissingKeys() ? '[missing:' + key + ']' : key;
}

function t(locale: unknown, key: string, params?: InterpolationParams | null): string {
  var normalized = normalizeLocale(locale);
  var message = messageAt(normalized, key) || messageAt(DEFAULT_LOCALE, key) || missingKey(key);

  return interpolate(message, params);
}

module.exports = {
  DEFAULT_LOCALE: DEFAULT_LOCALE,
  SUPPORTED_LOCALES: SUPPORTED_LOCALES,
  normalizeLocale: normalizeLocale,
  t: t
};
