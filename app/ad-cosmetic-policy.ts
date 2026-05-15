'use strict';

type AdUrlMatcher = (value: unknown) => boolean;

const AD_URL_ATTRIBUTES = ['href', 'src', 'data-src'];
const AD_URL_SELECTOR = 'a[href], img[src], img[data-src], iframe[src], script[src], source[src], video[src]';

function isElementLike(value: unknown): value is Element {
  return Boolean(
    value &&
    typeof (value as Element).getAttribute === 'function' &&
    typeof (value as Element).querySelectorAll === 'function'
  );
}

function absoluteElementUrl(element: Element, value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '';

  try {
    return new URL(text, element.baseURI || undefined).href;
  } catch (error) {
    return text;
  }
}

function isGridColumnElement(element: Element | null): element is Element {
  if (!element || !element.classList) return false;

  for (let i = 0; i < element.classList.length; i++) {
    if (element.classList[i].indexOf('col-') === 0) return true;
  }

  return false;
}

function closestByClassNamePart(element: Element, classNamePart: string): Element | null {
  let current: Element | null = element;

  while (current) {
    const className = typeof current.className === 'string' ? current.className : '';
    if (className.indexOf(classNamePart) !== -1) return current;
    current = current.parentElement;
  }

  return null;
}

function hasBlockedAdUrl(element: Element, isBlockedAdUrl: AdUrlMatcher): boolean {
  for (let i = 0; i < AD_URL_ATTRIBUTES.length; i++) {
    const value = element.getAttribute(AD_URL_ATTRIBUTES[i]);
    if (value && isBlockedAdUrl(absoluteElementUrl(element, value))) return true;
  }

  return false;
}

function cosmeticAdContainerForElement(element: Element): Element {
  const videoBox = element.closest('div.video-img-box');
  if (videoBox) {
    const column = videoBox.parentElement;
    if (isGridColumnElement(column)) return column;
    return videoBox;
  }

  const modalWrapper = closestByClassNamePart(element, 'modelWrapper');
  if (modalWrapper) return modalWrapper;

  const textSponsor = element.closest('a.text-sponsor');
  if (textSponsor) return textSponsor.closest('div.text-center') || textSponsor;

  const iframe = element.closest('iframe');
  if (iframe) return iframe;

  return element.closest('a[href]') || element;
}

function addCosmeticAdContainer(
  element: Element,
  isBlockedAdUrl: AdUrlMatcher,
  containers: Element[],
  seen: Set<Element>
) {
  if (!hasBlockedAdUrl(element, isBlockedAdUrl)) return;

  const container = cosmeticAdContainerForElement(element);
  if (seen.has(container)) return;

  seen.add(container);
  containers.push(container);
}

function collectCosmeticAdContainers(root: Document | Element, isBlockedAdUrl: AdUrlMatcher): Element[] {
  const containers: Element[] = [];
  const seen = new Set<Element>();

  if (isElementLike(root)) addCosmeticAdContainer(root, isBlockedAdUrl, containers, seen);

  const elements = root.querySelectorAll<Element>(AD_URL_SELECTOR);
  for (let i = 0; i < elements.length; i++) {
    addCosmeticAdContainer(elements[i], isBlockedAdUrl, containers, seen);
  }

  return containers;
}

function removeCosmeticAds(root: Document | Element, isBlockedAdUrl: AdUrlMatcher): number {
  const containers = collectCosmeticAdContainers(root, isBlockedAdUrl);

  for (let i = 0; i < containers.length; i++) {
    containers[i].remove();
  }

  return containers.length;
}

module.exports = {
  collectCosmeticAdContainers: collectCosmeticAdContainers,
  cosmeticAdContainerForElement: cosmeticAdContainerForElement,
  removeCosmeticAds: removeCosmeticAds
};
