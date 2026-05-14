'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var chooseNextPagerLink = require('../../app/runtime-dist/sync-utils').chooseNextPagerLink;

test('chooseNextPagerLink selects the smallest page after the current page', function () {
  var links = [
    { pageNumber: 1, label: '1' },
    { pageNumber: 4, label: '4' },
    { pageNumber: 2, label: '2' },
    { pageNumber: 3, label: '3' }
  ];

  assert.equal(chooseNextPagerLink(links, 2).label, '3');
});

test('chooseNextPagerLink ignores previous pages and non-numeric links', function () {
  var links = [
    { pageNumber: 1, label: '1' },
    { pageNumber: null, label: 'Next' },
    { pageNumber: 2, label: '2' }
  ];

  assert.equal(chooseNextPagerLink(links, 2), null);
});
