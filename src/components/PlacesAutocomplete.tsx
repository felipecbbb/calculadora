"use client";

import { useEffect, useRef, useState } from "react";

import { ensureMapsConfigured, importLibrary, type RoutePlace } from "@/lib/google-maps";

const ALLOWED_COUNTRIES = [
  "es",
  "pt",
  "fr",
  "be",
  "nl",
  "de",
  "it",
  "gb",
  "cz",
  "pl",
  "ro",
  "se",
  "dk",
];

/**
 * Input text con autocomplete de Google Places restringido a los 14 países
 * contractuales. Usado en hero + cualquier sitio donde haga falta selector
 * de dirección sin mapa visible.
 */
/**
 * Tipo de lugar a sugerir:
 *   - "cities" → solo poblaciones (no calles ni números). Útil para hero
 *     y calculadora donde el usuario piensa en términos de ciudad.
 *   - "address" → direcciones precisas (calle + número). Útil para
 *     wizards de transporte donde la ruta importa.
 *   - "geocode" (default por compatibilidad) → cualquier resultado.
 */
export type PlacesKind = "cities" | "address" | "geocode";

export function PlacesAutocomplete({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  id,
  name,
  autoComplete,
  disabled,
  kind = "geocode",
  countries,
  ...rest
}: {
  value?: RoutePlace;
  onChange: (place: RoutePlace | undefined) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  id?: string;
  name?: string;
  autoComplete?: string;
  disabled?: boolean;
  kind?: PlacesKind;
  /** Lista de códigos ISO de país (2 letras minúsculas) a la que se
   *  restringen las sugerencias. `undefined` = sin restricción (mundial),
   *  `[]` = igual que undefined. Default: 14 países contractuales. */
  countries?: string[];
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (disabled) return; // No inicializa autocomplete si está deshabilitado
    let mounted = true;
    let listenerHandle: google.maps.MapsEventListener | null = null;
    setInitError(null);

    (async () => {
      try {
        ensureMapsConfigured();
        const { Autocomplete } = await importLibrary("places");
        if (!mounted || !inputRef.current) return;

        // Mapeo de nuestro `kind` semántico a los `types` de Google.
        // "(cities)" filtra a localidades (locality, postal_town, etc.).
        // "address" filtra a direcciones precisas con número.
        const googleTypes =
          kind === "cities" ? ["(cities)"] : kind === "address" ? ["address"] : ["geocode"];

        // Restricción de países: si el caller no especifica `countries`
        // aplicamos los 14 contractuales por defecto. Para búsquedas mundiales
        // (origen/destino del transporte de un coche, que puede venir de
        // cualquier sitio) el caller pasa countries={[]} explícitamente.
        const restrict =
          countries === undefined ? ALLOWED_COUNTRIES : countries.length > 0 ? countries : null;

        const ac = new Autocomplete(inputRef.current, {
          fields: ["formatted_address", "geometry", "address_components"],
          types: googleTypes,
          ...(restrict ? { componentRestrictions: { country: restrict } } : {}),
        });

        listenerHandle = ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          if (place.geometry?.location) {
            const components = place.address_components ?? [];
            onChange({
              address: place.formatted_address ?? inputRef.current?.value ?? "",
              lat: place.geometry.location.lat(),
              lng: place.geometry.location.lng(),
              countryCode: components.find((c: google.maps.GeocoderAddressComponent) =>
                c.types.includes("country"),
              )?.short_name,
              postalCode: components.find((c: google.maps.GeocoderAddressComponent) =>
                c.types.includes("postal_code"),
              )?.long_name,
            });
          }
        });
      } catch (err) {
        console.error("[PlacesAutocomplete] failed", err);
        if (mounted) {
          // Mensaje user-visible solo si parece problema de configuración —
          // un fallo de red transitorio no merece la pena banderearlo.
          const msg = err instanceof Error ? err.message : String(err);
          if (/api[_ ]?key|configurada|configured/i.test(msg)) {
            setInitError("Autocompletado no disponible. Introduce la dirección a mano.");
          }
        }
      }
    })();

    return () => {
      mounted = false;
      if (listenerHandle) listenerHandle.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, kind, countries]);

  return (
    <div className={className}>
      <input
        ref={inputRef}
        key={disabled ? "disabled" : "enabled"}
        type="text"
        defaultValue={value?.address ?? ""}
        placeholder={placeholder}
        className={inputClassName}
        id={id}
        name={name}
        disabled={disabled}
        autoComplete={autoComplete ?? "off"}
        onChange={(e) => {
          if (e.target.value === "" && value) {
            onChange(undefined);
          }
        }}
        onKeyDown={async (e) => {
          if (e.key !== "Enter") return;
          const input = e.currentTarget;
          const text = input.value.trim();
          if (!text) return;
          e.preventDefault();

          // Estrategia 1: click sintético en el `.pac-item` del dropdown
          // visible. Funciona cuando Google Places muestra sugerencias en
          // el DOM (mayoría de casos en escritorio).
          const containers = Array.from(document.querySelectorAll<HTMLElement>(".pac-container"));
          const visible = containers.find((c) => c.offsetParent !== null);
          const firstItem = visible?.querySelector<HTMLElement>(".pac-item");
          if (firstItem) {
            firstItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            firstItem.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            firstItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            return;
          }

          // Estrategia 2 (fallback): si el dropdown no está montado, usamos
          // la API programática `AutocompleteService` + `PlacesService` para
          // resolver la primera predicción a coordenadas y disparar onChange.
          // Esto cubre el caso edge en mobile o cuando el usuario es muy
          // rápido (Enter antes de que Google renderice el dropdown).
          try {
            const places = await importLibrary("places");
            const autoSvc = new places.AutocompleteService();
            const googleTypes =
              kind === "cities" ? ["(cities)"] : kind === "address" ? ["address"] : ["geocode"];
            const restrict =
              countries === undefined ? ALLOWED_COUNTRIES : countries.length > 0 ? countries : null;
            const req: google.maps.places.AutocompletionRequest = {
              input: text,
              types: googleTypes,
              ...(restrict ? { componentRestrictions: { country: restrict } } : {}),
            };
            autoSvc.getPlacePredictions(req, (preds, status) => {
              if (status !== google.maps.places.PlacesServiceStatus.OK || !preds || !preds[0]) {
                return;
              }
              const first = preds[0];
              const detailsSvc = new places.PlacesService(document.createElement("div"));
              detailsSvc.getDetails(
                {
                  placeId: first.place_id,
                  fields: ["formatted_address", "geometry", "address_components"],
                },
                (place, detailStatus) => {
                  if (
                    detailStatus !== google.maps.places.PlacesServiceStatus.OK ||
                    !place?.geometry?.location
                  ) {
                    return;
                  }
                  const components = place.address_components ?? [];
                  if (input) input.value = place.formatted_address ?? text;
                  onChange({
                    address: place.formatted_address ?? text,
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                    countryCode: components.find((c) => c.types.includes("country"))?.short_name,
                    postalCode: components.find((c) => c.types.includes("postal_code"))?.long_name,
                  });
                },
              );
            });
          } catch (err) {
            console.warn("[PlacesAutocomplete] enter fallback failed", err);
          }
        }}
        {...rest}
      />
      {initError && <span className="mt-1 block text-[11px] text-text-muted">{initError}</span>}
    </div>
  );
}
