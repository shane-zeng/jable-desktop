'use strict';

export type DiagnosticsLevel = 'debug' | 'info' | 'warn' | 'error';
export type WebContentsDiagnosticsDecision = {
  level: DiagnosticsLevel;
  event: string;
};

type WebContentsContext = Record<string, unknown>;

type LoadFailureDetails = {
  errorCode: number;
  errorDescription?: string;
  url?: string;
  context?: WebContentsContext | null;
};

type ConsoleMessageDetails = {
  level: string;
  message?: string;
  sourceId?: string;
  context?: WebContentsContext | null;
};

const CHROME_ERR_ABORTED = -3;

const EMBEDDED_BROWSER_CONTEXT_KINDS = new Set(['browser-tab', 'sync-worker']);
const KNOWN_CONTENT_NOISE_HOSTS = new Set([
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
  'z6v2p9a8.bkcdn.net',
  'imasdk.googleapis.com',
  'cloudlogobox.com',
  'www.cloudlogobox.com'
]);

const KNOWN_CONTENT_NOISE_MESSAGE_PATTERNS = [
  /Google IMA SDK failed to load/i,
  /cloudlogobox\.com/i,
  /Uncaught \(in promise\) AbortError: The play\(\) request was interrupted/i,
  /AbortError: The play\(\) request was interrupted/i,
  /NotSupportedError: The element has no supported sources/i,
  /The resource .* was preloaded using link preload but not used/i,
  /Failed to load resource: net::ERR_BLOCKED_BY_CLIENT/i
];

function parsedHttpUrl(value: unknown): URL | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function contextKind(context?: WebContentsContext | null): string {
  const kind = context && typeof context.kind === 'string' ? context.kind : '';
  return kind;
}

function isEmbeddedBrowserContext(context?: WebContentsContext | null): boolean {
  return EMBEDDED_BROWSER_CONTEXT_KINDS.has(contextKind(context));
}

function containsKnownNoisyUrl(value: unknown): boolean {
  const text = String(value || '');
  if (!text) return false;

  const directUrl = parsedHttpUrl(text);
  if (directUrl && KNOWN_CONTENT_NOISE_HOSTS.has(directUrl.hostname)) return true;

  const matches = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
  for (const match of matches) {
    const parsed = parsedHttpUrl(match);
    if (parsed && KNOWN_CONTENT_NOISE_HOSTS.has(parsed.hostname)) return true;
  }

  return false;
}

function isKnownContentNoise(details: ConsoleMessageDetails): boolean {
  if (containsKnownNoisyUrl(details.sourceId) || containsKnownNoisyUrl(details.message)) return true;

  const message = String(details.message || '');
  for (let i = 0; i < KNOWN_CONTENT_NOISE_MESSAGE_PATTERNS.length; i++) {
    if (KNOWN_CONTENT_NOISE_MESSAGE_PATTERNS[i].test(message)) return true;
  }

  return false;
}

export function classifyWebContentsLoadFailure(details: LoadFailureDetails): WebContentsDiagnosticsDecision | null {
  if (details.errorCode === CHROME_ERR_ABORTED) return null;

  return {
    level: 'warn',
    event: 'web-contents-main-frame-load-failed'
  };
}

export function classifyWebContentsConsoleMessage(
  details: ConsoleMessageDetails
): WebContentsDiagnosticsDecision | null {
  if (details.level !== 'warning' && details.level !== 'error') return null;

  if (isEmbeddedBrowserContext(details.context) && isKnownContentNoise(details)) return null;

  return {
    level: details.level === 'error' ? 'error' : 'warn',
    event: 'console-message'
  };
}
