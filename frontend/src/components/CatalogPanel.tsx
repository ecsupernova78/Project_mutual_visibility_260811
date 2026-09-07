import { useState, type KeyboardEvent } from 'react'

import type { ExternalCatalogSource } from '../types'
import { LofarCatalogPanel } from './LofarCatalogPanel'
import { VlassCatalogPanel } from './VlassCatalogPanel'

type CatalogProvider = 'lofar' | 'vlass'

const PROVIDERS: CatalogProvider[] = ['lofar', 'vlass']
const PROVIDER_TAB_IDS: Record<CatalogProvider, string> = {
  lofar: 'lofar-provider-tab',
  vlass: 'vlass-provider-tab',
}

interface CatalogPanelProps {
  hidden: boolean
  selectedSourceIds: ReadonlySet<string>
  selectedTargetCount: number
  maximumTargetCount: number
  onToggleSource: (source: ExternalCatalogSource) => void
  onGoToVisibility: () => void
}

export function CatalogPanel({
  hidden,
  selectedSourceIds,
  selectedTargetCount,
  maximumTargetCount,
  onToggleSource,
  onGoToVisibility,
}: CatalogPanelProps) {
  const [provider, setProvider] = useState<CatalogProvider>('lofar')

  const activateProvider = (nextProvider: CatalogProvider, moveFocus = false) => {
    setProvider(nextProvider)
    if (moveFocus) {
      window.setTimeout(() => document.getElementById(PROVIDER_TAB_IDS[nextProvider])?.focus(), 0)
    }
  }

  const handleProviderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = PROVIDERS.indexOf(provider)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % PROVIDERS.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + PROVIDERS.length) % PROVIDERS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = PROVIDERS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    activateProvider(PROVIDERS[nextIndex], true)
  }

  return (
    <main
      id="catalog-panel"
      className="catalog-workspace"
      role="tabpanel"
      aria-labelledby="catalog-tab"
      hidden={hidden}
    >
      <header className="catalog-hero">
        <div>
          <p className="eyebrow">RADIO SOURCE CATALOGS</p>
          <h1>Catalog Search</h1>
          <p>
            Browse radio-source catalogs by flux density or sky position and add selected sources to the
            altitude–time calculation.
          </p>
        </div>
        <div className="catalog-selection-summary" aria-live="polite">
          <span>Selected targets</span>
          <strong>{selectedTargetCount} / {maximumTargetCount}</strong>
          <button type="button" onClick={onGoToVisibility}>Go to Observation Setup</button>
        </div>
      </header>

      <nav className="catalog-provider-tabs" role="tablist" aria-label="Radio source catalog">
        <button
          id="lofar-provider-tab"
          type="button"
          role="tab"
          aria-selected={provider === 'lofar'}
          aria-controls="lofar-provider-panel"
          tabIndex={provider === 'lofar' ? 0 : -1}
          onClick={() => activateProvider('lofar')}
          onKeyDown={handleProviderKeyDown}
        >
          <strong>LOFAR DR3</strong>
          <small>LoTSS · 144 MHz</small>
        </button>
        <button
          id="vlass-provider-tab"
          type="button"
          role="tab"
          aria-selected={provider === 'vlass'}
          aria-controls="vlass-provider-panel"
          tabIndex={provider === 'vlass' ? 0 : -1}
          onClick={() => activateProvider('vlass')}
          onKeyDown={handleProviderKeyDown}
        >
          <strong>VLASS</strong>
          <small>Epoch 1 Quick Look · 3 GHz</small>
        </button>
      </nav>

      <LofarCatalogPanel
        hidden={provider !== 'lofar'}
        selectedSourceIds={selectedSourceIds}
        selectedTargetCount={selectedTargetCount}
        maximumTargetCount={maximumTargetCount}
        onToggleSource={onToggleSource}
      />
      <VlassCatalogPanel
        hidden={provider !== 'vlass'}
        selectedSourceIds={selectedSourceIds}
        selectedTargetCount={selectedTargetCount}
        maximumTargetCount={maximumTargetCount}
        onToggleSource={onToggleSource}
      />
    </main>
  )
}
