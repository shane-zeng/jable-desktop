import type { DownloadRecord, DownloadRequestPayload, DownloadState, VideoRow } from '../types/jable';

type Translate = (key: string, params?: Record<string, string | number | null | undefined>) => string;

const FAILURE_PHASES = ['ffmpeg_check', 'video_page', 'playlist', 'segments', 'remux', 'file'];

export function downloadNotificationTitle(record: DownloadRecord) {
  return record.title || record.videoUrl;
}

export function downloadRequestVideo(video: VideoRow): DownloadRequestPayload['video'] {
  return {
    title: video.title,
    url: video.url,
    views: video.views,
    likes: video.likes,
    img: video.img,
    preview: video.preview
  };
}

export function isDownloadDeleteSelectable(record: DownloadRecord) {
  return (
    record.state === 'ready' || record.state === 'paused' || record.state === 'failed' || record.state === 'missing'
  );
}

export function collectionList(record: DownloadRecord) {
  return Array.isArray(record.collectionKeys) ? record.collectionKeys : [];
}

export function progressPercent(record: DownloadRecord) {
  if (record.state === 'ready') return 100;
  if (record.state === 'failed' || record.state === 'missing') return 100;
  if (record.state === 'downloading' && typeof record.progress === 'number') {
    return Math.max(2, Math.round(Math.min(1, Math.max(0, record.progress)) * 100));
  }
  return 0;
}

export function progressStyle(record: DownloadRecord) {
  return { width: progressPercent(record) + '%' };
}

export function isIndeterminateProgress(record: DownloadRecord) {
  return record.state === 'downloading' && typeof record.progress !== 'number';
}

export function progressLabel(record: DownloadRecord) {
  if (record.state !== 'downloading' || typeof record.progress !== 'number') return '';
  return Math.round(Math.min(1, Math.max(0, record.progress)) * 100) + '%';
}

export function bytesLabel(size: number) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex += 1;
  }

  const formatted =
    unitIndex === 0 || Number.isInteger(value) || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return formatted + ' ' + units[unitIndex];
}

export function formatTimeLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds;
}

export function fileSizeValueLabel(record: DownloadRecord) {
  return bytesLabel(record.fileSizeBytes ?? -1);
}

export function downloadProgressDetailLabel(record: DownloadRecord) {
  if (record.state !== 'downloading') return '';

  const downloaded = bytesLabel(record.downloadedBytes ?? -1);
  const speed = bytesLabel(record.downloadSpeedBytesPerSecond ?? -1);
  const parts = [];

  if (downloaded) parts.push(downloaded);
  if (speed) parts.push(speed + '/s');
  if (!parts.length && progressLabel(record)) parts.push(progressLabel(record));

  return parts.join(' · ');
}

export function downloadErrorSummaryLabel(record: DownloadRecord, t: Translate) {
  if (record.state === 'missing') return t('downloadList.errorReason.missingFile');

  const text = (record.error || '').trim();
  if (!text) return t('downloadList.errorReason.generic');

  if (/取消|cancel/i.test(text)) return t('downloadList.errorReason.cancelled');
  if (/http\s*(401|403|428|429)|precondition|required|forbidden|unauthorized|too many requests/i.test(text)) {
    return t('downloadList.errorReason.accessRejected');
  }
  if (/enoent|no such file|file removed|not found|找不到|遺失/i.test(text)) {
    return t('downloadList.errorReason.missingFile');
  }
  if (/ffmpeg|muxer|output format|invalid argument|remux/i.test(text)) {
    return t('downloadList.errorReason.ffmpeg');
  }
  if (/m3u8|playlist|hls|segment/i.test(text)) return t('downloadList.errorReason.playlist');
  if (/network|timeout|timed out|econn|dns|socket|connection/i.test(text)) {
    return t('downloadList.errorReason.network');
  }
  return t('downloadList.errorReason.generic');
}

export function secondaryInfoLabel(record: DownloadRecord, t: Translate) {
  if (record.state === 'downloading') return downloadProgressDetailLabel(record);
  if (record.state === 'ready') return fileSizeValueLabel(record);
  if (record.state === 'failed' || record.state === 'missing') return downloadErrorSummaryLabel(record, t);
  if (record.state === 'paused') return t('downloadList.pausedHint');
  return '';
}

export function recordTimeLabel(record: DownloadRecord) {
  if (record.state === 'ready') return formatTimeLabel(record.completedAt || record.updatedAt);
  return formatTimeLabel(record.updatedAt);
}

export function downloadFailurePhaseLabel(record: DownloadRecord, t: Translate) {
  const phase = record.failurePhase || 'unknown';
  if (FAILURE_PHASES.indexOf(phase) === -1) return t('downloadList.failurePhaseLabel.unknown');
  return t('downloadList.failurePhaseLabel.' + phase);
}

export function optionalDownloadDetail(value: string | number | null | undefined, t: Translate) {
  if (value === null || typeof value === 'undefined' || value === '') return t('downloadList.notAvailable');
  return String(value);
}

export function isDownloadRunning(state: DownloadState) {
  return state === 'queued' || state === 'downloading';
}
