'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronCommand = path.join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

function run(command, args, options) {
  const result = childProcess.spawnSync(
    command,
    args,
    Object.assign({ cwd: rootDir, stdio: 'inherit' }, options || {})
  );
  if (result.error) throw result.error;
  if (result.status) process.exit(result.status);
}

run(npmCommand, ['run', 'build:rust']);
run(npmCommand, ['run', 'build:electron']);
run(electronCommand, ['.'], {
  env: Object.assign({}, process.env, {
    JABLE_RENDERER_DEV_URL: 'http://127.0.0.1:5173'
  })
});
