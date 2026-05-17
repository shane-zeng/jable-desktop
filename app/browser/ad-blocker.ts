'use strict';

import type * as Electron from 'electron';

type AdBlockRequestDetails = {
  url?: unknown;
  resourceType?: unknown;
};
type AdBlockEnv = Record<string, string | undefined>;
type AdBlockLogger = {
  info(message?: unknown, ...optionalParams: unknown[]): void;
};
type InstallAdBlockerOptions = {
  enabled?: boolean;
  debug?: boolean;
  logger?: AdBlockLogger;
};
type InstallAdBlockerResult = {
  enabled: boolean;
  patterns: string[];
};

const BLOCKED_AD_HOSTS = [
  'a.labadena.com',
  'ads.adxadserv.com',
  'static.adxadserv.com',
  'cdn.tapioni.com',
  'go.mnaspm.com',
  'go.bluetrafficstream.com',
  'go.xlivrdr.com',
  'creative.xlivrdr.com',
  'creative.xxxvjmp.com',
  'img.doppiocdn.com',
  'pxl-eu.tsyndicate.com',
  'r.trackwilltrk.com',
  'a.magsrv.com',
  's.magsrv.com',
  's.zline0.com',
  't.nettrck.store',
  't.fluxtrck.site',
  'z6v2p9a8.bkcdn.net'
];
const BLOCKED_AD_PATHS: Record<string, string[]> = {
  'assets-cdn.jable.tv': ['/assets/images/252/427-240-3.gif'],
  'assetscdn.jable.tv': ['/assets/images/uu/uhyg6-760x70.gif'],
  'imasdk.googleapis.com': ['/js/sdkloader/ima3.js']
};
const BLOCKED_AD_URL_PATTERNS = [
  '*://a.labadena.com/*',
  '*://ads.adxadserv.com/*',
  '*://static.adxadserv.com/*',
  '*://cdn.tapioni.com/*',
  '*://go.mnaspm.com/*',
  '*://go.bluetrafficstream.com/*',
  '*://go.xlivrdr.com/*',
  '*://creative.xlivrdr.com/*',
  '*://creative.xxxvjmp.com/*',
  '*://img.doppiocdn.com/*',
  '*://pxl-eu.tsyndicate.com/*',
  '*://r.trackwilltrk.com/*',
  '*://a.magsrv.com/*',
  '*://s.magsrv.com/*',
  '*://s.zline0.com/*',
  '*://t.nettrck.store/*',
  '*://t.fluxtrck.site/*',
  '*://z6v2p9a8.bkcdn.net/*',
  '*://assets-cdn.jable.tv/assets/images/252/427-240-3.gif*',
  '*://assetscdn.jable.tv/assets/images/uu/uhyg6-760x70.gif*',
  '*://imasdk.googleapis.com/js/sdkloader/ima3.js*'
];
const DISABLED_ENV_VALUES = ['0', 'false', 'off', 'no'];

function parseHttpUrl(value: unknown): URL | null {
  const url = String(value || '').trim();
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function isDisabledEnvValue(value: unknown): boolean {
  return (
    DISABLED_ENV_VALUES.indexOf(
      String(value || '')
        .trim()
        .toLowerCase()
    ) !== -1
  );
}

function isAdBlockEnabledByEnv(env?: AdBlockEnv | null): boolean {
  env = env || process.env;
  return !isDisabledEnvValue(env.JABLE_DESKTOP_AD_BLOCK);
}

function isAdBlockDebugEnabledByEnv(env?: AdBlockEnv | null): boolean {
  env = env || process.env;
  const value = String(env.JABLE_DESKTOP_AD_BLOCK_DEBUG || '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

function isKnownAdUrl(parsed: URL): boolean {
  if (BLOCKED_AD_HOSTS.indexOf(parsed.hostname) !== -1) return true;

  const blockedPaths = BLOCKED_AD_PATHS[parsed.hostname] || [];
  for (let i = 0; i < blockedPaths.length; i++) {
    if (parsed.pathname === blockedPaths[i]) return true;
  }

  return false;
}

function shouldBlockAdRequest(details?: AdBlockRequestDetails | null): boolean {
  if (!details || details.resourceType === 'mainFrame') return false;

  const parsed = parseHttpUrl(details.url);
  return Boolean(parsed && isKnownAdUrl(parsed));
}

function shouldBlockAdNavigation(value: unknown): boolean {
  const parsed = parseHttpUrl(value);
  return Boolean(parsed && isKnownAdUrl(parsed));
}

function installJableAdBlocker(
  session: Electron.Session,
  options?: InstallAdBlockerOptions | null
): InstallAdBlockerResult {
  const normalizedOptions = options || {};
  const enabled = typeof normalizedOptions.enabled === 'boolean' ? normalizedOptions.enabled : true;

  if (!enabled) {
    return {
      enabled: false,
      patterns: BLOCKED_AD_URL_PATTERNS.slice()
    };
  }

  const debug = Boolean(normalizedOptions.debug);
  const logger = normalizedOptions.logger || console;

  // Electron keeps only one onBeforeRequest listener per session; keep all ad request rules centralized here.
  session.webRequest.onBeforeRequest({ urls: BLOCKED_AD_URL_PATTERNS }, function (details, callback) {
    const blocked = shouldBlockAdRequest(details);

    if (blocked && debug) {
      logger.info('[ad-blocker] blocked request', details.url);
    }

    callback(blocked ? { cancel: true } : {});
  });

  return {
    enabled: true,
    patterns: BLOCKED_AD_URL_PATTERNS.slice()
  };
}

module.exports = {
  BLOCKED_AD_HOSTS: BLOCKED_AD_HOSTS,
  BLOCKED_AD_URL_PATTERNS: BLOCKED_AD_URL_PATTERNS,
  installJableAdBlocker: installJableAdBlocker,
  isAdBlockDebugEnabledByEnv: isAdBlockDebugEnabledByEnv,
  isAdBlockEnabledByEnv: isAdBlockEnabledByEnv,
  shouldBlockAdNavigation: shouldBlockAdNavigation,
  shouldBlockAdRequest: shouldBlockAdRequest
};
