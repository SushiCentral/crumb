import type { CSSProperties } from 'react';

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
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
];

export const defaultTheme = themes[0];

export function getTheme(id: string): Theme {
  return themes.find(theme => theme.id === id) ?? defaultTheme;
}

export function themeVariables(theme: Theme): CSSProperties {
  return Object.fromEntries(
    Object.entries(theme.colors).map(([key, value]) => [`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value]),
  ) as CSSProperties;
}
