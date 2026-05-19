'use strict';

import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

export const BROWSER_SESSION_FILE_NAME = 'browser-session.json';
export const BROWSER_SESSION_VERSION = 1;

export type BrowserSessionTabSnapshot = {
  url: string;
  locked: boolean;
  muted: boolean;
};

export type BrowserSessionSnapshot = {
  version: number;
  updatedAt: string;
  activeTabIndex: number;
  tabs: BrowserSessionTabSnapshot[];
};

export type BrowserSessionRestoreOptions = {
  maxTabs: number;
  normalizeUrl(value: unknown): string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeActiveTabIndex(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function normalizeTab(value: unknown, normalizeUrl: (value: unknown) => string): BrowserSessionTabSnapshot | null {
  if (!isRecord(value)) return null;

  let url = '';

  try {
    url = normalizeUrl(value.url);
  } catch (error) {
    return null;
  }

  if (!url) return null;

  return {
    url: url,
    locked: Boolean(value.locked),
    muted: Boolean(value.muted)
  };
}

function normalizeBrowserSessionSnapshot(
  value: unknown,
  options: BrowserSessionRestoreOptions
): BrowserSessionSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null;

  const maxTabs = Math.max(1, Math.floor(Number(options.maxTabs) || 1));
  const requestedActiveIndex = normalizeActiveTabIndex(value.activeTabIndex, 0);
  const tabs: BrowserSessionTabSnapshot[] = [];
  let activeTabIndex = -1;

  for (let i = 0; i < value.tabs.length && tabs.length < maxTabs; i++) {
    const tab = normalizeTab(value.tabs[i], options.normalizeUrl);
    if (!tab) continue;

    if (i === requestedActiveIndex) activeTabIndex = tabs.length;
    tabs.push(tab);
  }

  if (!tabs.length) return null;
  if (activeTabIndex < 0) activeTabIndex = Math.min(requestedActiveIndex, tabs.length - 1);

  return {
    version: BROWSER_SESSION_VERSION,
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : new Date(0).toISOString(),
    activeTabIndex: activeTabIndex,
    tabs: tabs
  };
}

export function browserSessionFilePath(userDataPath: string) {
  return path.join(userDataPath, BROWSER_SESSION_FILE_NAME);
}

export class BrowserSessionStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  readForRestore(options: BrowserSessionRestoreOptions): BrowserSessionSnapshot | null {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return normalizeBrowserSessionSnapshot(JSON.parse(raw), options);
    } catch (error) {
      return null;
    }
  }

  write(snapshot: BrowserSessionSnapshot) {
    const directory = path.dirname(this.filePath);
    const tempPath = this.filePath + '.tmp';
    const nextSnapshot: BrowserSessionSnapshot = {
      version: BROWSER_SESSION_VERSION,
      updatedAt: new Date().toISOString(),
      activeTabIndex: Math.max(0, Math.min(snapshot.activeTabIndex, snapshot.tabs.length - 1)),
      tabs: snapshot.tabs.map(function (tab) {
        return {
          url: tab.url,
          locked: Boolean(tab.locked),
          muted: Boolean(tab.muted)
        };
      })
    };

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(nextSnapshot, null, 2) + '\n');
    fs.renameSync(tempPath, this.filePath);
  }

  clear() {
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch (error) {}
  }
}
