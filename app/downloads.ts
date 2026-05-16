'use strict';

import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type { CollectionKey, DownloadRecord, DownloadState } from './types/jable';

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

export const DOWNLOADS_FILE_NAME = 'downloads.json';

const DOWNLOAD_STATES = new Set<DownloadState>(['queued', 'downloading', 'failed', 'ready', 'missing']);

type DownloadRecordPatch = Partial<DownloadRecord> & { videoUrl: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nullableString(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requiredString(value: unknown): string | null {
  return nullableString(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstDefined(...values: unknown[]) {
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] !== 'undefined') return values[i];
  }
  return undefined;
}

function progressNumber(value: unknown): number | null {
  const number = nullableNumber(value);
  if (number === null) return null;
  return Math.max(0, Math.min(1, number));
}

function normalizeCollectionKey(value: unknown): CollectionKey | null {
  return value === 'favourites' || value === 'watch_later' ? value : null;
}

function normalizeDownloadState(value: unknown): DownloadState {
  return DOWNLOAD_STATES.has(value as DownloadState) ? (value as DownloadState) : 'queued';
}

function nowIso() {
  return new Date().toISOString();
}

function copyRecord(record: DownloadRecord): DownloadRecord {
  return Object.assign({}, record);
}

export function downloadsFilePath(userDataPath: string) {
  return path.join(userDataPath, DOWNLOADS_FILE_NAME);
}

export function normalizeDownloadRecord(value: unknown, fallbackTimestamp = nowIso()): DownloadRecord | null {
  if (!isRecord(value)) return null;

  const videoUrl = requiredString(firstDefined(value.videoUrl, value.video_url, value.url));
  if (!videoUrl) return null;

  return {
    videoUrl: videoUrl,
    collectionKey: normalizeCollectionKey(firstDefined(value.collectionKey, value.collection_key)),
    title: nullableString(value.title),
    img: nullableString(value.img),
    localPath: nullableString(firstDefined(value.localPath, value.local_path)),
    state: normalizeDownloadState(value.state),
    progress: progressNumber(value.progress),
    fileSizeBytes: nullableNumber(firstDefined(value.fileSizeBytes, value.file_size_bytes)),
    error: nullableString(value.error),
    createdAt: nullableString(firstDefined(value.createdAt, value.created_at)) || fallbackTimestamp,
    updatedAt: nullableString(firstDefined(value.updatedAt, value.updated_at)) || fallbackTimestamp,
    completedAt: nullableString(firstDefined(value.completedAt, value.completed_at))
  };
}

function normalizeDownloadResource(value: unknown): DownloadRecord[] {
  const source = isRecord(value) && Array.isArray(value.records) ? value.records : Array.isArray(value) ? value : [];
  const records = new Map<string, DownloadRecord>();

  for (let i = 0; i < source.length; i++) {
    const record = normalizeDownloadRecord(source[i]);
    if (record) records.set(record.videoUrl, record);
  }

  return Array.from(records.values()).sort(function (a, b) {
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export class DownloadStore {
  private readonly filePath: string;
  private records: DownloadRecord[] | null;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.records = null;
  }

  list(): DownloadRecord[] {
    if (!this.records) this.records = this.read();
    return this.records.map(copyRecord);
  }

  get(videoUrl: string): DownloadRecord | null {
    const target = String(videoUrl || '');
    return (
      this.list().find(function (record) {
        return record.videoUrl === target;
      }) || null
    );
  }

  upsert(patch: DownloadRecordPatch): DownloadRecord {
    const timestamp = nowIso();
    const existing = this.get(patch.videoUrl);
    const next = normalizeDownloadRecord(
      Object.assign({}, existing || {}, patch, {
        createdAt: existing ? existing.createdAt : patch.createdAt || timestamp,
        updatedAt: timestamp
      }),
      timestamp
    );

    if (!next) throw new Error('Download record requires a video URL');

    const records = this.list().filter(function (record) {
      return record.videoUrl !== next.videoUrl;
    });
    records.unshift(next);
    this.records = records;
    this.write(records);
    return copyRecord(next);
  }

  remove(videoUrl: string): boolean {
    const before = this.list();
    const after = before.filter(function (record) {
      return record.videoUrl !== videoUrl;
    });
    if (after.length === before.length) return false;

    this.records = after;
    this.write(after);
    return true;
  }

  private read(): DownloadRecord[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return normalizeDownloadResource(JSON.parse(raw));
    } catch (error) {
      return [];
    }
  }

  private write(records: DownloadRecord[]) {
    const directory = path.dirname(this.filePath);
    const tempPath = this.filePath + '.tmp';

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      tempPath,
      JSON.stringify(
        {
          version: 1,
          records: records
        },
        null,
        2
      ) + '\n'
    );
    fs.renameSync(tempPath, this.filePath);
  }
}
