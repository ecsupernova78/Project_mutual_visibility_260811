import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { copySvgAsPng, downloadSvgAsPng } from '../plotImageExport'
import { PlotExportControls } from './PlotExportControls'

vi.mock('../plotImageExport', async (importOriginal) => {
  const original = await importOriginal<typeof import('../plotImageExport')>()
  return {
    ...original,
    copySvgAsPng: vi.fn(),
    downloadSvgAsPng: vi.fn(),
  }
})

const copySvgAsPngMock = vi.mocked(copySvgAsPng)
const downloadSvgAsPngMock = vi.mocked(downloadSvgAsPng)

function Harness({ includePlot = true }: { includePlot?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null)

  return (
    <>
      {includePlot && <svg ref={svgRef} data-testid="plot" />}
      <PlotExportControls
        svgRef={svgRef}
        filename="3C 84 altitude plot"
        plotLabel="3C 84 altitude-time plot"
      />
    </>
  )
}

describe('PlotExportControls', () => {
  beforeEach(() => {
    copySvgAsPngMock.mockReset()
    downloadSvgAsPngMock.mockReset()
  })

  it('renders icon-only actions with accessible names and titles', () => {
    render(<Harness />)

    const copyButton = screen.getByRole('button', { name: 'Copy 3C 84 altitude-time plot image' })
    const downloadButton = screen.getByRole('button', { name: 'Download 3C 84 altitude-time plot image' })

    expect(screen.getByRole('group', { name: '3C 84 altitude-time plot image actions' })).toBeInTheDocument()
    expect(copyButton).toHaveAttribute('title', 'Copy 3C 84 altitude-time plot image')
    expect(downloadButton).toHaveAttribute('title', 'Download 3C 84 altitude-time plot image')
    expect(copyButton).toHaveTextContent('')
    expect(downloadButton).toHaveTextContent('')
    expect(copyButton.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(downloadButton.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('copies the referenced SVG and announces success', async () => {
    const user = userEvent.setup()
    copySvgAsPngMock.mockResolvedValue()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Copy 3C 84 altitude-time plot image' }))

    expect(copySvgAsPngMock).toHaveBeenCalledWith(screen.getByTestId('plot'), undefined)
    expect(screen.getByRole('status')).toHaveTextContent('Plot image copied to the clipboard.')
  })

  it('downloads with the provided filename and keeps failures in an aria-live status', async () => {
    const user = userEvent.setup()
    downloadSvgAsPngMock.mockRejectedValue(new Error('The download was blocked.'))
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Download 3C 84 altitude-time plot image' }))

    await waitFor(() => {
      expect(downloadSvgAsPngMock).toHaveBeenCalledWith(
        screen.getByTestId('plot'),
        '3C 84 altitude plot',
        undefined,
      )
    })
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveTextContent('The download was blocked.')
  })

  it('reports when the referenced plot is not mounted', async () => {
    const user = userEvent.setup()
    render(<Harness includePlot={false} />)

    await user.click(screen.getByRole('button', { name: 'Copy 3C 84 altitude-time plot image' }))

    expect(copySvgAsPngMock).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('The plot is not available yet.')
  })
})
