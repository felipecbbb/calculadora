"use client";

import "leaflet/dist/leaflet.css";

import { decode } from "@here/flexpolyline";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";

type Coord = [number, number];

export type RouteMapProps = {
  /**
   * Polilíneas por ruta. Cada ruta puede traer N sections — el cliente
   * decodifica cada section por separado y las une en orden.
   */
  routes: ReadonlyArray<{ polylines: string[] }>;
  /** Índice de la ruta resaltada. */
  selectedIndex: number;
  origin: { lat: number; lng: number; label: string };
  destination: { lat: number; lng: number; label: string };
};

const COLORS = ["#1B4F72", "#7D3C98", "#117A65"];

function decodePoly(encoded: string): Coord[] {
  if (!encoded) return [];
  try {
    return decode(encoded).polyline.map((pt) => [pt[0], pt[1]] as Coord);
  } catch {
    return [];
  }
}

function FitToBounds({ coords }: { coords: Coord[] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length === 0) return;
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [coords, map]);
  return null;
}

export default function RouteMapInner({
  routes,
  selectedIndex,
  origin,
  destination,
}: RouteMapProps) {
  // Cada ruta = unión de sus N sections decodificadas.
  const decoded = useMemo(() => routes.map((r) => r.polylines.flatMap(decodePoly)), [routes]);
  const allCoords = useMemo<Coord[]>(() => decoded.flat(), [decoded]);
  const center: Coord = [(origin.lat + destination.lat) / 2, (origin.lng + destination.lng) / 2];

  return (
    <MapContainer
      center={center}
      zoom={5}
      scrollWheelZoom={false}
      className="h-full w-full"
      style={{ minHeight: 400, borderRadius: 16 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {decoded.map((coords, i) => {
        if (coords.length === 0) return null;
        const isSelected = i === selectedIndex;
        return (
          <Polyline
            key={i}
            positions={coords}
            pathOptions={{
              color: COLORS[i] ?? "#444",
              weight: isSelected ? 6 : 3,
              opacity: isSelected ? 0.95 : 0.55,
            }}
          />
        );
      })}
      <CircleMarker
        center={[origin.lat, origin.lng]}
        radius={8}
        pathOptions={{ color: "#117A65", fillColor: "#117A65", fillOpacity: 1, weight: 2 }}
      />
      <CircleMarker
        center={[destination.lat, destination.lng]}
        radius={8}
        pathOptions={{ color: "#C0392B", fillColor: "#C0392B", fillOpacity: 1, weight: 2 }}
      />
      <FitToBounds coords={allCoords} />
    </MapContainer>
  );
}
