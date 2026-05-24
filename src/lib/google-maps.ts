import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let configured = false;

export function ensureMapsConfigured(): void {
  if (configured) return;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY no está configurada");
  }
  setOptions({
    key: apiKey,
    v: "weekly",
    language: "es",
    region: "ES",
  });
  configured = true;
}

export { importLibrary };

export type RoutePlace = {
  address: string;
  lat: number;
  lng: number;
  countryCode?: string;
  /** Código postal extraído de address_components (5 dígitos en España). */
  postalCode?: string;
};

/** Centro aproximado entre dos coords. */
export function midpoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}
