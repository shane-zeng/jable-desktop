'use strict';

import type * as Electron from 'electron';
import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type { DataEngine } from '../data/data-engine';
import type {
  AppBackupData,
  AppBackupKind,
  AppBackupTotals,
  AppSettings,
  ExportAppBackupPayload,
  ExportAppBackupResult,
  ImportAppBackupResult,
  RendererPreferencesBackup,
  SupportedLocale
} from '../types/jable';
import { normalizeAppSettings } from './settings';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;

export type AppBackupActionsContext = {
  app: Electron.App;
  dialog: typeof Electron.dialog;
  fs: typeof NodeFs;
  getAppSettings(): AppSettings;
  getAppVersion(): string;
  getDatabase(): DataEngine;
  getMainWindow(): Electron.BrowserWindow | null;
  hasActiveSyncRuns(): boolean;
  hasQueuedOrActiveDownloads(): boolean;
  path: typeof NodePath;
  t(key: string, params?: TranslationParams | null): string;
  updateAppSettings(patch: AppSettings): AppSettings;
};

export type AppBackupActions = {
  exportAppBackup(payload: ExportAppBackupPayload): Promise<ExportAppBackupResult>;
  importAppBackup(): Promise<ImportAppBackupResult>;
};

type BackupEnvelope = {
  kind?: unknown;
  format_version?: unknown;
  app_version?: unknown;
  exported_at?: unknown;
  settings?: unknown;
  renderer_preferences?: unknown;
  data?: unknown;
};

const BACKUP_FORMAT_VERSION = 1;
const SETTINGS_BACKUP_KIND = 'jable-desktop-settings-backup';
const FULL_BACKUP_KIND = 'jable-desktop-full-backup';
const BACKUP_EXCLUSIONS = ['sync_operations', 'cookies', 'logs', 'downloaded_files', 'browser_session', 'window_state'];
const SUPPORTED_LOCALES: SupportedLocale[] = ['zh-TW', 'en-US', 'ja-JP'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function envelopeKindForExportKind(kind: AppBackupKind) {
  return kind === 'full' ? FULL_BACKUP_KIND : SETTINGS_BACKUP_KIND;
}

function exportKindForEnvelopeKind(kind: unknown): AppBackupKind | null {
  if (kind === SETTINGS_BACKUP_KIND) return 'settings';
  if (kind === FULL_BACKUP_KIND) return 'full';
  return null;
}

function normalizeExportKind(value: unknown): AppBackupKind {
  if (isRecord(value)) {
    if (value.kind === 'settings' || value.kind === 'full') return value.kind;
  }
  throw new Error('Unknown app backup kind');
}

function nullableFiniteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function normalizeRendererPreferences(value: unknown): RendererPreferencesBackup {
  const record = isRecord(value) ? value : {};
  const locale = SUPPORTED_LOCALES.includes(record.locale as SupportedLocale)
    ? (record.locale as SupportedLocale)
    : null;

  return {
    locale: locale,
    browserTabsWidth: nullableFiniteNumber(record.browserTabsWidth),
    downloadSidebarCollapsed:
      typeof record.downloadSidebarCollapsed === 'boolean' ? record.downloadSidebarCollapsed : null,
    downloadSidebarWidth: nullableFiniteNumber(record.downloadSidebarWidth)
  };
}

function isCurrentPlatformAbsolutePath(value: string): boolean {
  if (process.platform === 'win32') {
    return (
      /^[A-Za-z]:[\\/]/.test(value) || /^\\\\\?\\[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value)
    );
  }
  return value.startsWith('/');
}

function scrubImportedPathSettings(
  settings: AppSettings,
  t: (key: string, params?: TranslationParams | null) => string
): { settings: AppSettings; warnings: string[] } {
  const next = Object.assign({}, settings, {
    downloadStateFilters: settings.downloadStateFilters.slice()
  });
  const warnings: string[] = [];

  for (const key of ['ffmpegPath', 'downloadRoot'] as const) {
    const value = next[key];
    if (!value) continue;
    if (isCurrentPlatformAbsolutePath(value)) continue;

    next[key] = null;
    warnings.push(t('status.appBackupPathSkipped', { setting: key, path: value }));
  }

  return { settings: next, warnings: warnings };
}

function backupDataTotals(data: AppBackupData | null): AppBackupTotals | null {
  if (!data) return null;
  return {
    videos: Array.isArray(data.videos) ? data.videos.length : 0,
    collectionItems: Array.isArray(data.collection_items) ? data.collection_items.length : 0,
    syncStates: Array.isArray(data.sync_states) ? data.sync_states.length : 0,
    downloadAssets: Array.isArray(data.download_assets) ? data.download_assets.length : 0
  };
}

function normalizeImportedBackupData(value: unknown): AppBackupData {
  if (!isRecord(value)) throw new Error('Full app backup requires data');
  return {
    videos: Array.isArray(value.videos) ? value.videos : [],
    collection_items: Array.isArray(value.collection_items) ? value.collection_items : [],
    sync_states: Array.isArray(value.sync_states) ? value.sync_states : [],
    download_assets: Array.isArray(value.download_assets) ? value.download_assets : []
  };
}

function writeJsonReplacingFile(fs: typeof NodeFs, filePath: string, content: unknown) {
  const tempPath = filePath + '.tmp-' + process.pid + '-' + Date.now();
  try {
    fs.writeFileSync(tempPath, JSON.stringify(content, null, 2) + '\n', 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch (_cleanupError) {
      // Best-effort cleanup only. The original write error is the useful failure.
    }
    throw error;
  }
}

function warningText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    if (typeof value.message === 'string') return value.message;
    if (typeof value.code === 'string') return value.code;
  }
  return JSON.stringify(value);
}

