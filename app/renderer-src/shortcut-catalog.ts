import type { AppPlatform } from '../types/jable';

export type ShortcutPlatform = 'macos' | 'windowsLinux';
export type ShortcutCategory = 'appViews' | 'browserTabs' | 'videoPage' | 'quickActions';
export type ShortcutSource =
  | 'browser-shortcut-manager'
  | 'browser-tab-policy'
  | 'theater-mode'
  | 'webview-preload'
  | 'video-card';
export type ShortcutKeyToken =
  | '1'
  | '2'
  | 'Alt'
  | 'Click'
  | 'Command'
  | 'Control'
  | 'Ctrl'
  | 'Esc'
  | 'F5'
  | 'Left'
  | 'MiddleClick'
  | 'Option'
  | 'PageDown'
  | 'PageUp'
  | 'R'
  | 'Right'
  | 'S'
  | 'Shift'
  | 'T'
  | 'Tab'
  | 'W'
  | '['
  | ']';
export type ShortcutCombo = ShortcutKeyToken[];

export type ShortcutCatalogItem = {
  id: string;
  category: ShortcutCategory;
  labelKey: string;
  descriptionKey: string;
  scopeKey: string;
  keys: Record<ShortcutPlatform, ShortcutCombo[]>;
  sources: ShortcutSource[];
};

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = ['appViews', 'browserTabs', 'videoPage', 'quickActions'];

export const SHORTCUT_CATALOG: ShortcutCatalogItem[] = [
  {
    id: 'switch-browser-view',
    category: 'appViews',
    labelKey: 'settings.shortcuts.items.switchBrowserView.label',
    descriptionKey: 'settings.shortcuts.items.switchBrowserView.description',
    scopeKey: 'settings.shortcuts.scope.app',
    keys: {
      macos: [['Command', '1']],
      windowsLinux: [['Ctrl', '1']]
    },
    sources: ['browser-shortcut-manager']
  },
  {
    id: 'switch-local-data-view',
    category: 'appViews',
    labelKey: 'settings.shortcuts.items.switchLocalDataView.label',
    descriptionKey: 'settings.shortcuts.items.switchLocalDataView.description',
    scopeKey: 'settings.shortcuts.scope.app',
    keys: {
      macos: [['Command', '2']],
      windowsLinux: [['Ctrl', '2']]
    },
    sources: ['browser-shortcut-manager']
  },
  {
    id: 'new-browser-tab',
    category: 'browserTabs',
    labelKey: 'settings.shortcuts.items.newBrowserTab.label',
    descriptionKey: 'settings.shortcuts.items.newBrowserTab.description',
    scopeKey: 'settings.shortcuts.scope.browser',
    keys: {
      macos: [['Command', 'T']],
      windowsLinux: [['Ctrl', 'T']]
    },
    sources: ['browser-shortcut-manager']
  },
  {
    id: 'close-current-tab',
    category: 'browserTabs',
    labelKey: 'settings.shortcuts.items.closeCurrentTab.label',
    descriptionKey: 'settings.shortcuts.items.closeCurrentTab.description',
    scopeKey: 'settings.shortcuts.scope.browser',
    keys: {
      macos: [['Command', 'W']],
      windowsLinux: [['Ctrl', 'W']]
    },
    sources: ['browser-shortcut-manager']
  },
  {
    id: 'reload-current-tab',
    category: 'browserTabs',
    labelKey: 'settings.shortcuts.items.reloadCurrentTab.label',
    descriptionKey: 'settings.shortcuts.items.reloadCurrentTab.description',
    scopeKey: 'settings.shortcuts.scope.browser',
    keys: {
      macos: [['Command', 'R'], ['F5']],
      windowsLinux: [['Ctrl', 'R'], ['F5']]
    },
    sources: ['browser-shortcut-manager', 'browser-tab-policy']
  },
  {
    id: 'hard-reload-current-tab',
    category: 'browserTabs',
    labelKey: 'settings.shortcuts.items.hardReloadCurrentTab.label',
    descriptionKey: 'settings.shortcuts.items.hardReloadCurrentTab.description',
    scopeKey: 'settings.shortcuts.scope.browser',
    keys: {
      macos: [
        ['Shift', 'Command', 'R'],
        ['Option', 'Command', 'R'],
        ['Shift', 'F5']
      ],
      windowsLinux: [
        ['Ctrl', 'Shift', 'R'],
        ['Ctrl', 'F5'],
        ['Shift', 'F5']
      ]
    },
    sources: ['browser-shortcut-manager', 'browser-tab-policy']
  },
  {
    id: 'next-browser-tab',
    category: 'browserTabs',
    labelKey: 'settings.shortcuts.items.nextBrowserTab.label',
    descriptionKey: 'settings.shortcuts.items.nextBrowserTab.description',
    scopeKey: 'settings.shortcuts.scope.browser',
    keys: {
      macos: [
        ['Control', 'Tab'],
        ['Option', 'Command', 'Right'],
        ['Shift', 'Command', ']']
      ],
      windowsLinux: [
        ['Ctrl', 'Tab'],
        ['Ctrl', 'PageDown']
      ]
    },
    sources: ['browser-shortcut-manager', 'browser-tab-policy']
  },
  {
    id: 'previous-browser-tab',
    category: 'browserTabs',
    labelKey: 'settings.shortcuts.items.previousBrowserTab.label',
    descriptionKey: 'settings.shortcuts.items.previousBrowserTab.description',
    scopeKey: 'settings.shortcuts.scope.browser',
    keys: {
      macos: [
        ['Control', 'Shift', 'Tab'],
        ['Option', 'Command', 'Left'],
        ['Shift', 'Command', '[']
      ],
      windowsLinux: [
        ['Ctrl', 'Shift', 'Tab'],
        ['Ctrl', 'PageUp']
      ]
    },
    sources: ['browser-shortcut-manager', 'browser-tab-policy']
  },
  {
    id: 'toggle-compact-tabs',
    category: 'browserTabs',
    labelKey: 'settings.shortcuts.items.toggleCompactTabs.label',
    descriptionKey: 'settings.shortcuts.items.toggleCompactTabs.description',
    scopeKey: 'settings.shortcuts.scope.browser',
    keys: {
      macos: [['Command', 'S']],
      windowsLinux: [['Ctrl', 'S']]
    },
    sources: ['browser-shortcut-manager']
  },
  {
    id: 'toggle-theater-mode',
    category: 'videoPage',
    labelKey: 'settings.shortcuts.items.toggleTheaterMode.label',
    descriptionKey: 'settings.shortcuts.items.toggleTheaterMode.description',
    scopeKey: 'settings.shortcuts.scope.videoPage',
    keys: {
      macos: [['T']],
      windowsLinux: [['T']]
    },
    sources: ['theater-mode']
  },
  {
    id: 'exit-theater-mode',
    category: 'videoPage',
    labelKey: 'settings.shortcuts.items.exitTheaterMode.label',
    descriptionKey: 'settings.shortcuts.items.exitTheaterMode.description',
    scopeKey: 'settings.shortcuts.scope.videoPage',
    keys: {
      macos: [['Esc']],
      windowsLinux: [['Esc']]
    },
    sources: ['theater-mode']
  },
  {
    id: 'open-browser-link-background',
    category: 'quickActions',
    labelKey: 'settings.shortcuts.items.openBrowserLinkBackground.label',
    descriptionKey: 'settings.shortcuts.items.openBrowserLinkBackground.description',
    scopeKey: 'settings.shortcuts.scope.embeddedBrowser',
    keys: {
      macos: [['MiddleClick']],
      windowsLinux: [['MiddleClick']]
    },
    sources: ['webview-preload']
  },
  {
    id: 'open-local-video-background',
    category: 'quickActions',
    labelKey: 'settings.shortcuts.items.openLocalVideoBackground.label',
    descriptionKey: 'settings.shortcuts.items.openLocalVideoBackground.description',
    scopeKey: 'settings.shortcuts.scope.localData',
    keys: {
      macos: [['Command', 'Click'], ['MiddleClick']],
      windowsLinux: [['Ctrl', 'Click'], ['MiddleClick']]
    },
    sources: ['video-card']
  }
];

