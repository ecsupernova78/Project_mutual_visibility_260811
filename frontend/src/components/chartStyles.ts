export interface SiteChartStyle {
  color: string
  dash?: string
  kind: 'solid' | 'dashed' | 'dotted'
}

const SITE_STYLES: Record<string, SiteChartStyle> = {
  narrabri: { color: '#0b7f8c', kind: 'solid' },
  pyeongchang: { color: '#ad5b00', dash: '9 6', kind: 'dashed' },
  fushan: { color: '#7854bd', dash: '2 5', kind: 'dotted' },
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
  '3c123': '#0b7f8c',
  '3c273': '#ad5b00',
  '3c433': '#7854bd',
  '3c295': '#16785f',
  '3c134': '#b53a4d',
}

const CATALOG_TARGET_COLORS = [
  '#0b7f8c',
  '#ad5b00',
  '#7854bd',
  '#16785f',
  '#b53a4d',
  '#3d72c9',
  '#80720b',
  '#9c4da2',
  '#498431',
  '#a13d7e',
  '#357963',
  '#a75438',
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
