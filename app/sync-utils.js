// @ts-check
'use strict';

/**
 * @typedef {object} PagerLink
 * @property {unknown} [pageNumber]
 */

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numericPage(value) {
  var n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @template {PagerLink} T
 * @param {T[]} links
 * @param {unknown} currentPage
 * @returns {T | null}
 */
function chooseNextPagerLink(links, currentPage) {
  var current = numericPage(currentPage) || 1;
  /** @type {{ pageNumber: number, link: T } | null} */
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
