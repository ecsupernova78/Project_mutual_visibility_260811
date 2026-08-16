const DEFAULT_BACKGROUND_COLOR = '#07111f'
const DEFAULT_SCALE = 2
const FALLBACK_WIDTH = 920
const FALLBACK_HEIGHT = 420
const DOWNLOAD_URL_REVOKE_DELAY_MS = 1_000
const TRANSIENT_SELECTORS = ['.chart-hit-area', '.cursor-line', '.chart-tooltip']

export interface SvgPngOptions {
  backgroundColor?: string
  scale?: number
}

export class PlotImageExportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PlotImageExportError'
  }
}

function positiveNumber(value: string | null) {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getSvgDimensions(svg: SVGSVGElement) {
  const viewBoxValues = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const viewBoxWidth = viewBoxValues?.length === 4 && Number.isFinite(viewBoxValues[2])
    ? viewBoxValues[2]
    : null
  const viewBoxHeight = viewBoxValues?.length === 4 && Number.isFinite(viewBoxValues[3])
    ? viewBoxValues[3]
    : null

  return {
    width: positiveNumber(svg.getAttribute('width')) ?? viewBoxWidth ?? FALLBACK_WIDTH,
    height: positiveNumber(svg.getAttribute('height')) ?? viewBoxHeight ?? FALLBACK_HEIGHT,
  }
}

function inlineComputedStyle(source: Element, target: Element) {
  const computed = window.getComputedStyle(source)
  const targetStyle = (target as SVGElement).style

  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index)
    targetStyle.setProperty(
      property,
      computed.getPropertyValue(property),
      computed.getPropertyPriority(property),
    )
  }
}

function createSelfContainedSvg(svg: SVGSVGElement, width: number, height: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const sourceElements = [svg, ...svg.querySelectorAll('*')]
  const clonedElements = [clone, ...clone.querySelectorAll('*')]

  sourceElements.forEach((source, index) => {
    const target = clonedElements[index]
    if (target) inlineComputedStyle(source, target)
  })

  clone.querySelectorAll(TRANSIENT_SELECTORS.join(',')).forEach((element) => element.remove())
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  return new XMLSerializer().serializeToString(clone)
}

function loadSvgImage(objectUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new PlotImageExportError('The plot image could not be rendered.'))
    image.src = objectUrl
  })
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new PlotImageExportError('The browser could not create a PNG image.'))
      }
    }, 'image/png')
  })
}

export function sanitizePlotFilename(filename: string) {
  const withoutExtension = filename.normalize('NFKD').trim().replace(/\.png$/i, '')
  const sanitized = withoutExtension
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 96)
    .replace(/-+$/g, '')

  return `${sanitized || 'altitude-time-plot'}.png`
}

export async function svgToPngBlob(svg: SVGSVGElement, options: SvgPngOptions = {}) {
  const { width, height } = getSvgDimensions(svg)
  const requestedScale = options.scale ?? DEFAULT_SCALE
  const scale = Number.isFinite(requestedScale) && requestedScale > 0
    ? requestedScale
    : DEFAULT_SCALE
  const serializedSvg = createSelfContainedSvg(svg, width, height)
  const svgBlob = new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' })
  const objectUrl = URL.createObjectURL(svgBlob)

  try {
    const image = await loadSvgImage(objectUrl)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)

    const context = canvas.getContext('2d')
    if (!context) {
      throw new PlotImageExportError('The browser does not support plot image rendering.')
    }

    context.fillStyle = options.backgroundColor ?? DEFAULT_BACKGROUND_COLOR
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.drawImage(image, 0, 0, width, height)

    return await canvasToPngBlob(canvas)
  } catch (error) {
    if (error instanceof PlotImageExportError) throw error
    throw new PlotImageExportError('The plot image could not be created.', { cause: error })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function copySvgAsPng(svg: SVGSVGElement, options?: SvgPngOptions) {
  if (
    typeof ClipboardItem === 'undefined'
    || !navigator.clipboard?.write
    || window.isSecureContext === false
  ) {
    throw new PlotImageExportError(
      'Image copying is not available in this browser. Download the plot instead.',
    )
  }

  const pngPromise = svgToPngBlob(svg, options)

  try {
    const writePromise = navigator.clipboard.write([
      new ClipboardItem({ 'image/png': pngPromise }),
    ])

    return writePromise.catch((error: unknown) => {
      throw new PlotImageExportError(
        'The plot image could not be copied. Download the plot instead.',
        { cause: error },
      )
    })
  } catch (error) {
    void pngPromise.catch(() => undefined)
    throw new PlotImageExportError(
      'The plot image could not be copied. Download the plot instead.',
      { cause: error },
    )
  }
}

export async function downloadSvgAsPng(
  svg: SVGSVGElement,
  filename: string,
  options?: SvgPngOptions,
) {
  const blob = await svgToPngBlob(svg, options)
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')

  try {
    link.href = objectUrl
    link.download = sanitizePlotFilename(filename)
    link.hidden = true
    document.body.append(link)
    link.click()
  } catch (error) {
    throw new PlotImageExportError('The plot image could not be downloaded.', { cause: error })
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), DOWNLOAD_URL_REVOKE_DELAY_MS)
  }
}
