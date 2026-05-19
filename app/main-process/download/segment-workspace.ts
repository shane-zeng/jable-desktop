'use strict';

import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';

type DownloadSegmentWorkspaceKey = {
  method: string;
  uri?: string | null;
  iv: string | null;
};

type DownloadSegmentWorkspaceSegment = {
  url: string;
  duration: number | null;
  key: DownloadSegmentWorkspaceKey | null;
};

type DownloadSegmentWorkspacePlaylist = {
  segments: DownloadSegmentWorkspaceSegment[];
  targetDuration: number | null;
};

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

export function downloadSegmentTempDirectory(outputPath: string): string {
  return outputPath + '.segments';
}

function downloadResumeManifestPath(outputPath: string): string {
  return path.join(downloadSegmentTempDirectory(outputPath), 'resume.json');
}

export function removeDownloadSegmentTempDirectory(outputPath: string) {
  try {
    fs.rmSync(downloadSegmentTempDirectory(outputPath), { recursive: true, force: true });
  } catch (error) {}
}

function roundedDuration(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function segmentResumeExtension(url: string): 'aac' | 'm4s' | 'mp4' | 'ts' {
  const withoutQuery = url.split('?')[0] || url;
  const fileName = withoutQuery.split('/').filter(Boolean).pop() || '';
  const extension = fileName.includes('.') ? fileName.split('.').pop() || '' : '';

  if (extension === 'aac' || extension === 'm4s' || extension === 'mp4' || extension === 'ts') return extension;
  return 'ts';
}

function segmentFileName(index: number, url: string): string {
  return 'segment-' + String(index + 1).padStart(6, '0') + '.' + segmentResumeExtension(url);
}

export function downloadSegmentFilePath(outputPath: string, index: number, url: string): string {
  return path.join(downloadSegmentTempDirectory(outputPath), segmentFileName(index, url));
}

function playlistResumeIdentity(playlist: DownloadSegmentWorkspacePlaylist) {
  return {
    version: 2,
    targetDuration: roundedDuration(playlist.targetDuration),
    segments: playlist.segments.map(function (segment) {
      return {
        extension: segmentResumeExtension(segment.url),
        duration: roundedDuration(segment.duration),
        key: segment.key
          ? {
              method: segment.key.method,
              iv: segment.key.iv || null
            }
          : null
      };
    })
  };
}

export function resumeManifestMatches(outputPath: string, playlist: DownloadSegmentWorkspacePlaylist): boolean {
  let current: unknown;
  try {
    current = JSON.parse(fs.readFileSync(downloadResumeManifestPath(outputPath), 'utf8'));
  } catch (error) {
    return false;
  }

  return JSON.stringify(current) === JSON.stringify(playlistResumeIdentity(playlist));
}

export function reusableSegmentFileCount(outputPath: string, playlist: DownloadSegmentWorkspacePlaylist): number {
  let count = 0;

  for (let index = 0; index < playlist.segments.length; index++) {
    const segment = playlist.segments[index];
    if (!segment) continue;

    try {
      const stats = fs.statSync(downloadSegmentFilePath(outputPath, index, segment.url));
      if (stats.isFile() && stats.size > 0) count++;
    } catch (error) {}
  }

  return count;
}

function shouldReuseDownloadSegmentTempDirectory(
  outputPath: string,
  playlist: DownloadSegmentWorkspacePlaylist,
  reuseExistingSegments: boolean
): boolean {
  if (!reuseExistingSegments) return false;
  if (resumeManifestMatches(outputPath, playlist)) return true;

  // Signed HLS URLs can change after pause. Existing complete segment files are
  // still reusable when their stable local index/extension names match.
  return reusableSegmentFileCount(outputPath, playlist) > 0;
}

export function prepareDownloadSegmentTempDirectory(
  outputPath: string,
  playlist: DownloadSegmentWorkspacePlaylist,
  reuseExistingSegments: boolean
) {
  if (!shouldReuseDownloadSegmentTempDirectory(outputPath, playlist, reuseExistingSegments)) {
    removeDownloadSegmentTempDirectory(outputPath);
  }

  const tempDir = downloadSegmentTempDirectory(outputPath);
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(downloadResumeManifestPath(outputPath), JSON.stringify(playlistResumeIdentity(playlist), null, 2));
}

function downloadResumeManifestSegments(outputPath: string): DownloadSegmentWorkspaceSegment[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(downloadResumeManifestPath(outputPath), 'utf8'));
  } catch (error) {
    return [];
  }

  const segments = manifest && typeof manifest === 'object' ? (manifest as { segments?: unknown }).segments : null;
  if (!Array.isArray(segments)) return [];

  return segments.map(function (segment, index) {
    const record = segment && typeof segment === 'object' ? (segment as { extension?: unknown }) : {};
    const extension = typeof record.extension === 'string' && record.extension ? record.extension : 'ts';
    return {
      url: 'playback-capture-segment-' + String(index + 1) + '.' + extension,
      duration: null,
      key: null
    };
  });
}

export function downloadResumeManifestSegmentCount(outputPath: string): number {
  return downloadResumeManifestSegments(outputPath).length;
}

export function capturedSegmentCountFromResumeManifest(outputPath: string): number {
  return reusableSegmentFileCount(outputPath, {
    segments: downloadResumeManifestSegments(outputPath),
    targetDuration: null
  });
}

export function downloadSegmentDirectorySize(tempDir: string): number {
  let total = 0;
  let entries: NodeFs.Dirent[];
  try {
    entries = fs.readdirSync(tempDir, { withFileTypes: true });
  } catch (error) {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/^segment-\d{6}\.(aac|m4s|mp4|ts)$/.test(entry.name)) continue;
    try {
      total += fs.statSync(path.join(tempDir, entry.name)).size;
    } catch (error) {}
  }

  return total;
}
