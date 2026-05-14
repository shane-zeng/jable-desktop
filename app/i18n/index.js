'use strict';

var zhTW = require('./locales/zh-TW.json');
var enUS = require('./locales/en-US.json');

var DEFAULT_LOCALE = 'zh-TW';
var SUPPORTED_LOCALES = ['zh-TW', 'en-US'];
var messages = {
  'zh-TW': zhTW,
  'en-US': enUS
};

function normalizeLocale(value) {
  var locale = String(value || '').toLowerCase();

  if (locale === 'en' || locale.indexOf('en-') === 0) return 'en-US';
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

function messageAt(locale, key) {
  var current = messages[locale];
  var parts = String(key || '').split('.');

  for (var i = 0; i < parts.length; i++) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, parts[i])) {
      return null;
    }

    current = current[parts[i]];
  }

  return typeof current === 'string' ? current : null;
}

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

function missingKey(key) {
  return shouldExposeMissingKeys() ? '[missing:' + key + ']' : key;
}

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
