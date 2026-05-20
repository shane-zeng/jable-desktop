'use strict';

import type * as Electron from 'electron';
import type { BrowserTab } from './tab-manager';
import { optionalBooleanField, optionalStringField, requiredRecord, requiredStringValue } from '../ipc-normalizers';

export type BrowserPreloadRequestManagerContext = {
  mainErrorMessage(error: unknown): string;
  tabNotFoundError(): Error;
};

type BrowserPreloadRequest = {
  webContentsId: number;
  timer: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type BrowserPreloadResponse = {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type BrowserPreloadRequestManager = {
  rejectForWebContents(webContentsId: number, message: string): void;
  resolveResponse(event: Electron.IpcMainEvent, payload: unknown): void;
  requestBrowser<T>(tab: BrowserTab, channel: string, payload: Record<string, unknown>, timeoutMs: number): Promise<T>;
  requestWebContents<T>(
    webContents: Electron.WebContents,
    channel: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T>;
};

function normalizeBrowserPreloadResponse(payload: unknown): BrowserPreloadResponse {
  const channel = 'browser:preload-response';
  const record = requiredRecord(payload, channel);
  const ok = optionalBooleanField(record, 'ok', channel);
  const error = optionalStringField(record, 'error', channel);
  const response: BrowserPreloadResponse = {
    requestId: requiredStringValue(record.requestId, 'requestId', channel),
    ok: ok !== false
  };

  if (typeof record.result !== 'undefined') response.result = record.result;
  if (typeof error !== 'undefined') response.error = error;

  return response;
}

export function createBrowserPreloadRequestManager(
  context: BrowserPreloadRequestManagerContext
): BrowserPreloadRequestManager {
  const browserPreloadRequests: Record<string, BrowserPreloadRequest> = {};
  let nextBrowserPreloadRequestId = 1;

  function rejectRequest(requestId: string, error: Error) {
    const request = browserPreloadRequests[requestId];
    if (!request) return;

    clearTimeout(request.timer);
    delete browserPreloadRequests[requestId];
    request.reject(error);
  }

  function rejectForWebContents(webContentsId: number, message: string) {
    const requestIds = Object.keys(browserPreloadRequests);

    for (let i = 0; i < requestIds.length; i++) {
      const requestId = requestIds[i];
      const request = browserPreloadRequests[requestId];
      if (request && request.webContentsId === webContentsId) {
        rejectRequest(requestId, new Error(message));
      }
    }
  }

  function resolveResponse(event: Electron.IpcMainEvent, payload: unknown) {
    let response: BrowserPreloadResponse;

    try {
      response = normalizeBrowserPreloadResponse(payload);
    } catch (error) {
      return;
    }

    const request = browserPreloadRequests[response.requestId];
    if (!request) return;

    if (event.sender.id !== request.webContentsId) return;

    clearTimeout(request.timer);
    delete browserPreloadRequests[response.requestId];

    if (response.ok) request.resolve(response.result);
    else request.reject(new Error(response.error || 'Browser preload request failed'));
  }

  function requestWebContents<T>(
    webContents: Electron.WebContents,
    channel: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T> {
    if (webContents.isDestroyed()) return Promise.reject(context.tabNotFoundError());

    const requestId = 'browser-preload-' + nextBrowserPreloadRequestId++;
    const message = Object.assign({}, payload, { requestId: requestId });

    return new Promise<T>(function (resolve, reject) {
      const timer = setTimeout(function () {
        rejectRequest(requestId, new Error('Timed out waiting for webview preload response: ' + channel));
      }, timeoutMs);

      browserPreloadRequests[requestId] = {
        webContentsId: webContents.id,
        timer: timer,
        resolve: function (value: unknown) {
          resolve(value as T);
        },
        reject: reject
      };

      try {
        webContents.send(channel, message);
      } catch (error) {
        rejectRequest(requestId, new Error(context.mainErrorMessage(error)));
      }
    });
  }

  function requestBrowser<T>(
    tab: BrowserTab,
    channel: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T> {
    return requestWebContents<T>(tab.view.webContents, channel, payload, timeoutMs);
  }

  return {
    rejectForWebContents: rejectForWebContents,
    resolveResponse: resolveResponse,
    requestBrowser: requestBrowser,
    requestWebContents: requestWebContents
  };
}