const MACOS_KEY_LABELS: Record<ShortcutKeyToken, string> = {
  '1': '1',
  '2': '2',
  Alt: 'Alt',
  Click: 'Click',
  Command: '⌘',
  Control: '⌃',
  Ctrl: 'Ctrl',
  Esc: 'Esc',
  F5: 'F5',
  Left: '←',
  MiddleClick: 'Middle Click',
  Option: '⌥',
  PageDown: 'Page Down',
  PageUp: 'Page Up',
  R: 'R',
  Right: '→',
  S: 'S',
  Shift: '⇧',
  T: 'T',
  Tab: 'Tab',
  W: 'W',
  '[': '[',
  ']': ']'
};

const TEXT_KEY_LABELS: Record<ShortcutKeyToken, string> = {
  '1': '1',
  '2': '2',
  Alt: 'Alt',
  Click: 'Click',
  Command: 'Command',
  Control: 'Control',
  Ctrl: 'Ctrl',
  Esc: 'Esc',
  F5: 'F5',
  Left: 'Left',
  MiddleClick: 'Middle Click',
  Option: 'Option',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  R: 'R',
  Right: 'Right',
  S: 'S',
  Shift: 'Shift',
  T: 'T',
  Tab: 'Tab',
  W: 'W',
  '[': '[',
  ']': ']'
};

export function shortcutPlatformFromAppPlatform(platform: AppPlatform | null | undefined): ShortcutPlatform {
  return platform === 'macos' ? 'macos' : 'windowsLinux';
}

export function shortcutCombosForPlatform(
  item: ShortcutCatalogItem,
  platform: AppPlatform | null | undefined
): ShortcutCombo[] {
  return item.keys[shortcutPlatformFromAppPlatform(platform)];
}

export function formatShortcutKeyToken(token: ShortcutKeyToken, platform: AppPlatform | null | undefined): string {
  return shortcutPlatformFromAppPlatform(platform) === 'macos' ? MACOS_KEY_LABELS[token] : TEXT_KEY_LABELS[token];
}

export function isShortcutSymbolToken(token: ShortcutKeyToken, platform: AppPlatform | null | undefined): boolean {
  if (shortcutPlatformFromAppPlatform(platform) !== 'macos') return false;
  return (
    token === 'Command' ||
    token === 'Control' ||
    token === 'Option' ||
    token === 'Shift' ||
    token === 'Left' ||
    token === 'Right'
  );
}

export function isShortcutMacosToken(token: ShortcutKeyToken, platform: AppPlatform | null | undefined): boolean {
  if (shortcutPlatformFromAppPlatform(platform) !== 'macos') return false;
  return token !== 'MiddleClick' && token !== 'Click';
}

export function formatShortcutCombo(combo: ShortcutCombo, platform: AppPlatform | null | undefined): string {
  return combo
    .map(function (key) {
      return formatShortcutKeyToken(key, platform);
    })
    .join(shortcutPlatformFromAppPlatform(platform) === 'macos' ? '' : '+');
}
