'use strict';

import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

export type NativeDownloadEngineModule = {
  JableDownloadEngine: new () => {
    downloadHlsSegments(payload: string): Promise<string>;
    cancelDownload(downloadId: string): boolean;
    engineVersion?(): string;
  };
};

function nativeFilename() {
  return 'jable_download_engine.' + process.platform + '-' + process.arch + '.node';
}

function nativeCandidates() {
  const filename = nativeFilename();

  return [
    path.join(__dirname, '..', '..', 'native-dist', filename),
    path.join(__dirname, '..', 'native-dist', filename),
    path.join(__dirname, 'native-dist', filename)
  ];
}

export function loadNativeDownloadEngine(): NativeDownloadEngineModule {
  const candidates = nativeCandidates();

  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return require(candidates[i]) as NativeDownloadEngineModule;
  }

  throw new Error(
    'Native download engine is not available for ' +
      process.platform +
      '-' +
      process.arch +
      '. Run npm run build:rust before starting the Rust download engine.'
  );
}
