'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const targetTriple = process.env.CARGO_BUILD_TARGET || '';
const nativeDistDir = path.join(rootDir, 'app', 'native-dist');
const nativeCrates = [
  {
    manifestPath: path.join(rootDir, 'native', 'local-data-engine', 'Cargo.toml'),
    libraryName: 'jable_data_engine',
    outputName: 'jable_data_engine.' + process.platform + '-' + process.arch + '.node',
    label: 'native data engine'
  },
  {
    manifestPath: path.join(rootDir, 'native', 'download-engine', 'Cargo.toml'),
    libraryName: 'jable_download_engine',
    outputName: 'jable_download_engine.' + process.platform + '-' + process.arch + '.node',
    label: 'native download engine'
  }
];

function cargoBinary() {
  const command = process.platform === 'win32' ? 'where cargo' : 'command -v cargo';

  try {
    return childProcess.execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    throw new Error('Rust cargo is required to build the native engines. Install Rust and rerun npm run build:rust.');
  }
}

function dynamicLibraryName(libraryName) {
  if (process.platform === 'darwin') return 'lib' + libraryName + '.dylib';
  if (process.platform === 'win32') return libraryName + '.dll';
  return 'lib' + libraryName + '.so';
}

function releaseDir(crateDir) {
  return targetTriple
    ? path.join(crateDir, 'target', targetTriple, 'release')
    : path.join(crateDir, 'target', 'release');
}

function runCargoBuild(manifestPath) {
  const args = ['build', '--manifest-path', manifestPath, '--release'];
  if (targetTriple) args.push('--target', targetTriple);

  childProcess.execFileSync(cargoBinary(), args, {
    cwd: rootDir,
    stdio: 'inherit'
  });
}

fs.mkdirSync(nativeDistDir, { recursive: true });
for (const nativeCrate of nativeCrates) {
  const crateDir = path.dirname(nativeCrate.manifestPath);
  runCargoBuild(nativeCrate.manifestPath);

  const outputPath = path.join(nativeDistDir, nativeCrate.outputName);
  fs.copyFileSync(path.join(releaseDir(crateDir), dynamicLibraryName(nativeCrate.libraryName)), outputPath);
  if (process.platform === 'darwin') {
    childProcess.execFileSync('codesign', ['--force', '--sign', '-', outputPath], {
      cwd: rootDir,
      stdio: 'inherit'
    });
  }
  console.log('Built ' + nativeCrate.label + ': app/native-dist/' + nativeCrate.outputName);
}
