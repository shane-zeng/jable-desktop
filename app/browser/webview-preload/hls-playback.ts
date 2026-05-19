'use strict';

import type { ScrapedVideoRow } from '../../types/jable';

type HlsPlaybackIpc = {
  invoke(channel: 'hls:playlist-proxy-url', payload: unknown): Promise<HlsPlaylistProxyUrlResult>;
  send(channel: 'hls:playback-started', payload: unknown): void;
};

type LocalPlaybackSourcePageNotice = {
  sourcePageChineseSubtitleNotice: boolean;
  sourcePageSubtitleNoticeText: string | null;
};

type HlsPlaybackControllerOptions = {
  cleanVideoTitle(value: unknown): string | null;
  currentVideoUrl(): string | null;
  ipcRenderer: HlsPlaybackIpc;
  isEditableUserGestureTarget(target: EventTarget | null): boolean;
  readCurrentLocalPlaybackSourcePageNotice(): LocalPlaybackSourcePageNotice;
  readCurrentVideoDetails(): ScrapedVideoRow | null;
};

type HlsPlaybackController = {
  installPlaybackStartedObserver(): void;
  installPlaylistProxyInterception(): void;
};

type HlsPlaylistProxyUrlResult =
  | {
      available: false;
      reason: string;
    }
  | {
      available: true;
      playlistUrl: string;
      sourceUrl: string;
      videoUrl: string;
    };

const HLS_PROXY_MESSAGE_SOURCE = 'jable-desktop-hls-proxy';
const HLS_PROXY_REQUEST_MESSAGE = 'jable-hls-proxy-url-request';
const HLS_PROXY_RESPONSE_MESSAGE = 'jable-hls-proxy-url-response';
const HLS_PROXY_PAGE_REQUEST_TIMEOUT_MS = 1500;
const HLS_PLAYBACK_USER_GESTURE_TTL_MS = 8000;

