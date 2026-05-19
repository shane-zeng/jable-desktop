'use strict';

import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';
import type { DownloadRecord, DownloadRequestPayload } from '../../types/jable';
import { normalizeCollectionKey, requiredRecord, requiredStringValue } from '../ipc-normalizers';

type TranslationParams = Record<string, string | number | boolean | null | undefined>;

export type DownloadRequestBoundary = {
  downloadOutputRelativePath(payload: DownloadRequestPayload): string;
  normalizeDownloadRequestPayload(value: unknown): DownloadRequestPayload;
  normalizeDownloadVideoUrl(value: unknown, field: string, channel: string): string;
  normalizeDownloadVideoUrls(value: unknown, channel: string): string[];
  resolveManagedDownloadPath(fileRelativePath: string | null): string | null;
};

type DownloadRequestBoundaryOptions = {
  canonicalVideoUrl(value: unknown): string | null;
  downloadRootPath(): string;
  listPersistedDownloads(): DownloadRecord[];
  t(key: string, params?: TranslationParams | null): string;
};

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

const CHINESE_SUBTITLE_NOTICE_TOKEN = '中文字幕版';

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, function (_match, entity) {
    const normalized = String(entity).toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    if (normalized === 'nbsp') return ' ';

    const radix = normalized.startsWith('#x') ? 16 : 10;
    const text = normalized.startsWith('#x') ? normalized.slice(2) : normalized.slice(1);
    const codePoint = parseInt(text, radix);
    if (!Number.isFinite(codePoint)) return _match;

    try {
      return String.fromCodePoint(codePoint);
    } catch (error) {
      return _match;
    }
  });
}

function normalizeSourcePageText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function classAttributeHasNoticeClasses(attrs: string): boolean {
  const match = attrs.match(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!match) return false;

  const classes = match[2].split(/\s+/);
  return classes.indexOf('desc') !== -1 && classes.indexOf('h6-md') !== -1;
}

export function sourcePageChineseSubtitleNoticeTextFromHtml(html: string): string | null {
  const h5Pattern = /<h5\b([^>]*)>([\s\S]*?)<\/h5>/gi;
  let match: RegExpExecArray | null;

  while ((match = h5Pattern.exec(html))) {
    if (!classAttributeHasNoticeClasses(match[1])) continue;

    const text = normalizeSourcePageText(match[2]);
    if (text.indexOf(CHINESE_SUBTITLE_NOTICE_TOKEN) !== -1) return text;
  }

  return null;
}

function sanitizeDownloadFileName(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*]/g, ' ')
    .split('')
    .map(function (character) {
      return character.charCodeAt(0) < 32 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return (sanitized || 'video').slice(0, 120);
}

export function videoUrlSlug(videoUrl: string): string {
  try {
    const parts = new URL(videoUrl).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'video';
  } catch (error) {
    return 'video';
  }
}

export function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  const targetPath = path.resolve(filePath);
  const rootPath = path.resolve(directoryPath);
  const normalizedTarget = process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
  const normalizedRoot = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath;

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
}

export function createDownloadRequestBoundary(options: DownloadRequestBoundaryOptions): DownloadRequestBoundary {
  function normalizeDownloadVideoUrl(value: unknown, field: string, channel: string): string {
    const videoUrl = options.canonicalVideoUrl(requiredStringValue(value, field, channel));
    if (!videoUrl) throw new Error(options.t('errors.untrustedDownloadUrl'));
    return videoUrl;
  }

  function normalizeDownloadVideoUrls(value: unknown, channel: string): string[] {
    if (!Array.isArray(value)) throw new Error('Invalid IPC payload for ' + channel + ': videoUrls');
    const urls: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < value.length; index++) {
      const videoUrl = normalizeDownloadVideoUrl(value[index], 'videoUrls[' + index + ']', channel);
      if (seen.has(videoUrl)) continue;
      seen.add(videoUrl);
      urls.push(videoUrl);
    }
    return urls;
  }

  function normalizeDownloadRequestPayload(value: unknown): DownloadRequestPayload {
    const channel = 'download:enqueue';
    const payload = requiredRecord(value, channel);
    const video = requiredRecord(payload.video, channel);

    return {
      collectionKey: normalizeCollectionKey(payload.collectionKey, channel),
      video: {
        title: typeof video.title === 'string' ? video.title : null,
        url: normalizeDownloadVideoUrl(video.url, 'video.url', channel),
        views: null,
        likes: null,
        img: typeof video.img === 'string' ? video.img : null,
        preview: typeof video.preview === 'string' ? video.preview : null
      }
    };
  }

  function resolveManagedDownloadPath(fileRelativePath: string | null): string | null {
    if (!fileRelativePath || path.isAbsolute(fileRelativePath)) return null;

    const downloadRootPath = options.downloadRootPath();
    const filePath = path.resolve(downloadRootPath, fileRelativePath);
    if (!isPathInsideDirectory(filePath, downloadRootPath)) return null;

    return filePath;
  }

  function usedDownloadRelativePaths(excludeVideoUrl: string): Set<string> {
    const used = new Set<string>();
    const records = options.listPersistedDownloads();

    for (const record of records) {
      if (record.videoUrl === excludeVideoUrl || !record.localPath) continue;
      used.add(path.normalize(record.localPath));
    }

    return used;
  }

  function downloadOutputRelativePath(payload: DownloadRequestPayload): string {
    const name = sanitizeDownloadFileName(payload.video.title || videoUrlSlug(payload.video.url));
    const usedPaths = usedDownloadRelativePaths(payload.video.url);

    for (let index = 1; index <= 9999; index++) {
      const candidateName = index === 1 ? name : name + ' (' + index + ')';
      const relativePath = candidateName + '.mp4';
      const filePath = resolveManagedDownloadPath(relativePath);
      if (!filePath) continue;
      if (usedPaths.has(path.normalize(relativePath))) continue;
      if (fs.existsSync(filePath) || fs.existsSync(filePath + '.part')) continue;
      return relativePath;
    }

    throw new Error('Unable to choose a download filename');
  }

  return {
    downloadOutputRelativePath: downloadOutputRelativePath,
    normalizeDownloadRequestPayload: normalizeDownloadRequestPayload,
    normalizeDownloadVideoUrl: normalizeDownloadVideoUrl,
    normalizeDownloadVideoUrls: normalizeDownloadVideoUrls,
    resolveManagedDownloadPath: resolveManagedDownloadPath
  };
}
