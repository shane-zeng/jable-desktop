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
    outputName: 'jable_data_engine.' + nativePlatform() + '-' + nativeArch() + '.node',
    label: 'native data engine'
  },
  {
    manifestPath: path.join(rootDir, 'native', 'download-engine', 'Cargo.toml'),
    libraryName: 'jable_download_engine',
    outputName: 'jable_download_engine.' + nativePlatform() + '-' + nativeArch() + '.node',
    label: 'native download engine'
  }
];

function nativePlatform() {
  if (/windows|msvc|mingw/i.test(targetTriple)) return 'win32';
  if (/apple|darwin/i.test(targetTriple)) return 'darwin';
  if (/linux/i.test(targetTriple)) return 'linux';
  return process.env.JABLE_NATIVE_PLATFORM || process.platform;
}

function nativeArch() {
  if (/^aarch64/i.test(targetTriple)) return 'arm64';
  if (/^x86_64/i.test(targetTriple)) return 'x64';
  if (/^i686/i.test(targetTriple)) return 'ia32';
  return process.env.JABLE_NATIVE_ARCH || process.arch;
}

function cargoBinary() {
  const command = process.platform === 'win32' ? 'where cargo' : 'command -v cargo';

  try {
    const output = childProcess.execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const candidates = output
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
    if (candidates[0]) return candidates[0];
    throw new Error('cargo was not found');
  } catch (error) {
    throw new Error('Rust cargo is required to build the native engines. Install Rust and rerun npm run build:rust.');
  }
}

function dynamicLibraryName(libraryName) {
  const platform = nativePlatform();
  if (platform === 'darwin') return 'lib' + libraryName + '.dylib';
  if (platform === 'win32') return libraryName + '.dll';
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

fs.rmSync(nativeDistDir, { force: true, recursive: true });
fs.mkdirSync(nativeDistDir, { recursive: true });
for (const nativeCrate of nativeCrates) {
  const crateDir = path.dirname(nativeCrate.manifestPath);
  runCargoBuild(nativeCrate.manifestPath);

  const outputPath = path.join(nativeDistDir, nativeCrate.outputName);
  fs.copyFileSync(path.join(releaseDir(crateDir), dynamicLibraryName(nativeCrate.libraryName)), outputPath);
  if (nativePlatform() === 'darwin' && process.platform === 'darwin') {
    childProcess.execFileSync('codesign', ['--force', '--sign', '-', outputPath], {
      cwd: rootDir,
      stdio: 'inherit'
    });
  }
  console.log('Built ' + nativeCrate.label + ': app/native-dist/' + nativeCrate.outputName);
}
