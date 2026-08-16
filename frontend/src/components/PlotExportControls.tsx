import { useId, useState, type RefObject } from 'react'

import {
  copySvgAsPng,
  downloadSvgAsPng,
  type SvgPngOptions,
} from '../plotImageExport'
import './PlotExportControls.css'

interface PlotExportControlsProps {
  svgRef: RefObject<SVGSVGElement | null>
  filename: string
  plotLabel: string
  exportOptions?: SvgPngOptions
}

type ExportAction = 'copy' | 'download'

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M5 19h14" />
    </svg>
  )
}

export function PlotExportControls({
  svgRef,
  filename,
  plotLabel,
  exportOptions,
}: PlotExportControlsProps) {
  const statusId = useId()
  const [activeAction, setActiveAction] = useState<ExportAction | null>(null)
  const [status, setStatus] = useState('')

  const runExport = async (action: ExportAction) => {
    const svg = svgRef.current
    if (!svg) {
      setStatus('The plot is not available yet.')
      return
    }

    setActiveAction(action)
    setStatus('')

    try {
      if (action === 'copy') {
        await copySvgAsPng(svg, exportOptions)
        setStatus('Plot image copied to the clipboard.')
      } else {
        await downloadSvgAsPng(svg, filename, exportOptions)
        setStatus('Plot image downloaded.')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The plot image could not be exported.')
    } finally {
      setActiveAction(null)
    }
  }

  const isBusy = activeAction !== null

  return (
    <div className="plot-export-controls" role="group" aria-label={`${plotLabel} image actions`}>
      <button
        type="button"
        className="plot-export-button"
        aria-label={`Copy ${plotLabel} image`}
        aria-describedby={statusId}
        title={`Copy ${plotLabel} image`}
        disabled={isBusy}
        onClick={() => void runExport('copy')}
      >
        <CopyIcon />
      </button>
      <button
        type="button"
        className="plot-export-button"
        aria-label={`Download ${plotLabel} image`}
        aria-describedby={statusId}
        title={`Download ${plotLabel} image`}
        disabled={isBusy}
        onClick={() => void runExport('download')}
      >
        <DownloadIcon />
      </button>
      <span id={statusId} className="plot-export-status" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  )
}
