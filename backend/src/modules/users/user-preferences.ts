export interface LayoutPreferences {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  sessionPaneCollapsed: boolean;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
}

export type ThemeMode = 'dark' | 'light';

export interface ThemePreferences {
  mode: ThemeMode;
}

export interface UserPreferences {
  layout: LayoutPreferences;
  theme: ThemePreferences;
}

export type UserPreferencesPatch = {
  layout?: Partial<LayoutPreferences>;
  theme?: Partial<ThemePreferences>;
};

export const defaultUserPreferences: UserPreferences = {
  layout: {
    leftSidebarCollapsed: false,
    rightSidebarCollapsed: false,
    sessionPaneCollapsed: false,
    leftSidebarWidth: 280,
    rightSidebarWidth: 420,
  },
  theme: {
    mode: 'dark',
  },
};

const layoutWidthLimits = {
  leftSidebarWidth: { min: 220, max: 420, defaultValue: 280 },
  rightSidebarWidth: { min: 320, max: 820, defaultValue: 420 },
} as const;

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const source = isRecord(value) ? value : {};
  const layout = isRecord(source.layout) ? source.layout : {};
  const theme = isRecord(source.theme) ? source.theme : {};

  return {
    layout: {
      leftSidebarCollapsed: layout.leftSidebarCollapsed === true,
      rightSidebarCollapsed: layout.rightSidebarCollapsed === true,
      sessionPaneCollapsed: layout.sessionPaneCollapsed === true,
      leftSidebarWidth: normalizeLayoutWidth(layout.leftSidebarWidth, layoutWidthLimits.leftSidebarWidth),
      rightSidebarWidth: normalizeLayoutWidth(layout.rightSidebarWidth, layoutWidthLimits.rightSidebarWidth),
    },
    theme: {
      mode: normalizeThemeMode(theme.mode),
    },
  };
}

export function mergeUserPreferences(
  current: unknown,
  patch: UserPreferencesPatch,
): UserPreferences {
  const next = normalizeUserPreferences(current);

  if (typeof patch.layout?.leftSidebarCollapsed === 'boolean') {
    next.layout.leftSidebarCollapsed = patch.layout.leftSidebarCollapsed;
  }
  if (typeof patch.layout?.rightSidebarCollapsed === 'boolean') {
    next.layout.rightSidebarCollapsed = patch.layout.rightSidebarCollapsed;
  }
  if (typeof patch.layout?.sessionPaneCollapsed === 'boolean') {
    next.layout.sessionPaneCollapsed = patch.layout.sessionPaneCollapsed;
  }
  if (typeof patch.layout?.leftSidebarWidth === 'number') {
    next.layout.leftSidebarWidth = normalizeLayoutWidth(
      patch.layout.leftSidebarWidth,
      layoutWidthLimits.leftSidebarWidth,
    );
  }
  if (typeof patch.layout?.rightSidebarWidth === 'number') {
    next.layout.rightSidebarWidth = normalizeLayoutWidth(
      patch.layout.rightSidebarWidth,
      layoutWidthLimits.rightSidebarWidth,
    );
  }
  if (patch.theme?.mode === 'dark' || patch.theme?.mode === 'light') {
    next.theme.mode = patch.theme.mode;
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLayoutWidth(
  value: unknown,
  limits: { min: number; max: number; defaultValue: number },
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return limits.defaultValue;
  }
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' ? 'light' : 'dark';
}
