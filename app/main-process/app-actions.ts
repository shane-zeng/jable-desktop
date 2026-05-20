'use strict';

import type * as Electron from 'electron';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type { DataEngine } from '../data/data-engine';
import type { CollectionKey, ExportJsonFileResult, SupportedLocale } from '../types/jable';

type DatabaseCollection = { key: CollectionKey; name: string; sourcePath: string };

export type AppActionsContext = {
  app: Electron.App;
  collections: DatabaseCollection[];
  dialog: typeof Electron.dialog;
  ffmpegGuideUrls: Record<SupportedLocale, string>;
  fs: typeof NodeFs;
  getCurrentLocale(): SupportedLocale;
  getDatabase(): DataEngine;
  getDatabasePath(): string | null;
  getMainWindow(): Electron.BrowserWindow | null;
  path: typeof NodePath;
  shell: typeof Electron.shell;
  t(key: string): string;
};

export type AppActions = {
  exportJsonFile(collectionKey: CollectionKey): Promise<ExportJsonFileResult>;
  openFfmpegGuide(): Promise<{ opened: boolean; url: string }>;
  openLocalDataFolder(): Promise<{ opened: boolean; path: string }>;
};

export function createAppActions(context: AppActionsContext): AppActions {
  function exportFilenameForCollection(collectionKey: CollectionKey): string {
    for (let i = 0; i < context.collections.length; i++) {
      if (context.collections[i].key === collectionKey) {
        return collectionKey === 'watch_later' ? 'watch_later_list.json' : 'favourites_list.json';
      }
    }

    throw new Error('Unknown collection: ' + collectionKey);
  }

  function localDataFolderPath(): string {
    context.getDatabase();
    const databasePath = context.getDatabasePath();
    if (!databasePath) throw new Error(context.t('status.unknownError'));
    return context.path.dirname(databasePath);
  }

  function openLocalDataFolder(): Promise<{ opened: boolean; path: string }> {
    const folderPath = localDataFolderPath();
    context.fs.mkdirSync(folderPath, { recursive: true });

    return context.shell.openPath(folderPath).then(function (errorMessage: string) {
      if (errorMessage) throw new Error(errorMessage);
      return {
        opened: true,
        path: folderPath
      };
    });
  }

  function openFfmpegGuide(): Promise<{ opened: boolean; url: string }> {
    const locale = context.getCurrentLocale();
    const url = context.ffmpegGuideUrls[locale] || context.ffmpegGuideUrls['en-US'];

    return context.shell.openExternal(url).then(function () {
      return {
        opened: true,
        url: url
      };
    });
  }

  async function exportJsonFile(collectionKey: CollectionKey): Promise<ExportJsonFileResult> {
    const filename = exportFilenameForCollection(collectionKey);
    const dialogOptions = {
      title: context.t('dialog.exportJson'),
      defaultPath: context.path.join(context.app.getPath('downloads'), filename),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    };
    const mainWindow = context.getMainWindow();
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await context.dialog.showSaveDialog(mainWindow, dialogOptions)
        : await context.dialog.showSaveDialog(dialogOptions);

    if (result.canceled || !result.filePath) return { canceled: true };

    const exported = await context.getDatabase().exportResourceToFile(collectionKey, result.filePath);

    return {
      canceled: false,
      filename: context.path.basename(exported.filePath),
      total: exported.total
    };
  }

  return {
    exportJsonFile: exportJsonFile,
    openFfmpegGuide: openFfmpegGuide,
    openLocalDataFolder: openLocalDataFolder
  };
}
