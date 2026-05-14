'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const chooseNextPagerLink = require('../../app/runtime-dist/sync-utils').chooseNextPagerLink;

test('chooseNextPagerLink selects the smallest page after the current page', function () {
  const links = [
    { pageNumber: 1, label: '1' },
    { pageNumber: 4, label: '4' },
    { pageNumber: 2, label: '2' },
    { pageNumber: 3, label: '3' }
  ];

  assert.equal(chooseNextPagerLink(links, 2).label, '3');
});

test('chooseNextPagerLink ignores previous pages and non-numeric links', function () {
  const links = [
    { pageNumber: 1, label: '1' },
    { pageNumber: null, label: 'Next' },
    { pageNumber: 2, label: '2' }
  ];

  assert.equal(chooseNextPagerLink(links, 2), null);
});
