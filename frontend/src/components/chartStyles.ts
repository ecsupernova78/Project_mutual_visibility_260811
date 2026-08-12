export interface SiteChartStyle {
  color: string
  dash?: string
  kind: 'solid' | 'dashed' | 'dotted'
}

const SITE_STYLES: Record<string, SiteChartStyle> = {
  narrabri: { color: '#62dbe7', kind: 'solid' },
  pyeongchang: { color: '#ffbd73', dash: '9 6', kind: 'dashed' },
  fushan: { color: '#b69cff', dash: '2 5', kind: 'dotted' },
}

const FALLBACK_STYLES: SiteChartStyle[] = [
  SITE_STYLES.narrabri,
  SITE_STYLES.pyeongchang,
  SITE_STYLES.fushan,
]

export function getSiteChartStyle(locationId: string, fallbackIndex = 0) {
  return SITE_STYLES[locationId] ?? FALLBACK_STYLES[fallbackIndex % FALLBACK_STYLES.length]
}

const TARGET_COLORS: Record<string, string> = {
  '3c123': '#62dbe7',
  '3c273': '#ffbd73',
  '3c433': '#b69cff',
  '3c295': '#7de1ca',
  '3c134': '#ff8f95',
}

const CATALOG_TARGET_COLORS = [
  '#58d6e8',
  '#f4ae6a',
  '#a995f5',
  '#75d9bc',
  '#f58291',
  '#76a9ff',
  '#e6ca6d',
  '#d890dc',
  '#8dd36f',
  '#ef8fcb',
  '#77c3a8',
  '#eea180',
]

export function getTargetColor(targetId: string, _fallbackIndex = 0) {
  void _fallbackIndex
  const knownColor = TARGET_COLORS[targetId]
  if (knownColor) return knownColor

  // Dynamic catalog targets must keep the same color when another target is
  // hidden from the overview.  A stable ID hash avoids subset-index colors.
  let hash = 2166136261
  for (const character of targetId) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return CATALOG_TARGET_COLORS[(hash >>> 0) % CATALOG_TARGET_COLORS.length]
}
