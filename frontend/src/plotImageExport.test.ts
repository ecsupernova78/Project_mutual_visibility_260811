import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PlotImageExportError,
  copySvgAsPng,
  downloadSvgAsPng,
  sanitizePlotFilename,
  svgToPngBlob,
} from './plotImageExport'

const createObjectUrl = vi.fn<(object: Blob) => string>(() => 'blob:plot-image')
const revokeObjectUrl = vi.fn()
const drawImage = vi.fn()
const fillRect = vi.fn()
const setTransform = vi.fn()
const canvasContext = {
  drawImage,
  fillRect,
  setTransform,
  fillStyle: '',
}
let renderedCanvasSize = { width: 0, height: 0 }

class SuccessfulImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

function createSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 920 382')
  svg.innerHTML = `
    <path class="altitude-line" d="M0,0 L1,1" />
    <rect class="chart-hit-area" />
    <line class="cursor-line" />
    <g class="chart-tooltip"><text>Transient value</text></g>
  `
  return svg
}

function readBlobAsText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('plotImageExport', () => {
  beforeEach(() => {
    createObjectUrl.mockReset().mockReturnValue('blob:plot-image')
    revokeObjectUrl.mockReset()
    drawImage.mockReset()
    fillRect.mockReset()
    setTransform.mockReset()
    canvasContext.fillStyle = ''
    renderedCanvasSize = { width: 0, height: 0 }

    vi.stubGlobal('Image', SuccessfulImage)
    vi.stubGlobal('URL', {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
    ) {
      renderedCanvasSize = { width: this.width, height: this.height }
      callback(new Blob(['png'], { type: 'image/png' }))
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('creates a self-contained 2x PNG with a white background and no transient overlays', async () => {
    const result = await svgToPngBlob(createSvg())

    expect(result.type).toBe('image/png')
    expect(renderedCanvasSize.width).toBe(1840)
    expect(renderedCanvasSize.height).toBe(764)
    expect(canvasContext.fillStyle).toBe('#ffffff')
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1840, 764)
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(drawImage).toHaveBeenCalledWith(expect.any(SuccessfulImage), 0, 0, 920, 382)

    const serialized = await readBlobAsText(createObjectUrl.mock.calls[0][0] as Blob)
    expect(serialized).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(serialized).toContain('altitude-line')
    expect(serialized).not.toContain('chart-hit-area')
    expect(serialized).not.toContain('cursor-line')
    expect(serialized).not.toContain('chart-tooltip')
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:plot-image')
  })

  it('revokes the SVG URL when image rendering fails', async () => {
    class FailedImage extends SuccessfulImage {
      override set src(_value: string) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal('Image', FailedImage)

    await expect(svgToPngBlob(createSvg())).rejects.toThrow(
      'The plot image could not be rendered.',
    )
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:plot-image')
  })

  it('rejects and cleans up when the canvas cannot produce a PNG', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce((callback) => {
      callback(null)
    })

    await expect(svgToPngBlob(createSvg())).rejects.toThrow(
      'The browser could not create a PNG image.',
    )
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:plot-image')
  })

  it('feature-detects clipboard image support before rasterizing', () => {
    vi.stubGlobal('ClipboardItem', undefined)

    expect(() => copySvgAsPng(createSvg())).toThrow(PlotImageExportError)
    expect(() => copySvgAsPng(createSvg())).toThrow('Download the plot instead.')
    expect(createObjectUrl).not.toHaveBeenCalled()
  })

  it('starts clipboard writing synchronously with a promised PNG payload', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    class TestClipboardItem {
      constructor(public data: Record<string, Blob | Promise<Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', TestClipboardItem)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    })

    const operation = copySvgAsPng(createSvg())

    expect(write).toHaveBeenCalledOnce()
    const item = write.mock.calls[0][0][0] as TestClipboardItem
    expect(item.data['image/png']).toBeInstanceOf(Promise)
    await operation
  })

  it('converts a rejected clipboard write into a download-oriented error', async () => {
    const write = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    class TestClipboardItem {
      constructor(public data: Record<string, Blob | Promise<Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', TestClipboardItem)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    })

    await expect(copySvgAsPng(createSvg())).rejects.toThrow('Download the plot instead.')
  })

  it('downloads with a sanitized filename and cleans up its link and object URLs', async () => {
    vi.useFakeTimers()
    createObjectUrl.mockReturnValueOnce('blob:svg').mockReturnValueOnce('blob:png')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await downloadSvgAsPng(createSvg(), '  3C 84: altitude/time?.PNG  ')

    expect(click).toHaveBeenCalledOnce()
    const link = click.mock.instances[0] as HTMLAnchorElement
    expect(link.download).toBe('3c-84-altitude-time.png')
    expect(link.isConnected).toBe(false)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:svg')
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:png')
    vi.advanceTimersByTime(1_000)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:png')
  })

  it('keeps filenames ASCII-safe, bounded, and deterministic', () => {
    expect(sanitizePlotFilename('***')).toBe('altitude-time-plot.png')
    expect(sanitizePlotFilename('대상 3C 84')).toBe('3c-84.png')
    expect(sanitizePlotFilename('A'.repeat(150))).toBe(`${'a'.repeat(96)}.png`)
  })
})
