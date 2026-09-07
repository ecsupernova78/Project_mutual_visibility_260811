import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ObserverLocation } from '../types'
import { ObservingSiteMap } from './ObservingSiteMap'

const OPEN_FREE_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const OPEN_FREE_MAP_MAX_ZOOM = 18
const OPEN_FREE_MAP_ATTRIBUTION = [
  '<a href="https://openfreemap.org/">OpenFreeMap</a>',
  '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a>',
  'Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
].join(' &middot; ')
const ENGLISH_MAP_LABEL_FIELD = [
  'coalesce',
  ['get', 'name:en'],
  ['get', 'name_en'],
  ['get', 'name:latin'],
  '',
]

type LngLat = [longitude: number, latitude: number]

interface MockGeoJSONSourceRecord {
  data: unknown
  setDataCalls: unknown[]
  setData: (data: unknown) => Promise<void>
}

interface MockMapRecord {
  options: Record<string, unknown>
  handlers: Map<string, Set<() => void>>
  styleLayers: Array<Record<string, unknown> & {
    id: string
    type: string
    layout?: Record<string, unknown>
  }>
  layoutPropertyCalls: Array<{ id: string; name: string; value: unknown }>
  controls: Array<{ control: unknown; position: string }>
  sources: Map<string, MockGeoJSONSourceRecord>
  layers: Array<Record<string, unknown>>
  fitBoundsCalls: Array<{
    bounds: LngLat[]
    options: Record<string, unknown>
  }>
  jumpToCalls: Array<Record<string, unknown>>
  resizeCalls: number
  removed: boolean
  emit: (event: string) => void
}

interface MockMarkerRecord {
  options: { anchor?: string; element?: HTMLElement }
  coordinate: LngLat | null
  map: MockMapRecord | null
  removed: boolean
}

const maplibreState = vi.hoisted(() => ({
  maps: [] as MockMapRecord[],
  markers: [] as MockMarkerRecord[],
  navigationControls: [] as Array<Record<string, unknown>>,
  workerUrls: [] as string[],
}))

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: 'mock-maplibre-worker.js',
}))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

vi.mock('maplibre-gl', () => {
  class MockLngLatBounds {
    coordinates: LngLat[] = []

    extend(coordinate: LngLat) {
      this.coordinates.push([...coordinate] as LngLat)
      return this
    }
  }

  class MockMap {
    constructor(options: Record<string, unknown>) {
      const handlers = new Map<string, Set<() => void>>()
      const record: MockMapRecord = {
        options,
        handlers,
        styleLayers: [
          {
            id: 'label_city',
            type: 'symbol',
            layout: { 'text-field': ['get', 'name'] },
          },
          {
            id: 'road_shield',
            type: 'symbol',
            layout: { 'text-field': ['get', 'ref'] },
          },
          { id: 'water', type: 'fill' },
        ],
        layoutPropertyCalls: [],
        controls: [],
        sources: new Map(),
        layers: [],
        fitBoundsCalls: [],
        jumpToCalls: [],
        resizeCalls: 0,
        removed: false,
        emit(event: string) {
          handlers.get(event)?.forEach((handler) => handler())
        },
      }
      maplibreState.maps.push(record)
      return Object.assign(record, {
        addControl(control: unknown, position: string) {
          record.controls.push({ control, position })
          return this
        },
        addLayer(layer: Record<string, unknown>) {
          record.layers.push(layer)
          return this
        },
        addSource(id: string, specification: { data: unknown }) {
          const source: MockGeoJSONSourceRecord = {
            data: specification.data,
            setDataCalls: [],
            async setData(data: unknown) {
              source.data = data
              source.setDataCalls.push(data)
            },
          }
          record.sources.set(id, source)
          return this
        },
        fitBounds(bounds: MockLngLatBounds, fitOptions: Record<string, unknown>) {
          record.fitBoundsCalls.push({
            bounds: bounds.coordinates.map((coordinate) => [...coordinate] as LngLat),
            options: fitOptions,
          })
          return this
        },
        getSource(id: string) {
          return record.sources.get(id)
        },
        getStyle() {
          return { version: 8, sources: {}, layers: record.styleLayers }
        },
        jumpTo(jumpOptions: Record<string, unknown>) {
          record.jumpToCalls.push(jumpOptions)
          return this
        },
        off(event: string, handler: () => void) {
          handlers.get(event)?.delete(handler)
          return this
        },
        on(event: string, handler: () => void) {
          const eventHandlers = handlers.get(event) ?? new Set<() => void>()
          eventHandlers.add(handler)
          handlers.set(event, eventHandlers)
          return this
        },
        remove() {
          record.removed = true
        },
        resize() {
          record.resizeCalls += 1
          return this
        },
        setLayoutProperty(id: string, name: string, value: unknown) {
          record.layoutPropertyCalls.push({ id, name, value })
          const layer = record.styleLayers.find((item) => item.id === id)
          if (layer) layer.layout = { ...layer.layout, [name]: value }
          return this
        },
      })
    }
  }

  class MockMarker {
    private readonly record: MockMarkerRecord

    constructor(options: MockMarkerRecord['options']) {
      this.record = { options, coordinate: null, map: null, removed: false }
      maplibreState.markers.push(this.record)
    }

    addTo(map: MockMapRecord) {
      this.record.map = map
      return this
    }

    remove() {
      this.record.removed = true
      return this
    }

    setLngLat(coordinate: LngLat) {
      this.record.coordinate = [...coordinate] as LngLat
      return this
    }
  }

  class MockNavigationControl {
    options: Record<string, unknown>

    constructor(options: Record<string, unknown>) {
      this.options = options
      maplibreState.navigationControls.push(options)
    }
  }

  const setWorkerUrl = (url: string) => maplibreState.workerUrls.push(url)

  return {
    LngLatBounds: MockLngLatBounds,
    Map: MockMap,
    Marker: MockMarker,
    NavigationControl: MockNavigationControl,
    setWorkerUrl,
  }
})

