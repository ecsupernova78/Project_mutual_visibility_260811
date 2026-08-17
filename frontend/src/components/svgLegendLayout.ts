export const SVG_LEGEND_FONT_SIZE = 16
export const SVG_LEGEND_ROW_HEIGHT = 26
export const SVG_LEGEND_COLUMNS = 3

const APPROXIMATE_CHARACTER_WIDTH = 9.6
const MARKER_AND_TEXT_GAP_WIDTH = 38
const COLUMN_END_PADDING = 18

interface LegendEntry {
  label: string
}

export interface PositionedLegendEntry<T> {
  entry: T
  x: number
  y: number
  textMaxWidth: number
}

export interface SvgLegendGrid<T> {
  items: Array<PositionedLegendEntry<T>>
  rowCount: number
}

export function layoutSvgLegendGrid<T extends LegendEntry>(
  entries: T[],
  options: {
    startX: number
    firstBaselineY: number
    availableWidth: number
    columns?: number
  },
): SvgLegendGrid<T> {
  const columns = Math.max(1, options.columns ?? SVG_LEGEND_COLUMNS)
  const columnWidth = options.availableWidth / columns

  return {
    items: entries.map((entry, index) => ({
      entry,
      x: options.startX + (index % columns) * columnWidth,
      y:
        options.firstBaselineY +
        Math.floor(index / columns) * SVG_LEGEND_ROW_HEIGHT,
      textMaxWidth: Math.max(
        APPROXIMATE_CHARACTER_WIDTH * 4,
        columnWidth - MARKER_AND_TEXT_GAP_WIDTH - COLUMN_END_PADDING,
      ),
    })),
    rowCount: entries.length === 0 ? 0 : Math.ceil(entries.length / columns),
  }
}

export function fitSvgLegendLabel(label: string, maxWidth: number) {
  const maximumCharacters = Math.max(
    4,
    Math.floor(maxWidth / APPROXIMATE_CHARACTER_WIDTH),
  )
  if (label.length <= maximumCharacters) return label
  return `${label.slice(0, maximumCharacters - 1).trimEnd()}…`
}
