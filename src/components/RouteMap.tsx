"use client";
import React, { useEffect, useRef } from 'react';

type GeoFeatureCollection = any;

export default function RouteMap({ data }: { data: GeoFeatureCollection }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<any>(null);
  const mapInstanceRef = useRef<any | null>(null);

  useEffect(() => {
    // Dynamically add Leaflet CSS and script if not present
    const cssId = 'leaflet-css';
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link');
      link.id = cssId;
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    const scriptId = 'leaflet-js';
    function initMap() {
      // @ts-ignore
      const L = (window as any).L;
      if (!L || !mapRef.current) return;
      leafletRef.current = L;

      // if map already initialized on this container, reuse/remove it first
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {
          // ignore
        }
        mapInstanceRef.current = null;
      }

      // create map
      const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);
      mapInstanceRef.current = map;

      // extract coordinates (geometry MultiLineString -> array of arrays)
      const features = data?.features ?? [];
      const coords: Array<[number, number]> = [];
      features.forEach((f: any) => {
        const geom = f.geometry;
        if (!geom) return;
        if (geom.type === 'MultiLineString') {
          geom.coordinates.forEach((line: any) => {
            line.forEach((pt: any) => coords.push([pt[1], pt[0]]));
          });
        } else if (geom.type === 'LineString') {
          geom.coordinates.forEach((pt: any) => coords.push([pt[1], pt[0]]));
        }
      });

      if (coords.length) {
        const poly = L.polyline(coords, { color: '#f6c945', weight: 5 }).addTo(map);
        map.fitBounds(poly.getBounds(), { padding: [40, 40] });
      }

      // waypoints in properties
      const waypoints = features[0]?.properties?.waypoints ?? data?.properties?.waypoints ?? [];
      if (Array.isArray(waypoints)) {
        waypoints.forEach((wp: any, idx: number) => {
          const lat = wp.location?.[1] ?? wp.lat ?? wp[1];
          const lon = wp.location?.[0] ?? wp.lon ?? wp[0];
          if (lat == null || lon == null) return;
          const marker = L.circleMarker([lat, lon], { radius: 6, color: idx === 0 ? '#ef4444' : '#10b981', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
          const label = wp.name ?? wp.label ?? wp.display_name ?? wp.formatted ?? (idx === 0 ? 'Start' : (idx === waypoints.length - 1 ? 'Destination' : String(idx + 1)));
          marker.bindTooltip(String(label), { permanent: true, className: 'route-marker-label', offset: [0, 0] });
        });
      }
    }

    if (!(window as any).L) {
      const s = document.createElement('script');
      s.id = scriptId;
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = () => initMap();
      document.body.appendChild(s);
    } else {
      initMap();
    }

    return () => {
      // remove map instance if created
      try {
        if (mapInstanceRef.current && typeof mapInstanceRef.current.remove === 'function') {
          mapInstanceRef.current.remove();
        }
      } catch (e) {
        // ignore
      }
      mapInstanceRef.current = null;
    };
  }, [data]);

  return (
    <div className="w-full h-[360px] rounded-md overflow-hidden shadow-lg">
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
