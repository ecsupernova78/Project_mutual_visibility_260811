import { useMemo, useState, type FormEvent } from 'react'

import {
  createObservingSiteId,
  isDefaultObservingSite,
} from '../observingSiteStorage'
import { orderedSelectedSites } from '../observingSiteGeometry'
import type { ObserverLocation } from '../types'
import { ObservingSiteMap } from './ObservingSiteMap'

interface SiteDraft {
  name: string
  latitude: string
  longitude: string
  elevation: string
}

type SiteField = keyof SiteDraft

interface SiteValidationIssue {
  field: SiteField
  message: string
}

interface ObservingSitePanelProps {
  hidden: boolean
  locations: ObserverLocation[]
  selectedLocationIds: ReadonlySet<string>
  maximumSelected: number
  maximumSaved: number
  storageWarning: string | null
  onCreate: (location: ObserverLocation) => void
  onUpdate: (location: ObserverLocation) => void
  onDelete: (id: string) => void
  onToggle: (id: string) => void
  onGoToVisibility: () => void
}

const EMPTY_DRAFT: SiteDraft = {
  name: '',
  latitude: '',
  longitude: '',
  elevation: '',
}

function toDraft(location: ObserverLocation): SiteDraft {
  return {
    name: location.name,
    latitude: String(location.latitude_deg),
    longitude: String(location.longitude_deg),
    elevation: String(location.elevation_m),
  }
}

function validateDraft(
  draft: SiteDraft,
  locations: ObserverLocation[],
  currentId?: string,
): { value: Omit<ObserverLocation, 'id'> } | { error: SiteValidationIssue } {
  const name = draft.name.trim()
  if (!name) return { error: { field: 'name', message: 'Enter a site name.' } }
  if (name.length > 80) {
    return { error: { field: 'name', message: 'Site names can contain up to 80 characters.' } }
  }
  const duplicateName = locations.some((location) => (
    location.id !== currentId && location.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
  ))
  if (duplicateName) {
    return {
      error: { field: 'name', message: 'An observing site with this name already exists.' },
    }
  }

  const latitude = Number(draft.latitude)
  const longitude = Number(draft.longitude)
  const elevation = Number(draft.elevation)
  if (!draft.latitude.trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return {
      error: { field: 'latitude', message: 'Latitude must be a number from -90 to 90 degrees.' },
    }
  }
  if (!draft.longitude.trim() || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return {
      error: {
        field: 'longitude',
        message: 'Longitude must be a number from -180 to 180 degrees.',
      },
    }
  }
  if (!draft.elevation.trim() || !Number.isFinite(elevation) || elevation < -500 || elevation > 10_000) {
    return {
      error: {
        field: 'elevation',
        message: 'Elevation must be a number from -500 to 10,000 metres.',
      },
    }
  }

  return {
    value: {
      name,
      latitude_deg: latitude,
      longitude_deg: longitude === 180 ? -180 : longitude,
      elevation_m: elevation,
    },
  }
}

function SiteFields({
  prefix,
  draft,
  onChange,
  error,
  errorId,
}: {
  prefix: string
  draft: SiteDraft
  onChange: (next: SiteDraft) => void
  error: SiteValidationIssue | null
  errorId: string
}) {
  return (
    <div className="site-form-grid">
      <label className="site-name-field" htmlFor={`${prefix}-name`}>
        <span>Site name</span>
        <input
          id={`${prefix}-name`}
          type="text"
          value={draft.name}
          maxLength={80}
          required
          aria-invalid={error?.field === 'name' || undefined}
          aria-describedby={error?.field === 'name' ? errorId : undefined}
          onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })}
        />
      </label>
      <label htmlFor={`${prefix}-latitude`}>
        <span>Latitude (N: + / S: −)</span>
        <input
          id={`${prefix}-latitude`}
          type="number"
          value={draft.latitude}
          min={-90}
          max={90}
          step="any"
          required
          aria-invalid={error?.field === 'latitude' || undefined}
          aria-describedby={error?.field === 'latitude' ? errorId : undefined}
          onChange={(event) => onChange({ ...draft, latitude: event.currentTarget.value })}
        />
      </label>
      <label htmlFor={`${prefix}-longitude`}>
        <span>Longitude (E: + / W: −)</span>
        <input
          id={`${prefix}-longitude`}
          type="number"
          value={draft.longitude}
          min={-180}
          max={180}
          step="any"
          required
          aria-invalid={error?.field === 'longitude' || undefined}
          aria-describedby={error?.field === 'longitude' ? errorId : undefined}
          onChange={(event) => onChange({ ...draft, longitude: event.currentTarget.value })}
        />
      </label>
      <label htmlFor={`${prefix}-elevation`}>
        <span>Elevation (m)</span>
        <input
          id={`${prefix}-elevation`}
          type="number"
          value={draft.elevation}
          min={-500}
          max={10_000}
          step="any"
          required
          aria-invalid={error?.field === 'elevation' || undefined}
          aria-describedby={error?.field === 'elevation' ? errorId : undefined}
          onChange={(event) => onChange({ ...draft, elevation: event.currentTarget.value })}
        />
      </label>
    </div>
  )
}

