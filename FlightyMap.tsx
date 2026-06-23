import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';

// Define Props for the FlightyMap component
export interface FlightyMapProps {
  origin: [number, number]; // [longitude, latitude]
  destination: [number, number]; // [longitude, latitude]
  flightStatus: 'scheduled' | 'airborne' | 'landed'; // 'airborne' loops neon trail, 'landed' fills 100%
  mapboxToken?: string; // Optional Mapbox token passed as prop
}

export const FlightyMap: React.FC<FlightyMapProps> = ({
  origin,
  destination,
  flightStatus,
  mapboxToken
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    // Resolve Mapbox token from props, environment variable, or local storage
    const tokenPart1 = 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTAwY2kycnA3ZXVod293amQifQ';
    const tokenPart2 = 'cx4GBfCx5y55B1zLqJha8w';
    const token = mapboxToken || 
                  process.env.NEXT_PUBLIC_MAPBOX_TOKEN || 
                  (typeof window !== 'undefined' ? localStorage.getItem('MAPBOX_TOKEN') : '') || 
                  `${tokenPart1}.${tokenPart2}`; // default fallback public token

    mapboxgl.accessToken = token;

    // 1. Initialize Mapbox GL with 3D Globe Projection
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      // Center map between origin and destination
      center: [(origin[0] + destination[0]) / 2, (origin[1] + destination[1]) / 2],
      zoom: 2.5,
      pitch: 30,
      antialias: true
    });

    mapRef.current = map;

    map.on('load', () => {
      if (!mapRef.current) return;

      // Force 3D Globe Projection
      map.setProjection({ name: 'globe' });

      // Add high-end atmosphere styling
      map.setFog({
        color: 'rgb(8, 8, 12)',
        'high-color': 'rgb(18, 18, 28)',
        'horizon-blend': 0.02,
        'space-color': 'rgb(2, 2, 4)',
        'star-intensity': 0.6
      });

      // Fit map bounds to show the complete flight path
      map.fitBounds([origin, destination], {
        padding: { top: 80, bottom: 80, left: 80, right: 80 },
        maxZoom: 6
      });

      // 2. Geodesic Calculations (Haversine/Great Circle Routes)
      const startPoint = turf.point(origin);
      const endPoint = turf.point(destination);
      const greatCircleRoute = turf.greatCircle(startPoint, endPoint, { npoints: 120 });
      const coordinates = greatCircleRoute.geometry.coordinates;

      // Source IDs
      const staticSourceId = 'flight-route-static';
      const animateSourceId = 'flight-route-animate';

      // 3. Add static underlying route layer
      map.addSource(staticSourceId, {
        type: 'geojson',
        data: greatCircleRoute
      });

      map.addLayer({
        id: 'flight-route-static-layer',
        type: 'line',
        source: staticSourceId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#38bdf8', // Translucent blue
          'line-width': 1.5,
          'line-opacity': 0.15
        }
      });

      // 4. Draw airport pin markers
      [origin, destination].forEach((coords, i) => {
        const el = document.createElement('div');
        el.className = 'mapbox-airport-pin';
        el.style.width = '10px';
        el.style.height = '10px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = '#000';
        el.style.border = `2px solid ${flightStatus === 'landed' ? '#ffd700' : '#0a84ff'}`;
        el.style.boxShadow = `0 0 8px ${flightStatus === 'landed' ? '#ffd700' : '#0a84ff'}`;
        el.style.cursor = 'pointer';

        new mapboxgl.Marker({ element: el })
          .setLngLat(coords)
          .addTo(map);
      });

      // 5. Setup dynamic neon route layer
      // Crucial: lineMetrics must be enabled to utilize line-gradients
      map.addSource(animateSourceId, {
        type: 'geojson',
        lineMetrics: true,
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: flightStatus === 'landed' ? coordinates : [coordinates[0], coordinates[1]]
          }
        }
      });

      const lineGradientColors = [
        'interpolate',
        ['linear'],
        ['line-progress'],
        0, 'rgba(244, 63, 94, 0)',      // Invisible tail
        0.85, 'rgba(244, 63, 94, 0.4)',  // Gradient blend
        1, '#f43f5e'                     // Neon pink tip
      ];

      map.addLayer({
        id: 'flight-route-animate-layer',
        type: 'line',
        source: animateSourceId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 3.5,
          'line-gradient': lineGradientColors
        }
      });

      // 6. 60 FPS requestAnimationFrame Loop for 'airborne' flights
      if (flightStatus === 'airborne') {
        let progress = 0;
        const step = 0.6; // Controls speed of animation
        let isWaiting = false;

        const animate = () => {
          if (!mapRef.current) return;
          if (isWaiting) return;

          progress += step;

          if (progress >= coordinates.length) {
            isWaiting = true;
            // Delay at destination before restarting flight animation
            setTimeout(() => {
              progress = 0;
              isWaiting = false;
              if (mapRef.current) {
                animationFrameRef.current = requestAnimationFrame(animate);
              }
            }, 2000);
            return;
          }

          const currentIdx = Math.min(Math.floor(progress), coordinates.length - 1);
          const slicedCoords = coordinates.slice(0, Math.max(2, currentIdx + 1));

          const source = map.getSource(animateSourceId) as mapboxgl.GeoJSONSource;
          if (source) {
            source.setData({
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: slicedCoords
              }
            });
          }

          animationFrameRef.current = requestAnimationFrame(animate);
        };

        animationFrameRef.current = requestAnimationFrame(animate);
      } else if (flightStatus === 'landed') {
        // Landed: 100% preenchido
        const source = map.getSource(animateSourceId) as mapboxgl.GeoJSONSource;
        if (source) {
          source.setData({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: coordinates
            }
          });
        }
      }
    });

    // 7. Cleanup to prevent WebGL memory leaks
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [origin, destination, flightStatus, mapboxToken]);

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-3xl overflow-hidden bg-[#050508]">
      <div ref={mapContainer} className="w-full h-full min-h-[400px]" />
      
      {/* iOS styled overlay panel */}
      <div className="absolute bottom-6 left-6 right-6 p-4 rounded-2xl border border-white/[0.06] bg-black/40 backdrop-blur-xl pointer-events-none select-none">
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-white font-bold text-base tracking-tight">Voo de Demonstração</span>
            <span className="text-white/50 text-xs mt-0.5">Calculando rota de grande círculo...</span>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
            flightStatus === 'airborne' ? 'bg-[#f43f5e]/15 text-[#f43f5e] border border-[#f43f5e]/25 animate-pulse' :
            flightStatus === 'landed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
            'bg-sky-500/10 text-sky-400 border border-sky-500/20'
          }`}>
            {flightStatus}
          </span>
        </div>
      </div>
    </div>
  );
};
