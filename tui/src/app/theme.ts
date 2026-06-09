import type { TuiThemeName } from '../types';

export interface TuiTheme {
  name: TuiThemeName;
  label: string;
  description: string;
  background: string;
  panel: string;
  input: string;
  border: string;
  selection: string;
  text: string;
  muted: string;
  blue: string;
  green: string;
  yellow: string;
  purple: string;
  red: string;
  softRed: string;
}

export const DEFAULT_TUI_THEME: TuiThemeName = 'onedark';

export const tuiThemeNames = [
  'onedark',
  'monokai',
  'dracula',
  'catppuccin-mocha',
  'gruvbox-dark',
] as const satisfies readonly TuiThemeName[];

export const tuiThemes: Record<TuiThemeName, TuiTheme> = {
  onedark: {
    name: 'onedark',
    label: 'One Dark',
    description: 'Balanced Atom-inspired dark palette',
    background: '#282c34',
    panel: '#21252b',
    input: '#353b45',
    border: '#4b5263',
    selection: '#3e4451',
    text: '#abb2bf',
    muted: '#7f848e',
    blue: '#61afef',
    green: '#98c379',
    yellow: '#e5c07b',
    purple: '#c678dd',
    red: '#e06c75',
    softRed: '#e9969d',
  },
  monokai: {
    name: 'monokai',
    label: 'Monokai',
    description: 'Classic high-saturation editor palette',
    background: '#272822',
    panel: '#1f201b',
    input: '#3e3d32',
    border: '#5a594b',
    selection: '#49483e',
    text: '#f8f8f2',
    muted: '#a59f85',
    blue: '#66d9ef',
    green: '#a6e22e',
    yellow: '#e6db74',
    purple: '#ae81ff',
    red: '#f92672',
    softRed: '#ff6188',
  },
  dracula: {
    name: 'dracula',
    label: 'Dracula',
    description: 'Punchy purple dark palette',
    background: '#282a36',
    panel: '#21222c',
    input: '#343746',
    border: '#6272a4',
    selection: '#44475a',
    text: '#f8f8f2',
    muted: '#a7abbe',
    blue: '#8be9fd',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    purple: '#bd93f9',
    red: '#ff5555',
    softRed: '#ff6e6e',
  },
  'catppuccin-mocha': {
    name: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    description: 'Soft pastel dark palette',
    background: '#1e1e2e',
    panel: '#181825',
    input: '#313244',
    border: '#585b70',
    selection: '#45475a',
    text: '#cdd6f4',
    muted: '#9399b2',
    blue: '#89b4fa',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    purple: '#cba6f7',
    red: '#f38ba8',
    softRed: '#eba0ac',
  },
  'gruvbox-dark': {
    name: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    description: 'Warm retro low-glare palette',
    background: '#282828',
    panel: '#1d2021',
    input: '#3c3836',
    border: '#665c54',
    selection: '#504945',
    text: '#ebdbb2',
    muted: '#a89984',
    blue: '#83a598',
    green: '#b8bb26',
    yellow: '#fabd2f',
    purple: '#d3869b',
    red: '#fb4934',
    softRed: '#fb6a5a',
  },
};

export const tuiThemeList = tuiThemeNames.map((name) => tuiThemes[name]);

export function isTuiThemeName(value: unknown): value is TuiThemeName {
  return typeof value === 'string' && value in tuiThemes;
}

export function resolveTuiThemeName(value: unknown): TuiThemeName {
  return isTuiThemeName(value) ? value : DEFAULT_TUI_THEME;
}

export function getTuiTheme(name: unknown): TuiTheme {
  return tuiThemes[resolveTuiThemeName(name)];
}