export function ObservingSitePanel({
  hidden,
  locations,
  selectedLocationIds,
  maximumSelected,
  maximumSaved,
  storageWarning,
  onCreate,
  onUpdate,
  onDelete,
  onToggle,
  onGoToVisibility,
}: ObservingSitePanelProps) {
  const [newDraft, setNewDraft] = useState<SiteDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<SiteDraft>(EMPTY_DRAFT)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [createError, setCreateError] = useState<SiteValidationIssue | null>(null)
  const [editError, setEditError] = useState<SiteValidationIssue | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const selectionAtLimit = selectedLocationIds.size >= maximumSelected
  const selectedSites = useMemo(
    () => orderedSelectedSites(locations, selectedLocationIds),
    [locations, selectedLocationIds],
  )

  const focusAfterRender = (id: string) => {
    window.setTimeout(() => document.getElementById(id)?.focus(), 0)
  }

  const createSite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreateError(null)
    setStatusMessage('')
    if (locations.length >= maximumSaved) {
      const error = {
        field: 'name' as const,
        message: `You can save up to ${maximumSaved} observing sites in this browser.`,
      }
      setCreateError(error)
      focusAfterRender('new-site-name')
      return
    }
    const validation = validateDraft(newDraft, locations)
    if ('error' in validation) {
      setCreateError(validation.error)
      focusAfterRender(`new-site-${validation.error.field}`)
      return
    }
    const location = { id: createObservingSiteId(), ...validation.value }
    onCreate(location)
    setNewDraft(EMPTY_DRAFT)
    setStatusMessage(`${location.name} was saved. Select it from the list to use it.`)
  }

  const beginEdit = (location: ObserverLocation) => {
    setEditingId(location.id)
    setEditDraft(toDraft(location))
    setPendingDeleteId(null)
    setCreateError(null)
    setEditError(null)
    setStatusMessage('')
    focusAfterRender(`edit-${location.id}-name`)
  }

  const saveEdit = (event: FormEvent<HTMLFormElement>, id: string) => {
    event.preventDefault()
    setEditError(null)
    const validation = validateDraft(editDraft, locations, id)
    if ('error' in validation) {
      setEditError(validation.error)
      focusAfterRender(`edit-${id}-${validation.error.field}`)
      return
    }
    onUpdate({ id, ...validation.value })
    setEditingId(null)
    setStatusMessage(`${validation.value.name} was updated.`)
    focusAfterRender(`edit-site-button-${id}`)
  }

  const confirmDelete = (location: ObserverLocation) => {
    onDelete(location.id)
    setPendingDeleteId(null)
    setEditingId((current) => current === location.id ? null : current)
    setStatusMessage(`${location.name} was removed from the saved list.`)
    focusAfterRender('saved-sites-title')
  }

  return (
    <section
      id="observing-sites-panel"
      role="tabpanel"
      aria-labelledby="observing-sites-tab"
      hidden={hidden}
    >
      <main className="site-catalog-workspace">
      <header className="catalog-hero site-catalog-hero">
        <div>
          <p className="eyebrow">Coordinate Library</p>
          <h1>Observing Sites</h1>
          <p>Create reusable observing-site profiles and edit their geodetic coordinates.</p>
          <p className="site-storage-note">Saved in this browser · Up to {maximumSelected} sites can be used in one calculation</p>
          {storageWarning && <p className="site-storage-warning" role="alert">{storageWarning}</p>}
        </div>
        <div className="catalog-selection-summary" aria-live="polite">
          <span>Selected for visibility</span>
          <strong>{selectedLocationIds.size} / {maximumSelected}</strong>
          <button type="button" onClick={onGoToVisibility}>Use Selected Sites</button>
        </div>
      </header>

      {!hidden && <ObservingSiteMap sites={selectedSites} />}

      <div className="site-manager-grid">
        <section className="site-editor-card" aria-labelledby="new-site-title">
          <div className="site-card-heading">
            <div>
              <p className="eyebrow">New Profile</p>
              <h2 id="new-site-title">Add an Observing Site</h2>
            </div>
            <span>{locations.length} / {maximumSaved} saved</span>
          </div>
          <form noValidate onSubmit={createSite}>
            <SiteFields
              prefix="new-site"
              draft={newDraft}
              error={createError}
              errorId="new-site-error"
              onChange={(next) => {
                setNewDraft(next)
                setCreateError(null)
              }}
            />
            <button className="site-primary-action" type="submit">Save Site</button>
          </form>
          {createError && (
            <p id="new-site-error" className="site-form-error" role="alert">
              {createError.message}
            </p>
          )}
          <p className="site-live-status" role="status" aria-live="polite">{statusMessage}</p>
        </section>

        <section className="site-list-card" aria-labelledby="saved-sites-title">
          <div className="site-card-heading">
            <div>
              <p className="eyebrow">Saved Coordinates</p>
              <h2 id="saved-sites-title" tabIndex={-1}>Saved Observing Sites</h2>
            </div>
            <span>{selectedLocationIds.size} selected</span>
          </div>

          <div className="saved-site-list" role="list" aria-label="Saved observing sites">
            {locations.map((location) => {
              const selected = selectedLocationIds.has(location.id)
              const editing = editingId === location.id
              const pendingDelete = pendingDeleteId === location.id
              return (
                <article
                  className={`saved-site-card ${selected ? 'is-selected' : ''}`}
                  role="listitem"
                  key={location.id}
                >
                  {editing ? (
                    <form noValidate onSubmit={(event) => saveEdit(event, location.id)}>
                      <SiteFields
                        prefix={`edit-${location.id}`}
                        draft={editDraft}
                        error={editError}
                        errorId={`edit-site-error-${location.id}`}
                        onChange={(next) => {
                          setEditDraft(next)
                          setEditError(null)
                        }}
                      />
                      {editError && (
                        <p
                          id={`edit-site-error-${location.id}`}
                          className="site-form-error"
                          role="alert"
                        >
                          {editError.message}
                        </p>
                      )}
                      <div className="site-row-actions">
                        <button className="site-primary-action" type="submit">Save Changes</button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null)
                            setEditError(null)
                            focusAfterRender(`edit-site-button-${location.id}`)
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <label className="saved-site-select">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!selected && selectionAtLimit}
                          aria-label={`Use ${location.name} in Observation Visibility`}
                          aria-describedby={!selected && selectionAtLimit ? 'site-selection-limit' : undefined}
                          onChange={() => onToggle(location.id)}
                        />
                        <span aria-hidden="true">✓</span>
                      </label>
                      <div className="saved-site-details">
                        <span>
                          <strong>{location.name}</strong>
                          <small>{isDefaultObservingSite(location.id) ? 'Preset' : 'Saved'}</small>
                        </span>
                        <dl>
                          <div><dt>Lat</dt><dd>{location.latitude_deg.toFixed(5)}°</dd></div>
                          <div><dt>Lon</dt><dd>{location.longitude_deg.toFixed(5)}°</dd></div>
                          <div><dt>Elevation</dt><dd>{location.elevation_m.toLocaleString('en-US')} m</dd></div>
                        </dl>
                      </div>
                      <div className="site-row-actions">
                        <button
                          type="button"
                          id={`edit-site-button-${location.id}`}
                          aria-label={`Edit ${location.name}`}
                          onClick={() => beginEdit(location)}
                        >
                          Edit
                        </button>
                        {!isDefaultObservingSite(location.id) && (
                          pendingDelete ? (
                            <>
                              <button
                                className="site-danger-action"
                                type="button"
                                id={`confirm-delete-site-button-${location.id}`}
                                aria-label={`Confirm deletion of ${location.name}`}
                                onClick={() => confirmDelete(location)}
                              >
                                Confirm Delete
                              </button>
                              <button
                                type="button"
                                aria-label={`Cancel deletion of ${location.name}`}
                                onClick={() => {
                                  setPendingDeleteId(null)
                                  focusAfterRender(`delete-site-button-${location.id}`)
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="site-danger-action"
                              type="button"
                              id={`delete-site-button-${location.id}`}
                              aria-label={`Delete ${location.name}`}
                              onClick={() => {
                                setPendingDeleteId(location.id)
                                focusAfterRender(`confirm-delete-site-button-${location.id}`)
                              }}
                            >
                              Delete
                            </button>
                          )
                        )}
                      </div>
                    </>
                  )}
                </article>
              )
            })}
          </div>
          {selectionAtLimit && (
            <p id="site-selection-limit" className="site-limit-note">
              {maximumSelected} sites are selected. Deselect one before choosing another.
            </p>
          )}
        </section>
      </div>
      </main>
    </section>
  )
}
