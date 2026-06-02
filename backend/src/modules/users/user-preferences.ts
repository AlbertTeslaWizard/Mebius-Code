export interface LayoutPreferences {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
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
  },
};

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const source = isRecord(value) ? value : {};
  const layout = isRecord(source.layout) ? source.layout : {};

  return {
    layout: {
      leftSidebarCollapsed: layout.leftSidebarCollapsed === true,
      rightSidebarCollapsed: layout.rightSidebarCollapsed === true,
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

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
