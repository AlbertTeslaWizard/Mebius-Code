export interface LayoutPreferences {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
}

export interface UserPreferences {
  layout: LayoutPreferences;
}

export type UserPreferencesPatch = {
  layout?: Partial<LayoutPreferences>;
};

export const defaultUserPreferences: UserPreferences = {
  layout: {
    leftSidebarCollapsed: false,
    rightSidebarCollapsed: false,
    leftSidebarWidth: 280,
    rightSidebarWidth: 420,
  },
};

const layoutWidthLimits = {
  leftSidebarWidth: { min: 220, max: 420, defaultValue: 280 },
  rightSidebarWidth: { min: 320, max: 820, defaultValue: 420 },
} as const;

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const source = isRecord(value) ? value : {};
  const layout = isRecord(source.layout) ? source.layout : {};

  return {
    layout: {
      leftSidebarCollapsed: layout.leftSidebarCollapsed === true,
      rightSidebarCollapsed: layout.rightSidebarCollapsed === true,
      leftSidebarWidth: normalizeLayoutWidth(layout.leftSidebarWidth, layoutWidthLimits.leftSidebarWidth),
      rightSidebarWidth: normalizeLayoutWidth(layout.rightSidebarWidth, layoutWidthLimits.rightSidebarWidth),
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
