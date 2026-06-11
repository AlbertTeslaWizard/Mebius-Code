import type { SkillDetail } from './discovery';

export interface SkillsPaletteModel {
  selectedIndex: number;
  query: string;
  view: 'list' | 'detail';
  detailSkillId?: string;
  detail?: SkillDetail;
  detailLoading?: boolean;
  detailError?: string;
}

export function closeOrReturnSkillsPaletteOnEscape(palette: SkillsPaletteModel): SkillsPaletteModel | null {
  if (palette.view === 'detail') {
    return {
      ...palette,
      view: 'list',
      detailSkillId: undefined,
      detail: undefined,
      detailLoading: false,
      detailError: undefined,
    };
  }
  return null;
}

export function moveSkillSelection(currentIndex: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (currentIndex + delta + count) % count;
}

export function clampSkillSelection(currentIndex: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(currentIndex, 0), count - 1);
}

export function parseSkillsCommand(value: string): string | null {
  if (value === '/skills') return '';
  if (value.startsWith('/skills ')) return value.slice('/skills'.length).trimStart();
  return null;
}
