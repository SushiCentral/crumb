import type { CSSProperties } from 'react';

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  uiFont: string;
  codeFont: string;
  colors: {
    activity: string; sidebar: string; editor: string; panel: string;
    panelHeader: string; terminal: string; terminalSidebar: string; surface: string;
    border: string; text: string; muted: string; subtle: string;
    accent: string; accentText: string; hover: string; selection: string;
    gutter: string; activeLine: string; warning: string; button: string;
  };
  syntax: {
    keyword: string; function: string; variable: string; string: string;
    number: string; comment: string; operator: string; punctuation: string;
    type: string; property: string; tag: string; attribute: string;
  };
}

export const themes: Theme[] = [
  {
    id: 'crumb', name: 'Crumb', dark: true,
    uiFont: 'Inter', codeFont: 'JetBrains Mono',
    colors: {
      activity: '#171d27', sidebar: '#202937', editor: '#151b24', panel: '#1b2531',
      panelHeader: '#263244', terminal: '#101821', terminalSidebar: '#16202b', surface: '#29384a',
      border: '#344457', text: '#dce7f3', muted: '#a5b7c9', subtle: '#8194a8',
      accent: '#59b9d1', accentText: '#10212a', hover: '#34465a', selection: '#315873',
      gutter: '#8194a8', activeLine: '#202e3d', warning: '#eac176', button: '#59b9d1',
    },
    syntax: {
      keyword: '#c4a6f3', function: '#76bff0', variable: '#dce7f3', string: '#a4d9a0',
      number: '#f2b884', comment: '#899eb0', operator: '#75d2d0', punctuation: '#bccbd8',
      type: '#eed18a', property: '#e9a6ad', tag: '#e9a6ad', attribute: '#f2b884',
    },
  },
  {
    id: 'one-dark', name: 'One Dark', dark: true,
    uiFont: 'Inter', codeFont: 'JetBrains Mono',
    colors: {
      activity: '#21252b', sidebar: '#282c34', editor: '#2c313c', panel: '#242933',
      panelHeader: '#21252b', terminal: '#1f2329', terminalSidebar: '#282c34', surface: '#353b45',
      border: '#3e4451', text: '#abb2bf', muted: '#9da5b4', subtle: '#8a93a3',
      accent: '#61afef', accentText: '#192733', hover: '#3a404a', selection: '#3e5975',
      gutter: '#8a93a3', activeLine: '#353b45', warning: '#e5c07b', button: '#61afef',
    },
    syntax: {
      keyword: '#c678dd', function: '#61afef', variable: '#abb2bf', string: '#98c379',
      number: '#d19a66', comment: '#7f8794', operator: '#56b6c2', punctuation: '#abb2bf',
      type: '#e5c07b', property: '#e06c75', tag: '#e06c75', attribute: '#d19a66',
    },
  },
  {
    id: 'dracula', name: 'Dracula', dark: true,
    uiFont: 'Space Grotesk', codeFont: 'Fira Code',
    colors: {
      activity: '#21222c', sidebar: '#282a36', editor: '#2d3040', panel: '#262837',
      panelHeader: '#343746', terminal: '#21222c', terminalSidebar: '#282a36', surface: '#3d4052',
      border: '#4c5065', text: '#f8f8f2', muted: '#c4c5d1', subtle: '#a7a8b7',
      accent: '#bd93f9', accentText: '#241b36', hover: '#44475a', selection: '#555a78',
      gutter: '#a7a8b7', activeLine: '#383b4e', warning: '#f1fa8c', button: '#bd93f9',
    },
    syntax: {
      keyword: '#ff79c6', function: '#50fa7b', variable: '#f8f8f2', string: '#f1fa8c',
      number: '#bd93f9', comment: '#9a9db2', operator: '#ff79c6', punctuation: '#f8f8f2',
      type: '#8be9fd', property: '#50fa7b', tag: '#ff79c6', attribute: '#f1fa8c',
    },
  },
  {
    id: 'catppuccin-mocha', name: 'Catppuccin Mocha', dark: true,
    uiFont: 'Inter', codeFont: 'JetBrains Mono',
    colors: {
      activity: '#11111b', sidebar: '#181825', editor: '#1e1e2e', panel: '#181825',
      panelHeader: '#242439', terminal: '#11111b', terminalSidebar: '#181825', surface: '#313244',
      border: '#45475a', text: '#cdd6f4', muted: '#bac2de', subtle: '#a6adc8',
      accent: '#89b4fa', accentText: '#11111b', hover: '#313244', selection: '#45475a',
      gutter: '#a6adc8', activeLine: '#29293d', warning: '#f9e2af', button: '#89b4fa',
    },
    syntax: {
      keyword: '#cba6f7', function: '#89b4fa', variable: '#cdd6f4', string: '#a6e3a1',
      number: '#fab387', comment: '#9399b2', operator: '#94e2d5', punctuation: '#bac2de',
      type: '#f9e2af', property: '#f38ba8', tag: '#f38ba8', attribute: '#fab387',
    },
  },
  {
    id: 'catppuccin-latte', name: 'Catppuccin Latte', dark: false,
    uiFont: 'Inter', codeFont: 'JetBrains Mono',
    colors: {
      activity: '#dce0e8', sidebar: '#e6e9ef', editor: '#eff1f5', panel: '#e6e9ef',
      panelHeader: '#dce0e8', terminal: '#f7f8fa', terminalSidebar: '#dce0e8', surface: '#ccd0da',
      border: '#bcc0cc', text: '#4c4f69', muted: '#5c5f77', subtle: '#6c6f85',
      accent: '#1e66f5', accentText: '#ffffff', hover: '#ccd0da', selection: '#bccafa',
      gutter: '#6c6f85', activeLine: '#e2e6ed', warning: '#9a6700', button: '#1e66f5',
    },
    syntax: {
      keyword: '#8839ef', function: '#1e66f5', variable: '#4c4f69', string: '#3b832c',
      number: '#b04d00', comment: '#6c6f85', operator: '#0b8088', punctuation: '#5c5f77',
      type: '#8b6500', property: '#c01c45', tag: '#c01c45', attribute: '#b04d00',
    },
  },
  {
    id: 'nord', name: 'Nord', dark: true,
    uiFont: 'Inter', codeFont: 'IBM Plex Mono',
    colors: {
      activity: '#252d3b', sidebar: '#2e3747', editor: '#303b4d', panel: '#273242',
      panelHeader: '#39475a', terminal: '#242e3d', terminalSidebar: '#303c4d', surface: '#405066',
      border: '#52637a', text: '#eceff4', muted: '#c7d0de', subtle: '#a7b5c8',
      accent: '#88c0d0', accentText: '#172b31', hover: '#405168', selection: '#49697b',
      gutter: '#a7b5c8', activeLine: '#3b4b60', warning: '#ebcb8b', button: '#88c0d0',
    },
    syntax: {
      keyword: '#b48ead', function: '#88c0d0', variable: '#eceff4', string: '#a3be8c',
      number: '#d08770', comment: '#a7b5c8', operator: '#81a1c1', punctuation: '#d8dee9',
      type: '#ebcb8b', property: '#8fbcbb', tag: '#bf616a', attribute: '#d08770',
    },
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night', dark: true,
    uiFont: 'Space Grotesk', codeFont: 'JetBrains Mono',
    colors: {
      activity: '#13141f', sidebar: '#1a1b2b', editor: '#1a1b26', panel: '#161725',
      panelHeader: '#23243a', terminal: '#11121d', terminalSidebar: '#1b1c2c', surface: '#2b2d48',
      border: '#3b3d58', text: '#c0caf5', muted: '#a9b3dc', subtle: '#8993b9',
      accent: '#7aa2f7', accentText: '#121b31', hover: '#30334f', selection: '#36446e',
      gutter: '#8993b9', activeLine: '#24283b', warning: '#e0af68', button: '#7aa2f7',
    },
    syntax: {
      keyword: '#bb9af7', function: '#7aa2f7', variable: '#c0caf5', string: '#9ece6a',
      number: '#ff9e64', comment: '#8993b9', operator: '#89ddff', punctuation: '#a9b1d6',
      type: '#e0af68', property: '#73daca', tag: '#f7768e', attribute: '#ff9e64',
    },
  },
  {
    id: 'gruvbox-dark', name: 'Gruvbox Dark', dark: true,
    uiFont: 'Space Grotesk', codeFont: 'IBM Plex Mono',
    colors: {
      activity: '#1d1b19', sidebar: '#282420', editor: '#282828', panel: '#24211e',
      panelHeader: '#39312a', terminal: '#1e1c1a', terminalSidebar: '#302a24', surface: '#453b32',
      border: '#5a4d3e', text: '#ebdbb2', muted: '#c8b995', subtle: '#ad9d7c',
      accent: '#fabd2f', accentText: '#302417', hover: '#504437', selection: '#66563a',
      gutter: '#ad9d7c', activeLine: '#3c3836', warning: '#fe8019', button: '#fabd2f',
    },
    syntax: {
      keyword: '#fb4934', function: '#8ec07c', variable: '#ebdbb2', string: '#b8bb26',
      number: '#d3869b', comment: '#a89984', operator: '#fe8019', punctuation: '#d5c4a1',
      type: '#fabd2f', property: '#83a598', tag: '#fb4934', attribute: '#fe8019',
    },
  },
  {
    id: 'rose-pine', name: 'Rosé Pine', dark: true,
    uiFont: 'Space Grotesk', codeFont: 'Fira Code',
    colors: {
      activity: '#15131d', sidebar: '#1d1b27', editor: '#191724', panel: '#211f2c',
      panelHeader: '#2b2938', terminal: '#14121c', terminalSidebar: '#242230', surface: '#393644',
      border: '#524f63', text: '#e0def4', muted: '#b9b8d0', subtle: '#908da8',
      accent: '#ebbcba', accentText: '#33252c', hover: '#403b4b', selection: '#51465c',
      gutter: '#908da8', activeLine: '#26233a', warning: '#f6c177', button: '#ebbcba',
    },
    syntax: {
      keyword: '#c4a7e7', function: '#9ccfd8', variable: '#e0def4', string: '#a6d1a9',
      number: '#f6c177', comment: '#908da8', operator: '#ebbcba', punctuation: '#c7c5df',
      type: '#f6c177', property: '#ebbcba', tag: '#eb6f92', attribute: '#f6c177',
    },
  },
  {
    id: 'solarized-light', name: 'Solarized Light', dark: false,
    uiFont: 'Inter', codeFont: 'IBM Plex Mono',
    colors: {
      activity: '#e3d9bd', sidebar: '#eee5cb', editor: '#fdf6e3', panel: '#f2ead4',
      panelHeader: '#e8dec4', terminal: '#fff9e9', terminalSidebar: '#e9dfc7', surface: '#ddd2b7',
      border: '#c9bd9f', text: '#4f5d5d', muted: '#596a6b', subtle: '#667678',
      accent: '#267e92', accentText: '#ffffff', hover: '#e4d9bf', selection: '#c1dce0',
      gutter: '#667678', activeLine: '#eee8d5', warning: '#a75d00', button: '#267e92',
    },
    syntax: {
      keyword: '#6c43a0', function: '#176a9d', variable: '#4f5d5d', string: '#397d0d',
      number: '#b14c17', comment: '#657578', operator: '#178080', punctuation: '#596a6b',
      type: '#986600', property: '#c12a35', tag: '#c12a35', attribute: '#b14c17',
    },
  },
];

