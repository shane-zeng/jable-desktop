'use strict';

var zhTW = require('./locales/zh-TW.json');
var enUS = require('./locales/en-US.json');
var jaJP = require('./locales/ja-JP.json');

/**
 * @typedef {'zh-TW' | 'en-US' | 'ja-JP'} SupportedLocale
 * @typedef {Record<string, unknown>} LocaleMessages
 * @typedef {Record<string, string | number | boolean | null | undefined>} InterpolationParams
 */

/** @type {SupportedLocale} */
var DEFAULT_LOCALE = 'zh-TW';
/** @type {SupportedLocale[]} */
var SUPPORTED_LOCALES = ['zh-TW', 'en-US', 'ja-JP'];
/** @type {Record<SupportedLocale, LocaleMessages>} */
var messages = {
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP
};

/**
 * @param {unknown} value
 * @returns {SupportedLocale}
 */
function normalizeLocale(value) {
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

/**
 * @param {SupportedLocale} locale
 * @param {string} key
 * @returns {string | null}
 */
function messageAt(locale, key) {
  /** @type {unknown} */
  var current = messages[locale];
  var parts = String(key || '').split('.');

  for (var i = 0; i < parts.length; i++) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, parts[i])) {
      return null;
    }

    current = /** @type {LocaleMessages} */ (current)[parts[i]];
  }

  return typeof current === 'string' ? current : null;
}

/**
 * @param {unknown} template
 * @param {InterpolationParams | null | undefined} params
 * @returns {string}
 */
function interpolate(template, params) {
  params = params || {};

  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, key) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) return match;
    if (params[key] === null || typeof params[key] === 'undefined') return '';
    return String(params[key]);
  });
}

function shouldExposeMissingKeys() {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

/**
 * @param {string} key
 * @returns {string}
 */
function missingKey(key) {
  return shouldExposeMissingKeys() ? '[missing:' + key + ']' : key;
}

/**
 * @param {unknown} locale
 * @param {string} key
 * @param {InterpolationParams | null | undefined} [params]
 * @returns {string}
 */
function t(locale, key, params) {
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
