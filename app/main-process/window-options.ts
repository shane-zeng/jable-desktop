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

type WorkAreaBounds = WorkAreaSize & {
  x: number;
  y: number;
};

export type MainWindowSize = {
  width: number;
  height: number;
};

export type MainWindowSavedState = MainWindowSize & {
  x?: number | null;
  y?: number | null;
  maximized?: boolean;
};

export type MainWindowPlacement = MainWindowDimensions & {
  x?: number;
  y?: number;
  maximized: boolean;
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

export function mainWindowDimensions(
  platform: string,
  workAreaSize?: WorkAreaSize | null,
  savedSize?: MainWindowSize | null
): MainWindowDimensions {
  const defaults = platform === 'win32' ? WINDOWS_MAIN_WINDOW_DIMENSIONS : STANDARD_MAIN_WINDOW_DIMENSIONS;
  const preferred = Object.assign({}, defaults, {
    width: normalizePreferredDimension(savedSize && savedSize.width, defaults.width),
    height: normalizePreferredDimension(savedSize && savedSize.height, defaults.height)
  });

  if (!workAreaSize) {
    return {
      width: Math.max(preferred.minWidth, preferred.width),
      height: Math.max(preferred.minHeight, preferred.height),
      minWidth: preferred.minWidth,
      minHeight: preferred.minHeight
    };
  }

  return {
    width: clampDimension(preferred.width, preferred.minWidth, workAreaSize.width),
    height: clampDimension(preferred.height, preferred.minHeight, workAreaSize.height),
    minWidth: preferred.minWidth,
    minHeight: preferred.minHeight
  };
}

export function mainWindowPlacement(
  platform: string,
  workAreas?: WorkAreaBounds[] | null,
  savedState?: MainWindowSavedState | null
): MainWindowPlacement {
  const normalizedAreas = normalizeWorkAreas(workAreas);
  const savedBounds = normalizeSavedBounds(savedState);
  const selectedArea = savedBounds ? bestWorkAreaForBounds(normalizedAreas, savedBounds) : normalizedAreas[0] || null;
  const dimensions = mainWindowDimensions(platform, selectedArea, savedState);
  const placement: MainWindowPlacement = {
    width: dimensions.width,
    height: dimensions.height,
    minWidth: dimensions.minWidth,
    minHeight: dimensions.minHeight,
    maximized: Boolean(savedState && savedState.maximized)
  };

  if (savedBounds && selectedArea) {
    const fitted = fitBoundsWithinWorkArea(
      {
        x: savedBounds.x,
        y: savedBounds.y,
        width: dimensions.width,
        height: dimensions.height
      },
      selectedArea
    );
    placement.x = fitted.x;
    placement.y = fitted.y;
  }

  return placement;
}

function normalizePreferredDimension(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const rounded = Math.round(number);
  return rounded > 0 ? rounded : fallback;
}

function clampDimension(preferred: number, minimum: number, workAreaDimension: number): number {
  const available = Math.floor(workAreaDimension) - WORK_AREA_MARGIN;

  if (available <= 0) return preferred;

  return Math.max(minimum, Math.min(preferred, available));
}

function normalizeWorkAreas(value?: WorkAreaBounds[] | null): WorkAreaBounds[] {
  if (!Array.isArray(value)) return [];

  const workAreas: WorkAreaBounds[] = [];
  for (const item of value) {
    const x = finiteInteger(item && item.x);
    const y = finiteInteger(item && item.y);
    const width = positiveInteger(item && item.width);
    const height = positiveInteger(item && item.height);
    if (x === null || y === null || width === null || height === null) continue;
    workAreas.push({
      x: x,
      y: y,
      width: width,
      height: height
    });
  }

  return workAreas;
}

function normalizeSavedBounds(value?: MainWindowSavedState | null): WorkAreaBounds | null {
  const x = finiteInteger(value && value.x);
  const y = finiteInteger(value && value.y);
  const width = positiveInteger(value && value.width);
  const height = positiveInteger(value && value.height);
  if (x === null || y === null || width === null || height === null) return null;

  return {
    x: x,
    y: y,
    width: width,
    height: height
  };
}

function finiteInteger(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
}

function positiveInteger(value: unknown): number | null {
  const number = finiteInteger(value);
  return number !== null && number > 0 ? number : null;
}

function bestWorkAreaForBounds(workAreas: WorkAreaBounds[], bounds: WorkAreaBounds): WorkAreaBounds | null {
  if (!workAreas.length) return null;

  let bestArea = workAreas[0];
  let bestOverlap = -1;

  for (const workArea of workAreas) {
    const overlap = intersectionArea(workArea, bounds);
    if (overlap > bestOverlap) {
      bestArea = workArea;
      bestOverlap = overlap;
    }
  }

  if (bestOverlap > 0) return bestArea;
  return closestWorkAreaToBounds(workAreas, bounds);
}

function intersectionArea(a: WorkAreaBounds, b: WorkAreaBounds): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function closestWorkAreaToBounds(workAreas: WorkAreaBounds[], bounds: WorkAreaBounds): WorkAreaBounds {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  let bestArea = workAreas[0];
  let bestDistance = Infinity;

  for (const workArea of workAreas) {
    const areaCenterX = workArea.x + workArea.width / 2;
    const areaCenterY = workArea.y + workArea.height / 2;
    const distance = Math.pow(centerX - areaCenterX, 2) + Math.pow(centerY - areaCenterY, 2);
    if (distance < bestDistance) {
      bestArea = workArea;
      bestDistance = distance;
    }
  }

  return bestArea;
}

function fitBoundsWithinWorkArea(bounds: WorkAreaBounds, workArea: WorkAreaBounds): WorkAreaBounds {
  const maxX = workArea.x + Math.max(0, workArea.width - bounds.width);
  const maxY = workArea.y + Math.max(0, workArea.height - bounds.height);

  return {
    x: Math.max(workArea.x, Math.min(bounds.x, maxX)),
    y: Math.max(workArea.y, Math.min(bounds.y, maxY)),
    width: bounds.width,
    height: bounds.height
  };
}
