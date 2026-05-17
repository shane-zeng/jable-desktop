'use strict';

import type * as Electron from 'electron';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
export type UpdateCheckOptions = { manual?: boolean };
export type UpdateCheckResult = {
  available?: boolean;
  currentVersion?: string;
  latestVersion?: string;
  releaseUrl?: string;
  error?: string;
  reason?: string;
};
export type UpdateCheckerModule = {
  checkLatestRelease(options: { currentVersion?: string }): Promise<UpdateCheckResult>;
};

export type AppMenuManagerContext = {
  app: typeof Electron.app;
  backgroundUpdateCheckDelayMs: number;
  closeActiveTabFromShortcut(): void;
  closeTabAccelerator: string;
  dialog: typeof Electron.dialog;
  getMainWindow(): Electron.BrowserWindow | null;
  isAllowedExternalReleaseUrl(value: unknown): boolean;
  isMacos: boolean;
  mainErrorMessage(error: unknown): string;
  Menu: typeof Electron.Menu;
  newTabAccelerator: string;
  openHomeTabFromShortcut(): void;
  shell: typeof Electron.shell;
  t(key: string, params?: TranslationParams | null): string;
  updateChecker: UpdateCheckerModule;
};

export type AppMenuManager = {
  checkForUpdates(options?: UpdateCheckOptions | null): Promise<UpdateCheckResult>;
  installApplicationMenu(): void;
  scheduleBackgroundUpdateCheck(): void;
  showAppDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue>;
};

let app: typeof Electron.app;
let backgroundUpdateCheckDelayMs = 0;
let closeActiveTabFromShortcut: () => void;
let closeTabAccelerator = '';
let dialog: typeof Electron.dialog;
let getMainWindow: () => Electron.BrowserWindow | null;
let isAllowedExternalReleaseUrl: (value: unknown) => boolean;
let isMacos = false;
let mainErrorMessage: (error: unknown) => string;
let Menu: typeof Electron.Menu;
let newTabAccelerator = '';
let openHomeTabFromShortcut: () => void;
let shell: typeof Electron.shell;
let translate: (key: string, params?: TranslationParams | null) => string;
let updateChecker: UpdateCheckerModule;
let updateCheckInFlight: Promise<UpdateCheckResult> | null = null;
let lastBackgroundUpdateVersion: string | null = null;

function t(key: string, params?: TranslationParams | null): string {
  return translate(key, params);
}

