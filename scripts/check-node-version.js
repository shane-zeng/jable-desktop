'use strict';

var version = process.versions.node;
var major = Number(version.split('.')[0]);

if (major < 24 || major >= 26) {
  console.error('Unsupported Node.js version: v' + version);
  console.error('This project currently supports Node.js >=24.0.0 <26.0.0.');
  console.error('Run `fnm use 24` or `fnm exec --using 24 npm start` before continuing.');
  process.exit(1);
}
