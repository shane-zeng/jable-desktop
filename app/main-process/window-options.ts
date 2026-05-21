'use strict';

export type MainWindowDimensions = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
};

type WorkAreaSize = {
  width: number;
  height: number;
};

const STANDARD_MAIN_WINDOW_DIMENSIONS: MainWindowDimensions = {
  width: 1360,
  height: 860,
  minWidth: 1100,
  minHeight: 680
};

const WINDOWS_MAIN_WINDOW_DIMENSIONS: MainWindowDimensions = {
  width: 1500,
  height: 940,
  minWidth: 1100,
  minHeight: 680
};

const WORK_AREA_MARGIN = 48;

export function mainWindowDimensions(platform: string, workAreaSize?: WorkAreaSize | null): MainWindowDimensions {
  const preferred = platform === 'win32' ? WINDOWS_MAIN_WINDOW_DIMENSIONS : STANDARD_MAIN_WINDOW_DIMENSIONS;

  if (!workAreaSize) return Object.assign({}, preferred);

  return {
    width: clampDimension(preferred.width, preferred.minWidth, workAreaSize.width),
    height: clampDimension(preferred.height, preferred.minHeight, workAreaSize.height),
    minWidth: preferred.minWidth,
    minHeight: preferred.minHeight
  };
}

function clampDimension(preferred: number, minimum: number, workAreaDimension: number): number {
  const available = Math.floor(workAreaDimension) - WORK_AREA_MARGIN;

  if (available <= 0) return preferred;

  return Math.max(minimum, Math.min(preferred, available));
}