function currentMainWindow(): Electron.BrowserWindow | null {
  const mainWindow = getMainWindow();
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function installApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [];
  const fileSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('menu.newTab'),
      accelerator: newTabAccelerator,
      click: openHomeTabFromShortcut
    },
    {
      label: t('menu.closeTab'),
      accelerator: closeTabAccelerator,
      click: closeActiveTabFromShortcut
    }
  ];

  if (!isMacos) {
    fileSubmenu.push({ type: 'separator' });
    fileSubmenu.push({ role: 'quit' });
  }

  if (isMacos) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  template.push({
    label: t('menu.file'),
    submenu: fileSubmenu
  });

  template.push(
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: t('menu.window'),
      submenu: isMacos
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'zoom' }]
    }
  );

  template.push({
    label: t('menu.help'),
    submenu: [
      {
        label: t('menu.checkForUpdates'),
        click: checkForUpdatesFromMenu
      }
    ]
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAppDialog(options: Electron.MessageBoxOptions) {
  const mainWindow = currentMainWindow();
  if (mainWindow) return dialog.showMessageBox(mainWindow, options);
  return dialog.showMessageBox(options);
}

function showUpdateAvailableDialog(result: UpdateCheckResult, manual: boolean): Promise<UpdateCheckResult> {
  if (!manual && result.latestVersion === lastBackgroundUpdateVersion) return Promise.resolve(result);
  if (!manual) lastBackgroundUpdateVersion = result.latestVersion || null;

  return showAppDialog({
    type: 'info',
    buttons: [t('updates.openDownloadPage'), t('updates.later')],
    defaultId: 0,
    cancelId: 1,
    title: t('updates.availableTitle'),
    message: t('updates.availableMessage', {
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion
    })
  }).then(function (dialogResult: Electron.MessageBoxReturnValue) {
    if (dialogResult.response !== 0 || !result.releaseUrl) return result;
    if (!isAllowedExternalReleaseUrl(result.releaseUrl)) {
      return showUpdateFailedDialog({
        error: t('updates.untrustedReleaseUrl')
      }).then(function () {
        return result;
      });
    }

    return shell.openExternal(result.releaseUrl).then(function () {
      return result;
    });
  });
}

function showNoUpdateDialog(result: UpdateCheckResult): Promise<UpdateCheckResult> {
  return showAppDialog({
    type: 'info',
    buttons: ['OK'],
    defaultId: 0,
    title: t('updates.noUpdateTitle'),
    message: t('updates.noUpdateMessage', {
      currentVersion: result.currentVersion || app.getVersion()
    })
  }).then(function () {
    return result;
  });
}

function showUpdateFailedDialog(result: UpdateCheckResult): Promise<UpdateCheckResult> {
  return showAppDialog({
    type: 'warning',
    buttons: ['OK'],
    defaultId: 0,
    title: t('updates.failedTitle'),
    message: t('updates.failedMessage', {
      error: result.error || t('status.unknownError')
    })
  }).then(function () {
    return result;
  });
}

function displayUpdateCheckResult(result: UpdateCheckResult, manual: boolean): Promise<UpdateCheckResult> {
  if (result.available) return showUpdateAvailableDialog(result, manual);
  if (!manual) return Promise.resolve(result);
  if (result.error) return showUpdateFailedDialog(result);
  return showNoUpdateDialog(result);
}

function fetchUpdateCheck(): Promise<UpdateCheckResult> {
  if (updateCheckInFlight) return updateCheckInFlight;

  updateCheckInFlight = updateChecker
    .checkLatestRelease({
      currentVersion: app.getVersion()
    })
    .finally(function () {
      updateCheckInFlight = null;
    });

  return updateCheckInFlight;
}

function checkForUpdates(options?: UpdateCheckOptions | null): Promise<UpdateCheckResult> {
  const normalizedOptions = options || {};

  return fetchUpdateCheck().then(function (result) {
    return displayUpdateCheckResult(result, Boolean(normalizedOptions.manual));
  });
}

function checkForUpdatesFromMenu() {
  checkForUpdates({ manual: true }).catch(function (error) {
    showUpdateFailedDialog({
      error: mainErrorMessage(error)
    }).catch(function () {});
  });
}

function scheduleBackgroundUpdateCheck() {
  if (!app.isPackaged) return;

  setTimeout(function () {
    checkForUpdates({ manual: false }).catch(function () {});
  }, backgroundUpdateCheckDelayMs);
}

export function createAppMenuManager(context: AppMenuManagerContext): AppMenuManager {
  app = context.app;
  backgroundUpdateCheckDelayMs = context.backgroundUpdateCheckDelayMs;
  closeActiveTabFromShortcut = context.closeActiveTabFromShortcut;
  closeTabAccelerator = context.closeTabAccelerator;
  dialog = context.dialog;
  getMainWindow = context.getMainWindow;
  isAllowedExternalReleaseUrl = context.isAllowedExternalReleaseUrl;
  isMacos = context.isMacos;
  mainErrorMessage = context.mainErrorMessage;
  Menu = context.Menu;
  newTabAccelerator = context.newTabAccelerator;
  openHomeTabFromShortcut = context.openHomeTabFromShortcut;
  shell = context.shell;
  translate = context.t;
  updateChecker = context.updateChecker;

  return {
    checkForUpdates: checkForUpdates,
    installApplicationMenu: installApplicationMenu,
    scheduleBackgroundUpdateCheck: scheduleBackgroundUpdateCheck,
    showAppDialog: showAppDialog
  };
}
