'use strict';

import type * as Electron from 'electron';
import type { DownloadManager } from './download/manager';

export type DownloadAppShutdownControllerContext = {
  appQuit(): void;
  getDownloadManager(): DownloadManager;
  logger?: { error(message?: unknown, ...optionalParams: unknown[]): void } | null;
  quitAfterWindowClose: boolean;
};

export type DownloadAppShutdownController = {
  consumeWindowCloseAllowance(): boolean;
  handleBeforeQuit(event: Electron.Event): boolean;
  hasQueuedOrActiveDownloads(): boolean;
  promptPauseDownloadsAndClose(browserWindow: Electron.BrowserWindow): void;
};

export function createDownloadAppShutdownController(
  context: DownloadAppShutdownControllerContext
): DownloadAppShutdownController {
  let allowDownloadAppQuit = false;
  let allowDownloadWindowClose = false;
  let downloadShutdownInProgress: Promise<void> | null = null;
  let quitAfterDownloadShutdownInFlight = false;

  function logError(error: unknown) {
    if (context.logger) context.logger.error(error);
  }

  function consumeWindowCloseAllowance() {
    if (!allowDownloadWindowClose) return false;
    allowDownloadWindowClose = false;
    return true;
  }

  function hasQueuedOrActiveDownloads(): boolean {
    return context.getDownloadManager().hasQueuedOrActiveDownloads();
  }

  function pauseDownloadsForShutdown(): Promise<void> {
    if (!downloadShutdownInProgress) {
      downloadShutdownInProgress = Promise.resolve()
        .then(function () {
          return context.getDownloadManager().pauseDownloadsForShutdown();
        })
        .finally(function () {
          downloadShutdownInProgress = null;
        });
    }

    return downloadShutdownInProgress;
  }

  function confirmPauseDownloadsBeforeClose(): Promise<boolean> {
    return context.getDownloadManager().confirmPauseDownloadsBeforeClose();
  }

  function promptPauseDownloadsAndClose(browserWindow: Electron.BrowserWindow) {
    confirmPauseDownloadsBeforeClose()
      .then(function (confirmed) {
        if (!confirmed) return;
        if (context.quitAfterWindowClose) allowDownloadAppQuit = true;
        allowDownloadWindowClose = true;
        return pauseDownloadsForShutdown().then(function () {
          if (!browserWindow.isDestroyed()) browserWindow.close();
        });
      })
      .catch(function (error) {
        logError(error);
      });
  }

  function quitAfterDownloadsPaused() {
    if (quitAfterDownloadShutdownInFlight) return;
    quitAfterDownloadShutdownInFlight = true;
    allowDownloadAppQuit = true;
    allowDownloadWindowClose = true;

    pauseDownloadsForShutdown()
      .then(function () {
        context.appQuit();
      })
      .catch(function (error) {
        logError(error);
      })
      .finally(function () {
        quitAfterDownloadShutdownInFlight = false;
      });
  }

  function promptPauseDownloadsAndQuit() {
    confirmPauseDownloadsBeforeClose()
      .then(function (confirmed) {
        if (!confirmed) return;
        quitAfterDownloadsPaused();
      })
      .catch(function (error) {
        logError(error);
      });
  }

  function handleBeforeQuit(event: Electron.Event): boolean {
    if (!hasQueuedOrActiveDownloads()) return false;

    event.preventDefault();
    if (allowDownloadAppQuit) quitAfterDownloadsPaused();
    else promptPauseDownloadsAndQuit();

    return true;
  }

  return {
    consumeWindowCloseAllowance: consumeWindowCloseAllowance,
    handleBeforeQuit: handleBeforeQuit,
    hasQueuedOrActiveDownloads: hasQueuedOrActiveDownloads,
    promptPauseDownloadsAndClose: promptPauseDownloadsAndClose
  };
}
