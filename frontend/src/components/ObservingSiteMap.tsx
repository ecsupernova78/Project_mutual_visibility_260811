import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

import {
  clampMapLatitude,
  pairwiseSiteDistances,
  shortestLongitudeDelta,
} from '../observingSiteGeometry'
import type { ObserverLocation } from '../types'
import './ObservingSiteMap.css'

setWorkerUrl(maplibreWorkerUrl)

type SymbolStyleLayer = Extract<
  ReturnType<MapLibreMap['getStyle']>['layers'][number],
  { type: 'symbol' }
>
type SymbolTextField = NonNullable<NonNullable<SymbolStyleLayer['layout']>['text-field']>

const OPEN_FREE_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const OPEN_FREE_MAP_MAX_ZOOM = 18
const OPEN_FREE_MAP_ATTRIBUTION = [
  '<a href="https://openfreemap.org/">OpenFreeMap</a>',
  '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a>',
  'Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
].join(' &middot; ')

const ENGLISH_MAP_LABEL_FIELD: SymbolTextField = [
  'coalesce',
  ['get', 'name:en'],
  ['get', 'name_en'],
  ['get', 'name:latin'],
  '',
]

const MAP_LOAD_ERROR = 'Basemap is unavailable. Site markers remain interactive.'
const SITE_LINES_SOURCE_ID = 'observing-site-lines-source'
const SITE_LINES_LAYER_ID = 'observing-site-lines-layer'

function createMarkerElement(index: number, siteName: string) {
  const label = `${index + 1}. ${siteName}`
  const element = document.createElement('span')
  element.className = 'observing-site-map-marker-host'
  element.title = label
  element.tabIndex = 0
  element.setAttribute('aria-label', label)
  element.setAttribute('role', 'img')

  const badge = document.createElement('span')
  badge.className = 'observing-site-map-marker'
  badge.textContent = String(index + 1)
  badge.setAttribute('aria-hidden', 'true')
  element.append(badge)
  return element
}

function formatDistance(distanceKm: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(distanceKm)
}

