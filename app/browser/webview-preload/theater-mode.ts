'use strict';

export type TheaterModeResult = {
  enabled: boolean;
  applied: boolean;
  videoUrl: string | null;
  reason?: string;
};

type TheaterModeControllerOptions = {
  currentVideoUrl(): string | null;
  mainVideoElement(): HTMLVideoElement | null;
  sendChanged(result: TheaterModeResult): void;
};

type TheaterModeController = {
  install(): void;
  set(enabled: boolean, failIfMissing: boolean): TheaterModeResult;
  snapshot(): TheaterModeResult;
};

const THEATER_MODE_STYLE_ID = 'jable-desktop-theater-style';
const THEATER_MODE_ROOT_CLASS = 'jable-desktop-theater-active';
const THEATER_MODE_TARGET_CLASS = 'jable-desktop-theater-target';
const THEATER_MODE_APPLY_DELAY_MS = 120;
const THEATER_MODE_PLAYER_SELECTORS = [
  '#player',
  '#video-player',
  '#player-container',
  '.player',
  '.video-player',
  '.video-player-wrapper',
  '.video-container',
  '.embed-responsive',
  '.video-js',
  '.jwplayer',
  '.flowplayer',
  '.fp-player',
  '.fluid_video_wrapper',
  '.fluid_player_layout',
  '.dplayer',
  '.xgplayer',
  '.art-video-player',
  '.mejs__container',
  '.mejs-container',
  '.plyr',
  '.plyr__video-wrapper'
];
const THEATER_MODE_CONTROL_SELECTOR =
  '.vjs-control-bar,.jw-controls,.jw-controlbar,.plyr__controls,.fp-controls,.fp-ui,.fluid_controls_container,' +
  '.dplayer-controller,.xgplayer-controls,.art-controls,.mejs__controls,.mejs-controls';
export const THEATER_MODE_EDITABLE_SHORTCUT_SELECTOR =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';

