'use strict';

import { installHlsPlaybackProbe } from './probe';
import { installHlsPlaylistProxy } from './proxy-server';
import type { HlsPlaybackCaptureContext } from './shared';

export function installHlsPlaybackCapture(context: HlsPlaybackCaptureContext): Promise<void> {
  installHlsPlaybackProbe(context);
  return installHlsPlaylistProxy(context);
}

module.exports = {
  installHlsPlaybackCapture: installHlsPlaybackCapture
};