export function ObservingSiteMap({ sites }: { sites: ObserverLocation[] }) {
  const validSites = useMemo(() => sites.filter((site) => (
    Number.isFinite(site.latitude_deg)
    && Number.isFinite(site.longitude_deg)
    && site.latitude_deg >= -90
    && site.latitude_deg <= 90
    && site.longitude_deg >= -180
    && site.longitude_deg <= 180
  )), [sites])
  const pairs = useMemo(() => pairwiseSiteDistances(validSites), [validSites])
  const mapCoordinates = useMemo(() => {
    if (validSites.length === 0) return []
    const referenceLongitude = validSites[0].longitude_deg
    return validSites.map((site) => [
      clampMapLatitude(site.latitude_deg),
      referenceLongitude + shortestLongitudeDelta(site.longitude_deg - referenceLongitude),
    ] as [latitude: number, longitude: number])
  }, [validSites])

  const mapHost = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapLibreMap | null>(null)
  const mapReady = useRef(false)
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!mapHost.current) return
    let disposed = false
    let nextMap: MapLibreMap
    try {
      nextMap = new MapLibreMap({
        attributionControl: {
          compact: true,
          customAttribution: OPEN_FREE_MAP_ATTRIBUTION,
        },
        center: [0, 20],
        container: mapHost.current,
        dragRotate: false,
        maxPitch: 0,
        maxZoom: OPEN_FREE_MAP_MAX_ZOOM,
        minZoom: 1,
        pitchWithRotate: false,
        renderWorldCopies: true,
        style: OPEN_FREE_MAP_STYLE_URL,
        zoom: 1,
      })
    } catch {
      const errorTimer = window.setTimeout(() => setMapStatus('error'), 0)
      return () => {
        disposed = true
        window.clearTimeout(errorTimer)
      }
    }

    let labelsLocalized = false
    const applyEnglishLabels = () => {
      if (labelsLocalized) return
      const namedLayers = nextMap.getStyle().layers.filter((layer) => (
        layer.type === 'symbol'
        && layer.layout?.['text-field'] !== undefined
        && JSON.stringify(layer.layout['text-field']).includes('name')
      ))
      if (namedLayers.length === 0) return
      labelsLocalized = true
      namedLayers.forEach((layer) => {
        nextMap.setLayoutProperty(layer.id, 'text-field', ENGLISH_MAP_LABEL_FIELD)
      })
    }
    const handleLoad = () => {
      mapReady.current = true
      if (!disposed) setMapStatus('ready')
    }
    const handleError = () => {
      if (!disposed && !mapReady.current) setMapStatus('error')
    }
    nextMap.on('styledata', applyEnglishLabels)
    nextMap.on('load', handleLoad)
    nextMap.on('error', handleError)
    nextMap.addControl(new NavigationControl({ showCompass: false }), 'top-left')

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => nextMap.resize())
    resizeObserver?.observe(mapHost.current)
    map.current = nextMap

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      nextMap.off('styledata', applyEnglishLabels)
      nextMap.off('load', handleLoad)
      nextMap.off('error', handleError)
      mapReady.current = false
      map.current = null
      nextMap.remove()
    }
  }, [])

  useEffect(() => {
    const currentMap = map.current
    if (!currentMap) return
    const lineData: Parameters<GeoJSONSource['setData']>[0] = {
      type: 'FeatureCollection',
      features: pairs.map((pair) => ({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [mapCoordinates[pair.firstIndex][1], mapCoordinates[pair.firstIndex][0]],
            [mapCoordinates[pair.secondIndex][1], mapCoordinates[pair.secondIndex][0]],
          ],
        },
      })),
    }
    const syncLineLayer = () => {
      currentMap.off('load', syncLineLayer)
      const source = currentMap.getSource<GeoJSONSource>(SITE_LINES_SOURCE_ID)
      if (source) {
        void source.setData(lineData)
        return
      }
      currentMap.addSource(SITE_LINES_SOURCE_ID, { type: 'geojson', data: lineData })
      currentMap.addLayer({
        id: SITE_LINES_LAYER_ID,
        type: 'line',
        source: SITE_LINES_SOURCE_ID,
        paint: {
          'line-color': '#1f6f8b',
          'line-dasharray': [3.5, 3],
          'line-opacity': 0.8,
          'line-width': 2,
        },
      })
    }
    if (mapReady.current) syncLineLayer()
    else currentMap.on('load', syncLineLayer)

    const markers = validSites.map((site, index) => (
      new Marker({
        anchor: 'bottom',
        element: createMarkerElement(index, site.name),
      })
        .setLngLat([mapCoordinates[index][1], mapCoordinates[index][0]])
        .addTo(currentMap)
    ))

    const resizeTimer = window.setTimeout(() => {
      currentMap.resize()
      if (validSites.length === 0) {
        currentMap.jumpTo({ center: [0, 20], zoom: 1 })
      } else if (validSites.length === 1) {
        currentMap.jumpTo({
          center: [mapCoordinates[0][1], mapCoordinates[0][0]],
          zoom: 5,
        })
      } else {
        const bounds = new LngLatBounds()
        mapCoordinates.forEach(([latitude, longitude]) => bounds.extend([longitude, latitude]))
        currentMap.fitBounds(bounds, { animate: false, maxZoom: 7, padding: 36 })
      }
    }, 0)
    return () => {
      currentMap.off('load', syncLineLayer)
      markers.forEach((marker) => marker.remove())
      window.clearTimeout(resizeTimer)
    }
  }, [mapCoordinates, pairs, validSites])

  return (
    <section className="site-map-card" aria-labelledby="site-map-title">
      <header className="site-map-heading">
        <div>
          <p className="eyebrow">Selected Site Geometry</p>
          <h2 id="site-map-title">Map and Pairwise Distances</h2>
        </div>
        <p aria-live="polite">
          {validSites.length} {validSites.length === 1 ? 'site' : 'sites'} mapped · {pairs.length}{' '}
          {pairs.length === 1 ? 'distance' : 'distances'}
        </p>
      </header>
      <div className="site-map-layout">
        <div className="site-map-canvas-frame">
          <div
            ref={mapHost}
            className="site-map-canvas"
            role="region"
            aria-label="Interactive map of selected observing sites"
            aria-busy={mapStatus === 'loading'}
          />
          {mapStatus === 'error' && (
            <p className="site-map-load-error" role="status">{MAP_LOAD_ERROR}</p>
          )}
        </div>
        <div className="site-distance-panel">
          <h3>Selected order</h3>
          {validSites.length > 0 ? (
            <ol className="site-map-site-list">
              {validSites.map((site) => (
                <li key={site.id}>
                  <strong>{site.name}</strong>
                  <small>{site.latitude_deg.toFixed(5)}°, {site.longitude_deg.toFixed(5)}°</small>
                </li>
              ))}
            </ol>
          ) : (
            <p className="site-distance-empty">Select a saved site to place it on the map.</p>
          )}
          <h3>Great-circle distance</h3>
          {pairs.length > 0 ? (
            <table>
              <caption>Pairwise surface distances between selected observing sites</caption>
              <thead>
                <tr><th scope="col">Pair</th><th scope="col">Sites</th><th scope="col">Distance</th></tr>
              </thead>
              <tbody>
                {pairs.map((pair) => (
                  <tr key={`${pair.first.id}-${pair.second.id}`}>
                    <th scope="row">{pair.firstIndex + 1}–{pair.secondIndex + 1}</th>
                    <td>{pair.first.name} — {pair.second.name}</td>
                    <td>{formatDistance(pair.distanceKm)} km</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="site-distance-empty">Select at least two sites to calculate a distance.</p>
          )}
          <p className="site-distance-note">Surface great-circle distance; elevation is excluded.</p>
        </div>
      </div>
    </section>
  )
}
