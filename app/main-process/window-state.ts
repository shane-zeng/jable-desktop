'use strict';

import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type { MainWindowSavedState } from './window-options';

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

export const MAIN_WINDOW_STATE_FILE_NAME = 'main-window-state.json';
export const MAIN_WINDOW_STATE_VERSION = 1;

export type MainWindowStateSnapshot = {
  version: number;
  updatedAt: string;
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  maximized: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  const rounded = Math.round(number);
  return rounded > 0 ? rounded : null;
}

function normalizeNullableInteger(value: unknown): number | null {
  if (value === null || typeof value === 'undefined') return null;

  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
}

function normalizeMainWindowState(value: unknown): MainWindowSavedState | null {
  if (!isRecord(value)) return null;

  const width = normalizePositiveInteger(value.width);
  const height = normalizePositiveInteger(value.height);
  if (!width || !height) return null;

  return {
    x: normalizeNullableInteger(value.x),
    y: normalizeNullableInteger(value.y),
    width: width,
    height: height,
    maximized: Boolean(value.maximized)
  };
}

export function mainWindowStateFilePath(userDataPath: string) {
  return path.join(userDataPath, MAIN_WINDOW_STATE_FILE_NAME);
}

export class MainWindowStateStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  readState(): MainWindowSavedState | null {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return normalizeMainWindowState(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  writeState(state: MainWindowSavedState) {
    const normalized = normalizeMainWindowState(state);
    if (!normalized) return;

    const directory = path.dirname(this.filePath);
    const tempPath = this.filePath + '.tmp';
    const snapshot: MainWindowStateSnapshot = {
      version: MAIN_WINDOW_STATE_VERSION,
      updatedAt: new Date().toISOString(),
      x: normalized.x ?? null,
      y: normalized.y ?? null,
      width: normalized.width,
      height: normalized.height,
      maximized: normalized.maximized || false
    };

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2) + '\n');
    fs.renameSync(tempPath, this.filePath);
  }
}