export function createHlsPlaybackController(options: HlsPlaybackControllerOptions): HlsPlaybackController {
  let lastPlaybackStartedVideoUrl = '';
  let lastPlaybackStartedUserInitiated = false;
  let lastPlaybackUserGestureAt = 0;
  const pageLoadId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : String(Date.now()) + '-' + String(Math.random()).slice(2);

  function hlsProxyMessageData(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  function installHlsPlaylistProxyBridge() {
    window.addEventListener('message', function (event) {
      if (event.source !== window) return;

      const data = hlsProxyMessageData(event.data);
      if (!data || data.source !== HLS_PROXY_MESSAGE_SOURCE || data.type !== HLS_PROXY_REQUEST_MESSAGE) return;

      const requestId = typeof data.requestId === 'string' ? data.requestId : '';
      const playlistUrl = typeof data.playlistUrl === 'string' ? data.playlistUrl : '';
      const currentVideo = options.readCurrentVideoDetails();
      const sourcePageNotice = options.readCurrentLocalPlaybackSourcePageNotice();
      const title = (currentVideo && currentVideo.title) || options.cleanVideoTitle(data.title) || '';
      const videoUrl = typeof data.videoUrl === 'string' ? data.videoUrl : '';
      if (!requestId || !playlistUrl || !videoUrl) return;

      options.ipcRenderer
        .invoke('hls:playlist-proxy-url', {
          playlistUrl: playlistUrl,
          pageLoadId: pageLoadId,
          title: title,
          views: currentVideo ? currentVideo.views : null,
          likes: currentVideo ? currentVideo.likes : null,
          img: currentVideo ? currentVideo.img : null,
          preview: currentVideo ? currentVideo.preview : null,
          sourcePageChineseSubtitleNotice: sourcePageNotice.sourcePageChineseSubtitleNotice,
          sourcePageSubtitleNoticeText: sourcePageNotice.sourcePageSubtitleNoticeText,
          videoUrl: videoUrl
        })
        .then(function (result: HlsPlaylistProxyUrlResult) {
          window.postMessage(
            {
              source: HLS_PROXY_MESSAGE_SOURCE,
              type: HLS_PROXY_RESPONSE_MESSAGE,
              requestId: requestId,
              result: result
            },
            '*'
          );
        })
        .catch(function (error) {
          window.postMessage(
            {
              source: HLS_PROXY_MESSAGE_SOURCE,
              type: HLS_PROXY_RESPONSE_MESSAGE,
              requestId: requestId,
              result: {
                available: false,
                reason: error instanceof Error ? error.message : String(error)
              }
            },
            '*'
          );
        });
    });
  }

  function hlsPlaylistProxyPageScript() {
    return (
      '(' +
      function (
        messageSource: string,
        requestMessageType: string,
        responseMessageType: string,
        requestTimeoutMs: number
      ) {
        const windowRecord = window as unknown as Record<string, unknown>;
        if (windowRecord.__jableDesktopHlsProxyInstalled) return;
        windowRecord.__jableDesktopHlsProxyInstalled = true;

        let nextRequestId = 1;
        const pending: Record<
          string,
          {
            resolve(value: string | null): void;
            timer: ReturnType<typeof setTimeout>;
          }
        > = {};

        function currentPageVideoUrl() {
          try {
            const parsed = new URL(location.href);
            if (!/^\/videos\/[^/]+\/?$/.test(parsed.pathname)) return '';
            if (!/\/$/.test(parsed.pathname)) parsed.pathname += '/';
            parsed.search = '';
            parsed.hash = '';
            return parsed.href;
          } catch (error) {
            return '';
          }
        }

        function remotePlaylistUrl(value: unknown) {
          try {
            const parsed = new URL(String(value || ''), location.href);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') return '';
            return parsed.pathname.toLowerCase().indexOf('.m3u8') !== -1 ? parsed.href : '';
          } catch (error) {
            return '';
          }
        }

        function requestProxyUrl(playlistUrl: string) {
          const videoUrl = currentPageVideoUrl();
          if (!videoUrl) return Promise.resolve(null);

          const requestId = 'hls-proxy-' + nextRequestId++;
          return new Promise<string | null>(function (resolve) {
            const timer = setTimeout(function () {
              delete pending[requestId];
              resolve(null);
            }, requestTimeoutMs);

            pending[requestId] = {
              resolve: resolve,
              timer: timer
            };

            window.postMessage(
              {
                source: messageSource,
                type: requestMessageType,
                requestId: requestId,
                playlistUrl: playlistUrl,
                title: document.title || '',
                videoUrl: videoUrl
              },
              '*'
            );
          });
        }

        window.addEventListener('message', function (event) {
          if (event.source !== window) return;
          const data = event.data;
          if (!data || typeof data !== 'object') return;
          if (data.source !== messageSource || data.type !== responseMessageType) return;

          const requestId = typeof data.requestId === 'string' ? data.requestId : '';
          const pendingRequest = pending[requestId];
          if (!pendingRequest) return;

          clearTimeout(pendingRequest.timer);
          delete pending[requestId];

          const result = data.result;
          pendingRequest.resolve(
            result && result.available && typeof result.sourceUrl === 'string' ? result.sourceUrl : null
          );
        });

        const nativeFetch = window.fetch;
        if (typeof nativeFetch === 'function') {
          window.fetch = function (...fetchArguments: Parameters<typeof window.fetch>) {
            const self = this;
            const input = fetchArguments[0];
            const init = fetchArguments[1];
            const playlistUrl = remotePlaylistUrl(input instanceof Request ? input.url : input);
            if (!playlistUrl) return nativeFetch.apply(self, fetchArguments);

            return requestProxyUrl(playlistUrl).then(function (sourceUrl) {
              if (!sourceUrl) return nativeFetch.apply(self, fetchArguments);
              if (input instanceof Request) {
                return nativeFetch.call(self, sourceUrl, init);
              }
              return nativeFetch.call(self, sourceUrl, init);
            });
          };
        }

        const nativeOpen = XMLHttpRequest.prototype.open as (...args: unknown[]) => void;
        const nativeSend = XMLHttpRequest.prototype.send as (...args: unknown[]) => void;
        const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
        const nativeOverrideMimeType = XMLHttpRequest.prototype.overrideMimeType;

        XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...openArguments: unknown[]) {
          const method = String(openArguments[0] || '');
          const url = openArguments[1] as string | URL;
          const async = openArguments[2] as boolean | undefined;
          const username = openArguments[3] as string | null | undefined;
          const password = openArguments[4] as string | null | undefined;
          const playlistUrl = remotePlaylistUrl(url);
          if (!playlistUrl || async === false) {
            return nativeOpen.apply(this, openArguments);
          }

          (this as unknown as Record<string, unknown>).__jableDesktopHlsProxyOpen = {
            async: async,
            headers: [],
            method: method,
            mimeType: null,
            password: password,
            playlistUrl: playlistUrl,
            username: username
          };
        } as typeof XMLHttpRequest.prototype.open;

        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
          const state = (this as unknown as Record<string, unknown>).__jableDesktopHlsProxyOpen as
            | { headers: Array<[string, string]> }
            | undefined;
          if (state) {
            state.headers.push([name, value]);
            return;
          }

          return nativeSetRequestHeader.call(this, name, value);
        };

        XMLHttpRequest.prototype.overrideMimeType = function (mimeType) {
          const state = (this as unknown as Record<string, unknown>).__jableDesktopHlsProxyOpen as
            | { mimeType: string | null }
            | undefined;
          if (state) {
            state.mimeType = mimeType;
            return;
          }

          return nativeOverrideMimeType.call(this, mimeType);
        };

        XMLHttpRequest.prototype.send = function (...sendArguments: unknown[]) {
          const body = sendArguments[0] as unknown;
          const xhr = this;
          const state = (xhr as unknown as Record<string, unknown>).__jableDesktopHlsProxyOpen as
            | {
                async?: boolean;
                headers: Array<[string, string]>;
                method: string;
                mimeType: string | null;
                password?: string | null;
                playlistUrl: string;
                username?: string | null;
              }
            | undefined;
          if (!state) return nativeSend.apply(xhr, sendArguments);

          delete (xhr as unknown as Record<string, unknown>).__jableDesktopHlsProxyOpen;
          const responseType = xhr.responseType;
          const timeout = xhr.timeout;
          const withCredentials = xhr.withCredentials;

          requestProxyUrl(state.playlistUrl).then(function (sourceUrl) {
            nativeOpen.call(
              xhr,
              state.method,
              sourceUrl || state.playlistUrl,
              typeof state.async === 'undefined' ? true : state.async,
              state.username || null,
              state.password || null
            );
            xhr.timeout = timeout;
            xhr.withCredentials = withCredentials;
            if (responseType) xhr.responseType = responseType;
            if (state.mimeType) nativeOverrideMimeType.call(xhr, state.mimeType);
            for (let i = 0; i < state.headers.length; i++) {
              nativeSetRequestHeader.call(xhr, state.headers[i][0], state.headers[i][1]);
            }
            nativeSend.call(xhr, body || null);
          });
        };
      }.toString() +
      ')(' +
      JSON.stringify(HLS_PROXY_MESSAGE_SOURCE) +
      ',' +
      JSON.stringify(HLS_PROXY_REQUEST_MESSAGE) +
      ',' +
      JSON.stringify(HLS_PROXY_RESPONSE_MESSAGE) +
      ',' +
      String(HLS_PROXY_PAGE_REQUEST_TIMEOUT_MS) +
      ');'
    );
  }

  function injectHlsPlaylistProxyPageScript() {
    const script = document.createElement('script');
    script.textContent = hlsPlaylistProxyPageScript();
    (document.documentElement || document.head || document).appendChild(script);
    script.remove();
  }

  function installHlsPlaylistProxyInterception() {
    installHlsPlaylistProxyBridge();
    injectHlsPlaylistProxyPageScript();
  }

  function markHlsPlaybackUserGesture(event: Event) {
    if (options.isEditableUserGestureTarget(event.target)) return;
    lastPlaybackUserGestureAt = Date.now();
  }

  function hlsPlaybackWasUserInitiated() {
    return Date.now() - lastPlaybackUserGestureAt <= HLS_PLAYBACK_USER_GESTURE_TTL_MS;
  }

  function notifyHlsPlaybackStarted() {
    const videoUrl = options.currentVideoUrl();
    const userInitiatedPlayback = hlsPlaybackWasUserInitiated();
    if (
      !videoUrl ||
      (videoUrl === lastPlaybackStartedVideoUrl && (!userInitiatedPlayback || lastPlaybackStartedUserInitiated))
    ) {
      return;
    }

    lastPlaybackStartedVideoUrl = videoUrl;
    lastPlaybackStartedUserInitiated = userInitiatedPlayback;
    const currentVideo = options.readCurrentVideoDetails();
    const sourcePageNotice = options.readCurrentLocalPlaybackSourcePageNotice();
    options.ipcRenderer.send('hls:playback-started', {
      videoUrl: videoUrl,
      pageLoadId: pageLoadId,
      userInitiatedPlayback: userInitiatedPlayback,
      title: currentVideo ? currentVideo.title : null,
      views: currentVideo ? currentVideo.views : null,
      likes: currentVideo ? currentVideo.likes : null,
      img: currentVideo ? currentVideo.img : null,
      preview: currentVideo ? currentVideo.preview : null,
      sourcePageChineseSubtitleNotice: sourcePageNotice.sourcePageChineseSubtitleNotice,
      sourcePageSubtitleNoticeText: sourcePageNotice.sourcePageSubtitleNoticeText
    });
  }

  function installHlsPlaybackStartedObserver() {
    document.addEventListener('pointerdown', markHlsPlaybackUserGesture, true);
    document.addEventListener('click', markHlsPlaybackUserGesture, true);
    document.addEventListener('touchstart', markHlsPlaybackUserGesture, true);
    document.addEventListener('keydown', markHlsPlaybackUserGesture, true);
    document.addEventListener(
      'play',
      function (event) {
        if (event.target instanceof HTMLVideoElement) notifyHlsPlaybackStarted();
      },
      true
    );
    document.addEventListener(
      'playing',
      function (event) {
        if (event.target instanceof HTMLVideoElement) notifyHlsPlaybackStarted();
      },
      true
    );
  }

  return {
    installPlaybackStartedObserver: installHlsPlaybackStartedObserver,
    installPlaylistProxyInterception: installHlsPlaylistProxyInterception
  };
}
