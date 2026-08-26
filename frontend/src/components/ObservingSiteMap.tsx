import { useEffect, useMemo, useRef } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import {
  clampMapLatitude,
  pairwiseSiteDistances,
  shortestLongitudeDelta,
} from '../observingSiteGeometry'
import type { ObserverLocation } from '../types'

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'

function markerIcon(index: number) {
  return L.divIcon({
    className: 'observing-site-map-marker-host',
    html: `<span class="observing-site-map-marker">${index + 1}</span>`,
    iconSize: [36, 42],
    iconAnchor: [18, 42],
    tooltipAnchor: [0, -36],
  })
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
  const mapHost = useRef<HTMLDivElement | null>(null)
  const map = useRef<L.Map | null>(null)
  const featureLayer = useRef<L.LayerGroup | null>(null)
  const pairs = useMemo(() => pairwiseSiteDistances(validSites), [validSites])
  const mapCoordinates = useMemo(() => {
    if (validSites.length === 0) return []
    const referenceLongitude = validSites[0].longitude_deg
    return validSites.map((site) => [
      clampMapLatitude(site.latitude_deg),
      referenceLongitude + shortestLongitudeDelta(site.longitude_deg - referenceLongitude),
    ] as L.LatLngTuple)
  }, [validSites])

  useEffect(() => {
    if (!mapHost.current) return
    const nextMap = L.map(mapHost.current, {
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: true,
    })
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
      noWrap: false,
    }).addTo(nextMap)
    const nextFeatureLayer = L.layerGroup().addTo(nextMap)
    map.current = nextMap
    featureLayer.current = nextFeatureLayer
    nextMap.setView([20, 0], 1, { animate: false })

    return () => {
      featureLayer.current = null
      map.current = null
      nextMap.remove()
    }
  }, [])

  useEffect(() => {
    const currentMap = map.current
    const currentLayer = featureLayer.current
    if (!currentMap || !currentLayer) return
    currentLayer.clearLayers()

    for (const pair of pairs) {
      L.polyline([mapCoordinates[pair.firstIndex], mapCoordinates[pair.secondIndex]], {
        color: '#1f6f8b',
        weight: 2,
        opacity: 0.8,
        dashArray: '7 6',
        interactive: false,
      }).addTo(currentLayer)
    }

    validSites.forEach((site, index) => {
      const tooltip = document.createElement('span')
      tooltip.textContent = `${index + 1}. ${site.name}`
      const marker = L.marker(mapCoordinates[index], {
        icon: markerIcon(index),
        keyboard: true,
        riseOnHover: true,
        title: `${index + 1}. ${site.name}`,
      }).bindTooltip(tooltip).addTo(currentLayer)
      marker.getElement()?.setAttribute('aria-label', `${index + 1}. ${site.name}`)
      marker.getElement()?.setAttribute('role', 'img')
    })

    const resizeTimer = window.setTimeout(() => {
      currentMap.invalidateSize({ animate: false })
      if (validSites.length === 0) {
        currentMap.setView([20, 0], 1, { animate: false })
      } else if (validSites.length === 1) {
        currentMap.setView(mapCoordinates[0], 5, { animate: false })
      } else {
        currentMap.fitBounds(
          L.latLngBounds(mapCoordinates),
          { animate: false, maxZoom: 7, padding: [36, 36] },
        )
      }
    }, 0)
    return () => window.clearTimeout(resizeTimer)
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
        <div
          ref={mapHost}
          className="site-map-canvas"
          role="region"
          aria-label="Interactive map of selected observing sites"
        />
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
