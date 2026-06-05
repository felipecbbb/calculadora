"use server";

import type { RoutePlace } from "@/lib/google-maps";

/**
 * Autocomplete de direcciones vía la API REST de Google Places (web service).
 *
 * Por qué servidor y no el widget JS: desde el 1 de marzo de 2025 Google
 * desactivó `google.maps.places.Autocomplete` y `AutocompleteService` para los
 * proyectos de Cloud nuevos (el de Car Revol lo es). Esas clases del SDK del
 * navegador ya no devuelven sugerencias. La API REST equivalente sí sigue
 * funcionando con la misma key, así que la consumimos desde el servidor y
 * pintamos nuestro propio desplegable en `PlacesAutocomplete`.
 */

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export type PlaceKind = "cities" | "address" | "geocode";
export type PlaceSuggestion = { placeId: string; description: string };

/**
 * Mapea nuestro `kind` semántico al parámetro `types` de la API:
 *   - "cities"  → "(regions)": localidades Y códigos postales (lo que necesita
 *      la calculadora, donde el usuario escribe "Múnich" o "28001").
 *   - "address" → direcciones con número de calle.
 *   - "geocode" → cualquier resultado geocodificable.
 */
function typesFor(kind: PlaceKind): string {
  if (kind === "cities") return "(regions)";
  if (kind === "address") return "address";
  return "geocode";
}

export async function searchPlacesAction(args: {
  query: string;
  kind?: PlaceKind;
  /** ISO de país (2 letras minúsculas). La API legacy admite hasta 5; con más
   *  o ninguno buscamos en todo el mundo. */
  countries?: string[];
  sessionToken?: string;
}): Promise<PlaceSuggestion[]> {
  const query = args.query.trim();
  if (!MAPS_KEY || query.length < 2) return [];

  const params = new URLSearchParams({
    input: query,
    key: MAPS_KEY,
    language: "es",
    types: typesFor(args.kind ?? "geocode"),
  });
  const c = args.countries;
  if (c && c.length >= 1 && c.length <= 5) {
    params.set("components", c.map((x) => `country:${x}`).join("|"));
  }
  if (args.sessionToken) params.set("sessiontoken", args.sessionToken);

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.warn("[places] autocomplete", data.status, data.error_message ?? "");
      return [];
    }
    return (data.predictions ?? []).map(
      (p: { place_id: string; description: string }): PlaceSuggestion => ({
        placeId: p.place_id,
        description: p.description,
      }),
    );
  } catch (err) {
    console.warn("[places] autocomplete failed", err);
    return [];
  }
}

export async function resolvePlaceAction(args: {
  placeId: string;
  sessionToken?: string;
}): Promise<RoutePlace | null> {
  if (!MAPS_KEY) return null;

  const params = new URLSearchParams({
    place_id: args.placeId,
    key: MAPS_KEY,
    language: "es",
    fields: "geometry,formatted_address,address_component",
  });
  if (args.sessionToken) params.set("sessiontoken", args.sessionToken);

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (data.status !== "OK" || !data.result?.geometry?.location) {
      console.warn("[places] details", data.status, data.error_message ?? "");
      return null;
    }
    const r = data.result;
    const comps: Array<{ types: string[]; short_name: string; long_name: string }> =
      r.address_components ?? [];
    const find = (t: string) => comps.find((x) => x.types.includes(t));
    return {
      address: r.formatted_address ?? "",
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      countryCode: find("country")?.short_name,
      postalCode: find("postal_code")?.long_name,
    };
  } catch (err) {
    console.warn("[places] details failed", err);
    return null;
  }
}