export function createTheaterModeController(options: TheaterModeControllerOptions): TheaterModeController {
  let preferred = false;
  let appliedElement: HTMLElement | null = null;
  let applyTimer: ReturnType<typeof setTimeout> | null = null;
  let observer: MutationObserver | null = null;

  function installTheaterModeStyle() {
    if (document.getElementById(THEATER_MODE_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = THEATER_MODE_STYLE_ID;
    style.textContent =
      'html.' +
      THEATER_MODE_ROOT_CLASS +
      ',html.' +
      THEATER_MODE_ROOT_CLASS +
      ' body{' +
      'overflow:hidden!important;' +
      '}' +
      '.' +
      THEATER_MODE_TARGET_CLASS +
      '{' +
      'position:fixed!important;' +
      'inset:0!important;' +
      'width:100vw!important;' +
      'height:100vh!important;' +
      'max-width:none!important;' +
      'max-height:none!important;' +
      'margin:0!important;' +
      'padding:0!important;' +
      'transform:none!important;' +
      'z-index:2147483645!important;' +
      'background:#000!important;' +
      'overflow:hidden!important;' +
      'box-sizing:border-box!important;' +
      '}' +
      '.' +
      THEATER_MODE_TARGET_CLASS +
      ' video,' +
      'video.' +
      THEATER_MODE_TARGET_CLASS +
      ',.' +
      THEATER_MODE_TARGET_CLASS +
      ' .vjs-tech,.' +
      THEATER_MODE_TARGET_CLASS +
      ' iframe{' +
      'width:100%!important;' +
      'height:100%!important;' +
      'max-width:none!important;' +
      'max-height:none!important;' +
      'object-fit:contain!important;' +
      'background:#000!important;' +
      '}' +
      '.' +
      THEATER_MODE_TARGET_CLASS +
      ' .video-js,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .jwplayer,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .flowplayer,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .fp-player,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .fluid_video_wrapper,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .fluid_player_layout,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .dplayer,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .xgplayer,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .art-video-player,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .mejs__container,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .mejs-container,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .plyr{' +
      'width:100%!important;' +
      'height:100%!important;' +
      'max-width:none!important;' +
      'max-height:none!important;' +
      '}' +
      '.' +
      THEATER_MODE_TARGET_CLASS +
      ' .vjs-control-bar,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .jw-controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .jw-controlbar,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .plyr__controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .fp-controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .fp-ui,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .fluid_controls_container,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .dplayer-controller,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .xgplayer-controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .art-controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .mejs__controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .mejs-controls{' +
      'z-index:2147483647!important;' +
      'pointer-events:auto!important;' +
      '}' +
      '.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .vjs-control-bar,.' +
      THEATER_MODE_TARGET_CLASS +
      ' .vjs-user-active .vjs-control-bar{' +
      'display:flex!important;' +
      'visibility:visible!important;' +
      'opacity:1!important;' +
      '}' +
      '.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .jw-controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .jw-controlbar,.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .plyr__controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .fp-controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .fp-ui,.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .fluid_controls_container,.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .dplayer-controller,.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .xgplayer-controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .art-controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .mejs__controls,.' +
      THEATER_MODE_TARGET_CLASS +
      ':hover .mejs-controls{' +
      'visibility:visible!important;' +
      'opacity:1!important;' +
      '}';

    (document.head || document.documentElement).appendChild(style);
  }

  function theaterModeTargetForVideo(video: HTMLVideoElement): HTMLElement {
    const playerSelector = THEATER_MODE_PLAYER_SELECTORS.join(',');
    let firstPlayerCandidate: HTMLElement | null = null;
    let controlOwner: HTMLElement | null = null;

    for (let element: HTMLElement | null = video; element; element = element.parentElement) {
      if (element === document.body || element === document.documentElement) break;

      if (!firstPlayerCandidate && element.matches(playerSelector)) {
        firstPlayerCandidate = element;
      }

      if (element.querySelector(THEATER_MODE_CONTROL_SELECTOR)) {
        if (element.matches(playerSelector)) return element;
        if (!controlOwner) controlOwner = element;
      }
    }

    if (controlOwner) return controlOwner;
    if (firstPlayerCandidate) return firstPlayerCandidate;
    if (video.parentElement instanceof HTMLElement) return video.parentElement;
    return video;
  }

  function removeTheaterModeClasses() {
    if (applyTimer) {
      clearTimeout(applyTimer);
      applyTimer = null;
    }

    if (appliedElement) {
      appliedElement.classList.remove(THEATER_MODE_TARGET_CLASS);
      appliedElement = null;
    }

    document.documentElement.classList.remove(THEATER_MODE_ROOT_CLASS);
    if (document.body) document.body.classList.remove(THEATER_MODE_ROOT_CLASS);
  }

  function stopTheaterModeObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  function scheduleTheaterModeApply() {
    if (!preferred || applyTimer) return;

    applyTimer = setTimeout(function () {
      applyTimer = null;
      try {
        applyTheaterMode(false);
      } catch (error) {}
    }, THEATER_MODE_APPLY_DELAY_MS);
  }

  function ensureTheaterModeObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;

    observer = new MutationObserver(function (records) {
      for (let i = 0; i < records.length; i++) {
        if (records[i].type === 'childList' && (records[i].addedNodes.length || records[i].removedNodes.length)) {
          scheduleTheaterModeApply();
          return;
        }
      }
    });
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true
    });
  }

  function theaterModeResult(applied: boolean, reason?: string): TheaterModeResult {
    const videoUrl = options.currentVideoUrl();
    const result: TheaterModeResult = {
      enabled: preferred,
      applied: applied,
      videoUrl: videoUrl
    };

    if (reason) result.reason = reason;
    return result;
  }

  function applyTheaterMode(failIfMissing: boolean): TheaterModeResult {
    if (!preferred) {
      removeTheaterModeClasses();
      stopTheaterModeObserver();
      return theaterModeResult(false, 'disabled');
    }

    ensureTheaterModeObserver();

    if (!options.currentVideoUrl()) {
      removeTheaterModeClasses();
      if (failIfMissing) {
        preferred = false;
        stopTheaterModeObserver();
        throw new Error('No Jable video page found');
      }
      return theaterModeResult(false, 'not_video_page');
    }

    if (document.fullscreenElement) {
      removeTheaterModeClasses();
      return theaterModeResult(false, 'fullscreen');
    }

    const video = options.mainVideoElement();
    if (!video) {
      removeTheaterModeClasses();
      if (failIfMissing) {
        preferred = false;
        stopTheaterModeObserver();
        throw new Error('No video player found');
      }
      return theaterModeResult(false, 'missing_video');
    }

    const target = theaterModeTargetForVideo(video);

    installTheaterModeStyle();
    if (appliedElement && appliedElement !== target) {
      appliedElement.classList.remove(THEATER_MODE_TARGET_CLASS);
    }

    appliedElement = target;
    document.documentElement.classList.add(THEATER_MODE_ROOT_CLASS);
    if (document.body) document.body.classList.add(THEATER_MODE_ROOT_CLASS);
    target.classList.add(THEATER_MODE_TARGET_CLASS);

    return theaterModeResult(true);
  }

  function setTheaterMode(enabled: boolean, failIfMissing: boolean): TheaterModeResult {
    preferred = Boolean(enabled);

    if (!preferred) {
      removeTheaterModeClasses();
      stopTheaterModeObserver();
      return theaterModeResult(false, 'disabled');
    }

    return applyTheaterMode(failIfMissing);
  }

  function isTheaterModeEditableShortcutTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(THEATER_MODE_EDITABLE_SHORTCUT_SELECTOR));
  }

  function isTheaterModeToggleShortcut(event: KeyboardEvent): boolean {
    return (
      event.key.toLowerCase() === 't' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !isTheaterModeEditableShortcutTarget(event.target)
    );
  }

  function toggleTheaterModeFromShortcut(event: KeyboardEvent) {
    if (!isTheaterModeToggleShortcut(event)) return;
    if (!preferred && !options.currentVideoUrl()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const result = setTheaterMode(!preferred, false);
    options.sendChanged(result);
  }

  function installTheaterModeController() {
    document.addEventListener('DOMContentLoaded', scheduleTheaterModeApply, { once: true });
    window.addEventListener('pageshow', scheduleTheaterModeApply);
    window.addEventListener('load', scheduleTheaterModeApply, { once: true });
    document.addEventListener('fullscreenchange', function () {
      if (document.fullscreenElement) {
        removeTheaterModeClasses();
        return;
      }

      scheduleTheaterModeApply();
    });
    document.addEventListener(
      'keydown',
      function (event) {
        if (!preferred || document.fullscreenElement || (event.key !== 'Escape' && event.key !== 'Esc')) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        const result = setTheaterMode(false, false);
        options.sendChanged(result);
      },
      true
    );
    document.addEventListener('keydown', toggleTheaterModeFromShortcut, true);
  }

  return {
    install: installTheaterModeController,
    set: setTheaterMode,
    snapshot: function () {
      return {
        enabled: preferred,
        applied: Boolean(appliedElement),
        videoUrl: options.currentVideoUrl()
      };
    }
  };
}
