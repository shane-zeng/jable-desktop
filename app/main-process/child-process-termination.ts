'use strict';

import type * as NodeChildProcess from 'node:child_process';

const childProcess: typeof NodeChildProcess = require('node:child_process');

export function terminateChildProcess(processToTerminate: Pick<NodeChildProcess.ChildProcess, 'kill' | 'pid'>) {
  if (process.platform !== 'win32' || !processToTerminate.pid) {
    processToTerminate.kill('SIGTERM');
    return;
  }

  try {
    childProcess.spawn('taskkill.exe', ['/pid', String(processToTerminate.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
  } catch (error) {
    processToTerminate.kill('SIGTERM');
  }
}
