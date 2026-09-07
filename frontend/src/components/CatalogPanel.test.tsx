import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CatalogPanel } from './CatalogPanel'

function renderPanel() {
  render(
    <CatalogPanel
      hidden={false}
      selectedSourceIds={new Set()}
      selectedTargetCount={5}
      maximumTargetCount={25}
      onToggleSource={vi.fn()}
      onGoToVisibility={vi.fn()}
    />,
  )
}

describe('CatalogPanel', () => {
  it('provides keyboard-accessible catalog tabs while keeping both providers mounted', async () => {
    const user = userEvent.setup()
    renderPanel()

    const tablist = screen.getByRole('tablist', { name: 'Radio source catalog' })
    const lofarTab = within(tablist).getByRole('tab', { name: /LOFAR DR3/ })
    const vlassTab = within(tablist).getByRole('tab', { name: /VLASS/ })
    expect(lofarTab).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('lofar-provider-panel')).not.toHaveAttribute('hidden')
    expect(document.getElementById('vlass-provider-panel')).toHaveAttribute('hidden')

    lofarTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(vlassTab).toHaveFocus()
    expect(vlassTab).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('lofar-provider-panel')).toHaveAttribute('hidden')
    expect(document.getElementById('vlass-provider-panel')).not.toHaveAttribute('hidden')

    await user.type(screen.getByLabelText('VLASS component ID prefix (optional)'), 'VLASS1QLCIR J12')
    vlassTab.focus()
    await user.keyboard('{Home}')
    expect(lofarTab).toHaveFocus()
    await user.keyboard('{End}')
    expect(vlassTab).toHaveFocus()
    expect(screen.getByLabelText('VLASS component ID prefix (optional)')).toHaveValue('VLASS1QLCIR J12')
  })

  it('uses independent native radio groups and unique labelled panels', () => {
    renderPanel()

    const lofarPanel = document.getElementById('lofar-provider-panel')
    const vlassPanel = document.getElementById('vlass-provider-panel')
    expect(lofarPanel?.querySelectorAll('input[name="lofar-search-mode"]')).toHaveLength(2)
    expect(vlassPanel?.querySelectorAll('input[name="vlass-search-mode"]')).toHaveLength(2)
    expect(document.querySelectorAll('#lofar-search-help')).toHaveLength(1)
    expect(document.querySelectorAll('#vlass-search-help')).toHaveLength(1)
    expect(lofarPanel).toHaveAttribute('aria-labelledby', 'lofar-provider-tab')
    expect(vlassPanel).toHaveAttribute('aria-labelledby', 'vlass-provider-tab')
  })
})
