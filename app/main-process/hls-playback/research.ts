'use strict';

import { installHlsPlaybackCapture } from './capture';
import type { HlsPlaybackCaptureContext } from './shared';

export type HlsPlaybackResearchContext = HlsPlaybackCaptureContext;

export function installHlsPlaybackResearch(context: HlsPlaybackResearchContext): Promise<void> {
  return installHlsPlaybackCapture(context);
}

module.exports = {
  installHlsPlaybackResearch: installHlsPlaybackResearch
};