const antimeridianSites: ObserverLocation[] = [
  {
    id: 'east-antimeridian',
    name: 'East Antimeridian',
    latitude_deg: 0,
    longitude_deg: 179,
    elevation_m: 0,
  },
  {
    id: 'west-antimeridian',
    name: 'West Antimeridian',
    latitude_deg: 0,
    longitude_deg: -179,
    elevation_m: 0,
  },
]

beforeEach(() => {
  maplibreState.maps.length = 0
  maplibreState.markers.length = 0
  maplibreState.navigationControls.length = 0
})

function activeMarkers() {
  return maplibreState.markers.filter((marker) => !marker.removed)
}

describe('ObservingSiteMap', () => {
  it('creates one crisp English vector map and plots an antimeridian-safe pair', async () => {
    const { unmount } = render(<ObservingSiteMap sites={antimeridianSites} />)
    const mapRegion = screen.getByRole('region', {
      name: 'Interactive map of selected observing sites',
    })

    await waitFor(() => expect(maplibreState.maps).toHaveLength(1))
    const map = maplibreState.maps[0]
    await waitFor(() => expect(activeMarkers()).toHaveLength(2))
    await waitFor(() => expect(map.fitBoundsCalls).toHaveLength(1))

    expect(map.options).toMatchObject({
      attributionControl: {
        compact: true,
        customAttribution: OPEN_FREE_MAP_ATTRIBUTION,
      },
      center: [0, 20],
      container: mapRegion,
      dragRotate: false,
      maxPitch: 0,
      maxZoom: OPEN_FREE_MAP_MAX_ZOOM,
      minZoom: 1,
      pitchWithRotate: false,
      renderWorldCopies: true,
      style: OPEN_FREE_MAP_STYLE_URL,
      zoom: 1,
    })
    expect(maplibreState.workerUrls).toContain('mock-maplibre-worker.js')
    expect(maplibreState.navigationControls).toEqual([{ showCompass: false }])
    expect(map.controls[0]).toMatchObject({ position: 'top-left' })

    act(() => map.emit('styledata'))
    expect(map.layoutPropertyCalls).toEqual([{
      id: 'label_city',
      name: 'text-field',
      value: ENGLISH_MAP_LABEL_FIELD,
    }])

    act(() => map.emit('load'))
    await waitFor(() => expect(map.sources.size).toBe(1))
    const lineSource = map.sources.get('observing-site-lines-source')
    expect(lineSource?.data).toMatchObject({
      type: 'FeatureCollection',
      features: [{
        geometry: {
          type: 'LineString',
          coordinates: [
            [179, 0],
            [181, 0],
          ],
        },
      }],
    })
    expect(map.layers[0]).toMatchObject({
      id: 'observing-site-lines-layer',
      source: 'observing-site-lines-source',
      type: 'line',
    })
    expect(map.fitBoundsCalls[0]).toEqual({
      bounds: [
        [179, 0],
        [181, 0],
      ],
      options: { animate: false, maxZoom: 7, padding: 36 },
    })

    expect(activeMarkers().map((marker) => marker.coordinate)).toEqual([
      [179, 0],
      [181, 0],
    ])
    expect(activeMarkers().map((marker) => marker.options.element?.getAttribute('aria-label')))
      .toEqual(['1. East Antimeridian', '2. West Antimeridian'])
    expect(activeMarkers().map((marker) => marker.options.element?.textContent))
      .toEqual(['1', '2'])
    expect(screen.getByText('222.4 km')).toBeInTheDocument()
    expect(map.resizeCalls).toBeGreaterThan(0)

    unmount()
    expect(map.removed).toBe(true)
    expect(maplibreState.markers.every((marker) => marker.removed)).toBe(true)
    expect([...map.handlers.values()].every((handlers) => handlers.size === 0)).toBe(true)
  })

  it('reports a vector basemap error without removing site markers and recovers on load', async () => {
    render(<ObservingSiteMap sites={antimeridianSites} />)
    await waitFor(() => expect(maplibreState.maps).toHaveLength(1))
    const map = maplibreState.maps[0]
    await waitFor(() => expect(activeMarkers()).toHaveLength(2))

    act(() => map.emit('error'))
    expect(screen.getByText('Basemap is unavailable. Site markers remain interactive.'))
      .toBeInTheDocument()
    expect(map.removed).toBe(false)
    expect(activeMarkers()).toHaveLength(2)

    act(() => map.emit('load'))
    expect(screen.queryByText('Basemap is unavailable. Site markers remain interactive.'))
      .not.toBeInTheDocument()
    expect(map.sources.size).toBe(1)
  })

  it('updates the live vector source and markers without recreating the map', async () => {
    const { rerender } = render(<ObservingSiteMap sites={antimeridianSites} />)
    await waitFor(() => expect(maplibreState.maps).toHaveLength(1))
    const map = maplibreState.maps[0]
    act(() => map.emit('load'))
    await waitFor(() => expect(map.sources.size).toBe(1))
    const lineSource = map.sources.get('observing-site-lines-source')

    const updatedSite: ObserverLocation = {
      id: 'updated-site',
      name: 'Updated Site',
      latitude_deg: 40,
      longitude_deg: -105,
      elevation_m: 1_500,
    }
    rerender(<ObservingSiteMap sites={[updatedSite]} />)

    await waitFor(() => expect(activeMarkers()).toHaveLength(1))
    await waitFor(() => expect(lineSource?.setDataCalls).toHaveLength(1))
    expect(activeMarkers()[0]).toMatchObject({ coordinate: [-105, 40] })
    expect(activeMarkers()[0].options.element?.title).toBe('1. Updated Site')
    expect(lineSource?.setDataCalls[0]).toMatchObject({ features: [] })
    expect(maplibreState.maps).toHaveLength(1)
    await waitFor(() => expect(map.jumpToCalls.at(-1)).toEqual({
      center: [-105, 40],
      zoom: 5,
    }))

    rerender(<ObservingSiteMap sites={[]} />)
    await waitFor(() => expect(activeMarkers()).toHaveLength(0))
    await waitFor(() => expect(lineSource?.setDataCalls).toHaveLength(2))
    expect(map.jumpToCalls.at(-1)).toEqual({ center: [0, 20], zoom: 1 })
  })
})
