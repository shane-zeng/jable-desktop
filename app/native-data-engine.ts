'use strict';

import type * as NodeFs from 'node:fs';
import type * as NodePath from 'node:path';

const fs: typeof NodeFs = require('node:fs');
const path: typeof NodePath = require('node:path');

type NativeDataEngineModule = {
  JableDataEngine: new (filePath: string) => unknown;
};

function nativeFilename() {
  return 'jable_data_engine.' + process.platform + '-' + process.arch + '.node';
}

function nativeCandidates() {
  const filename = nativeFilename();

  return [
    path.join(__dirname, '..', 'native-dist', filename),
    path.join(__dirname, 'native-dist', filename)
  ];
}

export function loadNativeDataEngine(): NativeDataEngineModule {
  const candidates = nativeCandidates();

  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return require(candidates[i]) as NativeDataEngineModule;
  }

  throw new Error(
    'Native data engine is not available for ' +
      process.platform +
      '-' +
      process.arch +
      '. Run npm run build:rust before starting the Rust data engine.'
  );
}
