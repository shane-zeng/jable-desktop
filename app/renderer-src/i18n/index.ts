import { ref } from 'vue';
import zhTW from '../../i18n/locales/zh-TW.json';
import enUS from '../../i18n/locales/en-US.json';

export type SupportedLocale = 'zh-TW' | 'en-US';

export const DEFAULT_LOCALE: SupportedLocale = 'zh-TW';
export const LOCALE_STORAGE_KEY = 'jable-desktop:locale';

var messages = {
  'zh-TW': zhTW,
  'en-US': enUS
};

var currentLocale = ref<SupportedLocale>(detectLocale());

export var localeOptions = [
  { value: 'zh-TW' as SupportedLocale, label: zhTW.locale.zhTW },
  { value: 'en-US' as SupportedLocale, label: enUS.locale.enUS }
];

export function normalizeLocale(value: unknown): SupportedLocale {
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

function readStoredLocale() {
  try {
    var stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored ? normalizeLocale(stored) : null;
  } catch (error) {
    return null;
  }
}

function writeStoredLocale(locale: SupportedLocale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch (error) {}
}

function browserLocaleCandidates() {
  var candidates: string[] = [];

  if (typeof navigator !== 'undefined') {
    if (navigator.languages && navigator.languages.length) candidates = candidates.concat(navigator.languages);
    if (navigator.language) candidates.push(navigator.language);
  }

  return candidates;
}

export function detectLocale(systemLocale?: string | null): SupportedLocale {
  var stored = readStoredLocale();
  if (stored) return stored;

  var candidates = systemLocale ? [systemLocale].concat(browserLocaleCandidates()) : browserLocaleCandidates();
  for (var i = 0; i < candidates.length; i++) {
    var normalized = normalizeLocale(candidates[i]);
    if (normalized !== DEFAULT_LOCALE || /^zh/i.test(String(candidates[i] || ''))) return normalized;
  }

  return DEFAULT_LOCALE;
}

function messageAt(locale: SupportedLocale, key: string) {
  var current: unknown = messages[locale];
  var parts = String(key || '').split('.');

  for (var i = 0; i < parts.length; i++) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, parts[i])) {
      return null;
    }

    current = (current as Record<string, unknown>)[parts[i]];
  }

  return typeof current === 'string' ? current : null;
}

function interpolate(template: string, params?: Record<string, string | number | null | undefined>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, key) {
    if (!params || !Object.prototype.hasOwnProperty.call(params, key)) return match;
    if (params[key] === null || typeof params[key] === 'undefined') return '';
    return String(params[key]);
  });
}

export function t(key: string, params?: Record<string, string | number | null | undefined>) {
  var message = messageAt(currentLocale.value, key) || messageAt(DEFAULT_LOCALE, key) || key;
  return interpolate(message, params);
}

export function setLocale(value: unknown, persist = true) {
  currentLocale.value = normalizeLocale(value);
  if (persist) writeStoredLocale(currentLocale.value);
}

export function initializeLocale(systemLocale?: string | null) {
  currentLocale.value = detectLocale(systemLocale);
}

export function useI18n() {
  return {
    locale: currentLocale,
    localeOptions: localeOptions,
    t: t,
    setLocale: setLocale,
    initializeLocale: initializeLocale,
    normalizeLocale: normalizeLocale
  };
}
