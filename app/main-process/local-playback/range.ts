'use strict';

export type LocalPlaybackRange =
  | {
      satisfiable: true;
      start: number;
      end: number;
      status: 200 | 206;
    }
  | {
      satisfiable: false;
      status: 416;
    };

export function parseLocalPlaybackRangeHeader(value: string | null, size: number): LocalPlaybackRange {
  const fileSize = Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
  const range = String(value || '').trim();
  if (!range) {
    return {
      satisfiable: true,
      start: 0,
      end: Math.max(0, fileSize - 1),
      status: 200
    };
  }

  const match = range.match(/^bytes=([^,]+)$/);
  if (!match || fileSize <= 0) return { satisfiable: false, status: 416 };

  const parts = match[1].split('-');
  if (parts.length !== 2) return { satisfiable: false, status: 416 };

  const startText = parts[0].trim();
  const endText = parts[1].trim();
  if (!startText && !endText) return { satisfiable: false, status: 416 };

  let start: number;
  let end: number;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { satisfiable: false, status: 416 };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : fileSize - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      return { satisfiable: false, status: 416 };
    }
    if (start >= fileSize) return { satisfiable: false, status: 416 };
    end = Math.min(end, fileSize - 1);
  }

  return {
    satisfiable: true,
    start: start,
    end: end,
    status: 206
  };
}
