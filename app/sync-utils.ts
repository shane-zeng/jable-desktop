'use strict';

type PagerLink = {
  pageNumber?: unknown;
};

function numericPage(value: unknown): number | null {
  var n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function chooseNextPagerLink<T extends PagerLink>(links: T[], currentPage: unknown): T | null {
  var current = numericPage(currentPage) || 1;
  var best: { pageNumber: number; link: T } | null = null;

  for (var i = 0; i < links.length; i++) {
    var link = links[i];
    var pageNumber = numericPage(link.pageNumber);
    if (!pageNumber || pageNumber <= current) continue;
    if (!best || pageNumber < best.pageNumber) {
      best = {
        pageNumber: pageNumber,
        link: link
      };
    }
  }

  return best ? best.link : null;
}

module.exports = {
  chooseNextPagerLink: chooseNextPagerLink,
  numericPage: numericPage
};
