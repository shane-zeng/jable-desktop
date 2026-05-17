import type { BulkDownloadActionResult, DownloadRecord } from '../types/jable';
import type { ToastTone } from './composables/useToastStatus';
import { isDownloadDeleteSelectable } from './download-display';

export function bulkDownloadActionTone(result: Pick<BulkDownloadActionResult, 'affected' | 'failed'>): ToastTone {
  if (result.failed > 0) return 'warning';
  if (result.affected > 0) return 'success';
  return 'info';
}

export function batchDownloadQueueTone(result: { queued: number; failed: number }): ToastTone {
  if (result.failed > 0) return 'warning';
  if (result.queued > 0) return 'success';
  return 'info';
}

export function bulkDeleteActionTone(result: { removedRecords: number; failed: number }): ToastTone {
  if (result.failed > 0) return 'warning';
  if (result.removedRecords > 0) return 'success';
  return 'info';
}

export function selectedVisibleDownloadUrls(records: DownloadRecord[], selectedUrls: string[]): string[] {
  const selected = new Set(selectedUrls);
  return records
    .filter(function (record) {
      return selected.has(record.videoUrl) && isDownloadDeleteSelectable(record);
    })
    .map(function (record) {
      return record.videoUrl;
    });
}

export function queuedDownloadUrls(records: DownloadRecord[]): string[] {
  return records
    .filter(function (record) {
      return record.state === 'queued';
    })
    .map(function (record) {
      return record.videoUrl;
    });
}
