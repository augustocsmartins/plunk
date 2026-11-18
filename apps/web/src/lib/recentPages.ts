import {t} from './i18n';
const RECENT_KEY = 'cmdPaletteRecents';
const MAX_RECENT = 5;

export interface RecentPage {
  label: string;
  href: string;
}

export function getRecentPages(): RecentPage[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as RecentPage[];
  } catch {
    return [];
  }
}

export function addRecentPage(page: RecentPage) {
  const current = getRecentPages().filter(p => p.href !== page.href);
  localStorage.setItem(RECENT_KEY, JSON.stringify([page, ...current].slice(0, MAX_RECENT)));
}

const STATIC_LABELS: Record<string, string> = {
  '/': t('Dashboard'),
  '/contacts': t('Contacts'),
  '/segments': t('Segments'),
  '/activity': t('Activity'),
  '/analytics': t('Analytics'),
  '/templates': t('Templates'),
  '/workflows': t('Workflows'),
  '/campaigns': t('Campaigns'),
  '/settings': t('Settings'),
  '/campaigns/create': t('New Campaign'),
  '/templates/create': t('New Template'),
  '/segments/new': t('New Segment'),
};

const DYNAMIC_LABELS: [RegExp, string][] = [
  [/^\/contacts\/[^/]+$/, 'Contact'],
  [/^\/segments\/[^/]+$/, 'Segment'],
  [/^\/workflows\/[^/]+$/, 'Workflow'],
  [/^\/campaigns\/[^/]+$/, 'Campaign'],
  [/^\/templates\/[^/]+$/, 'Template'],
];

export function getFallbackLabel(pathname: string): string | null {
  if (STATIC_LABELS[pathname]) return STATIC_LABELS[pathname];
  for (const [pattern, label] of DYNAMIC_LABELS) {
    if (pattern.test(pathname)) return label;
  }
  return null;
}
