'use strict';

const fs = require('node:fs');
const path = require('node:path');

const runtimeDistPath = path.join(__dirname, '..', 'app', 'runtime-dist');

fs.rmSync(runtimeDistPath, { force: true, recursive: true });
