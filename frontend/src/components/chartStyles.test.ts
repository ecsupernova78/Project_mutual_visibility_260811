import { describe, expect, it } from 'vitest'

import { getTargetColor } from './chartStyles'

describe('dynamic catalog target colors', () => {
  it('keeps an imported target color independent of a filtered-array index', () => {
    const targetId = 'lotss-dr3-0123456789abcdef'

    expect(getTargetColor(targetId, 0)).toBe(getTargetColor(targetId, 1))
    expect(getTargetColor(targetId, 1)).toBe(getTargetColor(targetId, 24))
  })

  it('preserves the high-contrast colors for the original targets', () => {
    expect(getTargetColor('3c123', 20)).toBe('#0b7f8c')
    expect(getTargetColor('3c273', 0)).toBe('#ad5b00')
  })
})