export const defaultTheme = themes[0];
export const codeFonts = ['JetBrains Mono', 'IBM Plex Mono', 'Fira Code'] as const;

export function getTheme(id: string): Theme {
  return themes.find(theme => theme.id === id) ?? defaultTheme;
}

export function themeVariables(theme: Theme, codeFont = theme.codeFont): CSSProperties {
  return {
    ...Object.fromEntries(
    Object.entries(theme.colors).map(([key, value]) => [`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value]),
    ),
    '--ui-font': `'${theme.uiFont}', sans-serif`,
    '--code-font': `'${codeFont}', monospace`,
    '--label-heading': `color-mix(in srgb, ${theme.syntax.keyword} 80%, ${theme.colors.text})`,
    '--label-active': `color-mix(in srgb, ${theme.colors.accent} 85%, ${theme.colors.text})`,
    '--label-detail': theme.id === 'solarized-light'
      ? '#346767'
      : `color-mix(in srgb, ${theme.syntax.operator} 60%, ${theme.colors.text})`,
    '--label-context': `color-mix(in srgb, ${theme.syntax.type} 70%, ${theme.colors.text})`,
    '--label-inactive': `color-mix(in srgb, ${theme.colors.muted} 72%, ${theme.syntax.keyword})`,
  } as CSSProperties;
}
