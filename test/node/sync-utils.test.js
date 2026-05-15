'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const syncUtils = require('../../app/runtime-dist/sync-utils');
const chooseFirstPagerLink = syncUtils.chooseFirstPagerLink;
const chooseNextPagerLink = syncUtils.chooseNextPagerLink;

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

test('chooseFirstPagerLink selects page one from numeric and home labels', function () {
  assert.equal(
    chooseFirstPagerLink([
      { pageNumber: 70, label: '70' },
      { pageNumber: 1, label: '01' },
      { pageNumber: 72, label: '72' }
    ]).label,
    '01'
  );
  assert.equal(
    chooseFirstPagerLink([
      { pageNumber: null, label: '« 首頁' },
      { pageNumber: 70, label: '70' },
      { pageNumber: 72, label: '72' }
    ]).label,
    '« 首頁'
  );
});
