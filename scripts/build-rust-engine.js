'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'native', 'local-data-engine', 'Cargo.toml');
const crateDir = path.dirname(manifestPath);
const targetTriple = process.env.CARGO_BUILD_TARGET || '';
const releaseDir = targetTriple
  ? path.join(crateDir, 'target', targetTriple, 'release')
  : path.join(crateDir, 'target', 'release');
const nativeDistDir = path.join(rootDir, 'app', 'native-dist');
const outputName = 'jable_data_engine.' + process.platform + '-' + process.arch + '.node';

function cargoBinary() {
  const command = process.platform === 'win32' ? 'where cargo' : 'command -v cargo';

  try {
    return childProcess.execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    throw new Error(
      'Rust cargo is required to build the native data engine. Install Rust and rerun npm run build:rust.'
    );
  }
}

function dynamicLibraryName() {
  if (process.platform === 'darwin') return 'libjable_data_engine.dylib';
  if (process.platform === 'win32') return 'jable_data_engine.dll';
  return 'libjable_data_engine.so';
}

function runCargoBuild() {
  const args = ['build', '--manifest-path', manifestPath, '--release'];
  if (targetTriple) args.push('--target', targetTriple);

  childProcess.execFileSync(cargoBinary(), args, {
    cwd: rootDir,
    stdio: 'inherit'
  });
}

runCargoBuild();
fs.mkdirSync(nativeDistDir, { recursive: true });
const outputPath = path.join(nativeDistDir, outputName);
fs.copyFileSync(path.join(releaseDir, dynamicLibraryName()), outputPath);
if (process.platform === 'darwin') {
  childProcess.execFileSync('codesign', ['--force', '--sign', '-', outputPath], {
    cwd: rootDir,
    stdio: 'inherit'
  });
}
console.log('Built native data engine: app/native-dist/' + outputName);
