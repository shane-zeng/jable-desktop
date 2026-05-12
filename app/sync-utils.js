'use strict';

function numericPage(value) {
  var n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function chooseNextPagerLink(links, currentPage) {
  var current = numericPage(currentPage) || 1;
  var best = null;

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