export function createAppBackupActions(context: AppBackupActionsContext): AppBackupActions {
  function activeWorkflowError() {
    if (context.hasActiveSyncRuns()) return new Error(context.t('status.appBackupBlockedBySync'));
    if (context.hasQueuedOrActiveDownloads()) return new Error(context.t('status.appBackupBlockedByDownload'));
    return null;
  }

  function showSaveDialog(defaultFilename: string, titleKey: string): Promise<Electron.SaveDialogReturnValue> {
    const dialogOptions = {
      title: context.t(titleKey),
      defaultPath: context.path.join(context.app.getPath('downloads'), defaultFilename),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    };
    const mainWindow = context.getMainWindow();
    return mainWindow && !mainWindow.isDestroyed()
      ? context.dialog.showSaveDialog(mainWindow, dialogOptions)
      : context.dialog.showSaveDialog(dialogOptions);
  }

  function showOpenDialog(): Promise<Electron.OpenDialogReturnValue> {
    const dialogOptions = {
      title: context.t('dialog.importAppBackup'),
      properties: ['openFile'] as Electron.OpenDialogOptions['properties'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    };
    const mainWindow = context.getMainWindow();
    return mainWindow && !mainWindow.isDestroyed()
      ? context.dialog.showOpenDialog(mainWindow, dialogOptions)
      : context.dialog.showOpenDialog(dialogOptions);
  }

  async function confirmPendingSyncReset(): Promise<boolean> {
    const pendingGroups = context.getDatabase().listPendingRemoteOperationGroups();
    if (pendingGroups.length === 0) return true;

    const dialogOptions = {
      type: 'warning' as const,
      buttons: [context.t('dialog.cancel'), context.t('dialog.importAppBackupResetPendingConfirm')],
      cancelId: 0,
      defaultId: 1,
      title: context.t('dialog.importAppBackupResetPendingTitle'),
      message: context.t('dialog.importAppBackupResetPendingMessage', { count: pendingGroups.length })
    };
    const mainWindow = context.getMainWindow();
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await context.dialog.showMessageBox(mainWindow, dialogOptions)
        : await context.dialog.showMessageBox(dialogOptions);
    return result.response === 1;
  }

  async function exportAppBackup(payload: ExportAppBackupPayload): Promise<ExportAppBackupResult> {
    const kind = normalizeExportKind(payload);
    const blocked = kind === 'full' ? activeWorkflowError() : null;
    if (blocked) throw blocked;

    const filename = kind === 'full' ? 'jable_desktop_full_backup.json' : 'jable_desktop_settings_backup.json';
    const result = await showSaveDialog(
      filename,
      kind === 'full' ? 'dialog.exportFullAppBackup' : 'dialog.exportSettingsBackup'
    );

    if (result.canceled || !result.filePath) return { canceled: true };

    const data = kind === 'full' ? context.getDatabase().exportBackupData() : null;
    const envelope = {
      kind: envelopeKindForExportKind(kind),
      format_version: BACKUP_FORMAT_VERSION,
      app_version: context.getAppVersion(),
      exported_at: new Date().toISOString(),
      settings: context.getAppSettings(),
      renderer_preferences: normalizeRendererPreferences(payload.rendererPreferences),
      data: data || undefined,
      exclusions: BACKUP_EXCLUSIONS
    };

    writeJsonReplacingFile(context.fs, result.filePath, envelope);

    return {
      canceled: false,
      kind: kind,
      filename: context.path.basename(result.filePath),
      totals: backupDataTotals(data)
    };
  }

  async function importAppBackup(): Promise<ImportAppBackupResult> {
    const blocked = activeWorkflowError();
    if (blocked) throw blocked;

    const result = await showOpenDialog();
    if (result.canceled || !result.filePaths.length) return { canceled: true };

    const raw = context.fs.readFileSync(result.filePaths[0], 'utf8');
    const envelope = JSON.parse(raw) as BackupEnvelope;
    const kind = exportKindForEnvelopeKind(envelope.kind);
    if (!kind || Number(envelope.format_version) !== BACKUP_FORMAT_VERSION) {
      throw new Error(context.t('status.appBackupInvalidFormat'));
    }

    const normalized = normalizeAppSettings(envelope.settings);
    const scrubbed = scrubImportedPathSettings(normalized, context.t);
    const rendererPreferences = normalizeRendererPreferences(envelope.renderer_preferences);
    let imported: AppBackupTotals | null = null;
    const warnings = scrubbed.warnings.slice();

    if (kind === 'full') {
      const confirmed = await confirmPendingSyncReset();
      if (!confirmed) return { canceled: true };

      const importResult = context.getDatabase().importBackupData(normalizeImportedBackupData(envelope.data));
      imported = importResult.imported;
      for (const warning of importResult.warnings || []) {
        warnings.push(warningText(warning));
      }
    }

    const settings = context.updateAppSettings(scrubbed.settings);

    return {
      canceled: false,
      kind: kind,
      settings: settings,
      rendererPreferences: rendererPreferences,
      imported: imported,
      warnings: warnings
    };
  }

  return {
    exportAppBackup: exportAppBackup,
    importAppBackup: importAppBackup
  };
}
