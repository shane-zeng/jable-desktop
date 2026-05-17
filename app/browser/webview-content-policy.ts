'use strict';

type UrlMatcher = (value: unknown) => boolean;

const REMOTE_URL_ATTRIBUTES = ['href', 'src', 'data-src'];
const REMOTE_URL_SELECTOR = 'a[href], img[src], img[data-src], iframe[src], script[src], source[src], video[src]';
const COLLECTION_ACTION_SELECTOR =
  'button.btn-action, button[data-fav-video-id][data-fav-type], .action[data-fav-video-id]';

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

function hasSuppressedRemoteUrl(element: Element, isSuppressedRemoteUrl: UrlMatcher): boolean {
  for (let i = 0; i < REMOTE_URL_ATTRIBUTES.length; i++) {
    const value = element.getAttribute(REMOTE_URL_ATTRIBUTES[i]);
    if (value && isSuppressedRemoteUrl(absoluteElementUrl(element, value))) return true;
  }

  return false;
}

function hasCollectionActionControls(element: Element): boolean {
  return Boolean(element.querySelector(COLLECTION_ACTION_SELECTOR));
}

function externalTextContainerForElement(element: Element): Element {
  const textCenter = element.closest('div.text-center');
  if (textCenter && !hasCollectionActionControls(textCenter)) return textCenter;

  return element;
}

function contentContainerForElement(element: Element): Element {
  const videoBox = element.closest('div.video-img-box');
  if (videoBox) {
    const column = videoBox.parentElement;
    if (isGridColumnElement(column)) return column;
    return videoBox;
  }

  const modalWrapper = closestByClassNamePart(element, 'modelWrapper');
  if (modalWrapper) return modalWrapper;

  const externalTextLink = element.closest('a.text-sponsor');
  if (externalTextLink) return externalTextContainerForElement(externalTextLink);

  const iframe = element.closest('iframe');
  if (iframe) return iframe;

  return element.closest('a[href]') || element;
}

function addWebViewContentContainer(
  element: Element,
  isSuppressedRemoteUrl: UrlMatcher,
  containers: Element[],
  seen: Set<Element>
) {
  if (!hasSuppressedRemoteUrl(element, isSuppressedRemoteUrl)) return;

  const container = contentContainerForElement(element);
  if (seen.has(container)) return;

  seen.add(container);
  containers.push(container);
}

function collectWebViewContentContainers(root: Document | Element, isSuppressedRemoteUrl: UrlMatcher): Element[] {
  const containers: Element[] = [];
  const seen = new Set<Element>();

  if (isElementLike(root)) addWebViewContentContainer(root, isSuppressedRemoteUrl, containers, seen);

  const elements = root.querySelectorAll<Element>(REMOTE_URL_SELECTOR);
  for (let i = 0; i < elements.length; i++) {
    addWebViewContentContainer(elements[i], isSuppressedRemoteUrl, containers, seen);
  }

  return containers;
}

function applyWebViewContentPolicy(root: Document | Element, isSuppressedRemoteUrl: UrlMatcher): number {
  const containers = collectWebViewContentContainers(root, isSuppressedRemoteUrl);

  for (let i = 0; i < containers.length; i++) {
    containers[i].remove();
  }

  return containers.length;
}

module.exports = {
  applyWebViewContentPolicy: applyWebViewContentPolicy,
  collectWebViewContentContainers: collectWebViewContentContainers,
  contentContainerForElement: contentContainerForElement
};
