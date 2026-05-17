'use strict';

type PagerLink = {
  label?: unknown;
  pageNumber?: unknown;
};

function numericPage(value: unknown): number | null {
  const n = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function chooseNextPagerLink<T extends PagerLink>(links: T[], currentPage: unknown): T | null {
  const current = numericPage(currentPage) || 1;
  let best: { pageNumber: number; link: T } | null = null;

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const pageNumber = numericPage(link.pageNumber);
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

function isFirstPageLabel(value: unknown): boolean {
  const label = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return Boolean(label && (label.indexOf('首頁') !== -1 || label.indexOf('first') !== -1 || label === 'home'));
}

function chooseFirstPagerLink<T extends PagerLink>(links: T[]): T | null {
  links = Array.isArray(links) ? links : [];

  for (let i = 0; i < links.length; i++) {
    if (numericPage(links[i].pageNumber) === 1) return links[i];
  }

  for (let i = 0; i < links.length; i++) {
    if (isFirstPageLabel(links[i].label)) return links[i];
  }

  return null;
}

module.exports = {
  chooseFirstPagerLink: chooseFirstPagerLink,
  chooseNextPagerLink: chooseNextPagerLink,
  numericPage: numericPage
};
