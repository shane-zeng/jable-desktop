'use strict';

import type * as Electron from 'electron';

type WebViewRequestDetails = {
  url?: unknown;
  resourceType?: unknown;
};
type WebViewEnhancementEnv = Record<string, string | undefined>;
type WebViewEnhancementLogger = {
  info(message?: unknown, ...optionalParams: unknown[]): void;
};
type InstallWebViewEnhancementOptions = {
  enabled?: boolean | (() => boolean);
  debug?: boolean;
  logger?: WebViewEnhancementLogger;
};
type InstallWebViewEnhancementResult = {
  installed: boolean;
  patterns: string[];
};

const SUPPRESSED_REMOTE_HOSTS = [
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
const SUPPRESSED_REMOTE_PATHS: Record<string, string[]> = {
  'assets-cdn.jable.tv': ['/assets/images/252/427-240-3.gif'],
  'assetscdn.jable.tv': ['/assets/images/uu/uhyg6-760x70.gif'],
  'imasdk.googleapis.com': ['/js/sdkloader/ima3.js']
};
const SUPPRESSED_REMOTE_URL_PATTERNS = [
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

function isWebViewEnhancementDebugEnabledByEnv(env?: WebViewEnhancementEnv | null): boolean {
  env = env || process.env;
  const value = String(env.JABLE_DESKTOP_WEBVIEW_ENHANCEMENT_DEBUG || '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

function isSuppressedWebViewUrl(parsed: URL): boolean {
  if (SUPPRESSED_REMOTE_HOSTS.indexOf(parsed.hostname) !== -1) return true;

  const suppressedPaths = SUPPRESSED_REMOTE_PATHS[parsed.hostname] || [];
  for (let i = 0; i < suppressedPaths.length; i++) {
    if (parsed.pathname === suppressedPaths[i]) return true;
  }

  return false;
}

function shouldSuppressWebViewRequest(details?: WebViewRequestDetails | null): boolean {
  if (!details || details.resourceType === 'mainFrame') return false;

  const parsed = parseHttpUrl(details.url);
  return Boolean(parsed && isSuppressedWebViewUrl(parsed));
}

function shouldSuppressWebViewNavigation(value: unknown): boolean {
  const parsed = parseHttpUrl(value);
  return Boolean(parsed && isSuppressedWebViewUrl(parsed));
}

function webViewEnhancementEnabled(options: InstallWebViewEnhancementOptions) {
  if (typeof options.enabled === 'function') return Boolean(options.enabled());
  if (typeof options.enabled === 'boolean') return options.enabled;
  return false;
}

function installJableWebViewEnhancement(
  session: Electron.Session,
  options?: InstallWebViewEnhancementOptions | null
): InstallWebViewEnhancementResult {
  const normalizedOptions = options || {};

  if (typeof normalizedOptions.enabled !== 'function' && normalizedOptions.enabled !== true) {
    return {
      installed: false,
      patterns: SUPPRESSED_REMOTE_URL_PATTERNS.slice()
    };
  }

  const debug = Boolean(normalizedOptions.debug);
  const logger = normalizedOptions.logger || console;

  session.webRequest.onBeforeRequest({ urls: SUPPRESSED_REMOTE_URL_PATTERNS }, function (details, callback) {
    const suppressed = webViewEnhancementEnabled(normalizedOptions) && shouldSuppressWebViewRequest(details);

    if (suppressed && debug) {
      logger.info('[webview-enhancement] suppressed request', details.url);
    }

    callback(suppressed ? { cancel: true } : {});
  });

  return {
    installed: true,
    patterns: SUPPRESSED_REMOTE_URL_PATTERNS.slice()
  };
}

module.exports = {
  SUPPRESSED_REMOTE_HOSTS: SUPPRESSED_REMOTE_HOSTS,
  SUPPRESSED_REMOTE_URL_PATTERNS: SUPPRESSED_REMOTE_URL_PATTERNS,
  installJableWebViewEnhancement: installJableWebViewEnhancement,
  isWebViewEnhancementDebugEnabledByEnv: isWebViewEnhancementDebugEnabledByEnv,
  shouldSuppressWebViewNavigation: shouldSuppressWebViewNavigation,
  shouldSuppressWebViewRequest: shouldSuppressWebViewRequest
};
