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

const FALLBACK_TARGET_COLORS = Object.values(TARGET_COLORS)

export function getTargetColor(targetId: string, fallbackIndex = 0) {
  return TARGET_COLORS[targetId] ?? FALLBACK_TARGET_COLORS[fallbackIndex % FALLBACK_TARGET_COLORS.length]
}
