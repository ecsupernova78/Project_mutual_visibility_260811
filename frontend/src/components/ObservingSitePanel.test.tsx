import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_OBSERVING_SITES } from '../observingSiteStorage'
import type { ObserverLocation } from '../types'
import { ObservingSitePanel } from './ObservingSitePanel'

const customSite: ObserverLocation = {
  id: 'site-mauna-kea',
  name: 'Mauna Kea (USA)',
  latitude_deg: 19.8207,
  longitude_deg: -155.4681,
  elevation_m: 4205,
}

function renderPanel(overrides: Partial<Parameters<typeof ObservingSitePanel>[0]> = {}) {
  const props: Parameters<typeof ObservingSitePanel>[0] = {
    hidden: false,
    locations: DEFAULT_OBSERVING_SITES,
    selectedLocationIds: new Set(['narrabri', 'pyeongchang']),
    maximumSelected: 3,
    maximumSaved: 50,
    storageWarning: null,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onToggle: vi.fn(),
    onGoToVisibility: vi.fn(),
    ...overrides,
  }
  render(<ObservingSitePanel {...props} />)
  return props
}

describe('ObservingSitePanel', () => {
  it('maps selected sites and lists each pairwise great-circle distance', () => {
    renderPanel()
    const mapCard = screen.getByRole('heading', {
      name: 'Map and Pairwise Distances',
    }).closest('section') as HTMLElement

    expect(within(mapCard).getByRole('region', {
      name: 'Interactive map of selected observing sites',
    })).toBeInTheDocument()
    expect(within(mapCard).getByText('7,848.1 km')).toBeInTheDocument()
    expect(within(mapCard).getByText('Surface great-circle distance; elevation is excluded.'))
      .toBeInTheDocument()
    expect(within(mapCard).getByRole('link', { name: 'OpenStreetMap contributors' }))
      .toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
  })

  it('creates a validated saved profile without silently selecting it', async () => {
    const user = userEvent.setup()
    const props = renderPanel()

    await user.type(screen.getByLabelText('Site name'), 'Mauna Kea (USA)')
    await user.type(screen.getByLabelText('Latitude (N: + / S: −)'), '19.8207')
    await user.type(screen.getByLabelText('Longitude (E: + / W: −)'), '-155.4681')
    await user.type(screen.getByLabelText('Elevation (m)'), '4205')
    await user.click(screen.getByRole('button', { name: 'Save Site' }))

    expect(props.onCreate).toHaveBeenCalledOnce()
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^site-/),
      name: 'Mauna Kea (USA)',
      latitude_deg: 19.8207,
      longitude_deg: -155.4681,
      elevation_m: 4205,
    }))
    expect(props.onToggle).not.toHaveBeenCalled()
    expect(document.querySelector('.site-live-status')).toHaveTextContent(
      'Mauna Kea (USA) was saved. Select it from the list to use it.',
    )
  })

  it('rejects duplicate names and out-of-range coordinates', async () => {
    const user = userEvent.setup()
    const props = renderPanel()

    await user.type(screen.getByLabelText('Site name'), ' narrabri (aus) ')
    await user.type(screen.getByLabelText('Latitude (N: + / S: −)'), '91')
    await user.type(screen.getByLabelText('Longitude (E: + / W: −)'), '10')
    await user.type(screen.getByLabelText('Elevation (m)'), '20')
    await user.click(screen.getByRole('button', { name: 'Save Site' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'An observing site with this name already exists.',
    )
    const nameInput = screen.getByLabelText('Site name')
    await waitFor(() => expect(nameInput).toHaveFocus())
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAccessibleDescription(
      'An observing site with this name already exists.',
    )
    expect(props.onCreate).not.toHaveBeenCalled()

    await user.clear(nameInput)
    await user.type(nameInput, 'Invalid Latitude')
    await user.click(screen.getByRole('button', { name: 'Save Site' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Latitude must be a number from -90 to 90 degrees.',
    )
    const latitudeInput = screen.getByLabelText('Latitude (N: + / S: −)')
    await waitFor(() => expect(latitudeInput).toHaveFocus())
    expect(latitudeInput).toHaveAttribute('aria-invalid', 'true')
  })

  it('edits details while preserving the immutable site id', async () => {
    const user = userEvent.setup()
    const props = renderPanel({ locations: [...DEFAULT_OBSERVING_SITES, customSite] })
    const card = screen.getByText('Mauna Kea (USA)').closest('article') as HTMLElement

    await user.click(within(card).getByRole('button', { name: 'Edit Mauna Kea (USA)' }))
    const nameInput = within(card).getByLabelText('Site name')
    await waitFor(() => expect(nameInput).toHaveFocus())
    await user.clear(nameInput)
    await user.type(nameInput, 'Mauna Kea Observatory')
    await user.click(within(card).getByRole('button', { name: 'Save Changes' }))

    expect(props.onUpdate).toHaveBeenCalledWith({
      ...customSite,
      name: 'Mauna Kea Observatory',
    })
    await waitFor(() => expect(within(card).getByRole('button', {
      name: 'Edit Mauna Kea (USA)',
    })).toHaveFocus())
  })

  it('keeps selected sites removable when the three-site limit is reached', async () => {
    const user = userEvent.setup()
    const props = renderPanel({
      locations: [...DEFAULT_OBSERVING_SITES, customSite],
      selectedLocationIds: new Set(DEFAULT_OBSERVING_SITES.map((site) => site.id)),
    })

    const selectedControl = screen.getByLabelText('Use Narrabri (Aus) in Observation Visibility')
    const unselectedControl = screen.getByLabelText('Use Mauna Kea (USA) in Observation Visibility')
    expect(selectedControl).toBeEnabled()
    expect(unselectedControl).toBeDisabled()
    await user.click(selectedControl)
    expect(props.onToggle).toHaveBeenCalledWith('narrabri')
  })

  it('requires confirmation before removing a user-created profile', async () => {
    const user = userEvent.setup()
    const props = renderPanel({ locations: [...DEFAULT_OBSERVING_SITES, customSite] })
    const card = screen.getByText('Mauna Kea (USA)').closest('article') as HTMLElement

    await user.click(within(card).getByRole('button', { name: 'Delete Mauna Kea (USA)' }))
    expect(props.onDelete).not.toHaveBeenCalled()
    const confirmButton = within(card).getByRole('button', {
      name: 'Confirm deletion of Mauna Kea (USA)',
    })
    await waitFor(() => expect(confirmButton).toHaveFocus())
    await user.click(within(card).getByRole('button', {
      name: 'Confirm deletion of Mauna Kea (USA)',
    }))
    expect(props.onDelete).toHaveBeenCalledWith(customSite.id)
    await waitFor(() => expect(screen.getByRole('heading', {
      name: 'Saved Observing Sites',
    })).toHaveFocus())
  })
})
