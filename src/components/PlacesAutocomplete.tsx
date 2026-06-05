"use client";

import { useEffect, useId, useRef, useState } from "react";

import { type RoutePlace } from "@/lib/google-maps";
import { resolvePlaceAction, searchPlacesAction, type PlaceSuggestion } from "@/lib/places-actions";

/**
 * Tipo de lugar a sugerir:
 *   - "cities" → localidades y códigos postales (hero, calculadora).
 *   - "address" → direcciones precisas (calle + número), para wizards de ruta.
 *   - "geocode" (default) → cualquier resultado geocodificable.
 */
export type PlacesKind = "cities" | "address" | "geocode";

/**
 * Input con autocomplete de direcciones. Pinta su propio desplegable a partir
 * de la API REST de Google Places (vía server actions), porque el widget JS
 * legacy de Google (`google.maps.places.Autocomplete`) dejó de estar disponible
 * para proyectos de Cloud creados después del 1 de marzo de 2025. Ver
 * `@/lib/places-actions`.
 */
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
  /** ISO de país (2 letras minúsculas) a los que se restringe la búsqueda.
   *  `undefined` o `[]` = búsqueda mundial. */
  countries?: string[];
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  const [text, setText] = useState(value?.address ?? "");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const sessionRef = useRef<string | null>(null);
  // Evita relanzar la búsqueda cuando el cambio de `text` viene de seleccionar
  // una sugerencia (no de teclear).
  const skipSearch = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();

  const countriesKey = (countries ?? []).join(",");

  // Refleja el valor seleccionado desde fuera (p. ej. al resetear el form).
  useEffect(() => {
    skipSearch.current = true;
    setText(value?.address ?? "");
  }, [value?.address]);

  function ensureSession(): string {
    if (!sessionRef.current) {
      sessionRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return sessionRef.current;
  }

  // Búsqueda con debounce mientras el usuario teclea.
  useEffect(() => {
    if (disabled) return;
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    const q = text.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const handle = setTimeout(async () => {
      const results = await searchPlacesAction({
        query: q,
        kind,
        countries,
        sessionToken: ensureSession(),
      });
      setSuggestions(results);
      setActive(-1);
      setOpen(results.length > 0);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, disabled, kind, countriesKey]);

  async function pick(s: PlaceSuggestion) {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    skipSearch.current = true;
    setText(s.description);
    setOpen(false);
    setSuggestions([]);
    const place = await resolvePlaceAction({
      placeId: s.placeId,
      sessionToken: ensureSession(),
    });
    sessionRef.current = null; // cierra la sesión de facturación
    if (place) {
      skipSearch.current = true;
      setText(place.address || s.description);
      onChange(place);
    }
  }

  return (
    <div className={className} style={{ position: "relative" }}>
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        className={inputClassName}
        id={id}
        name={name}
        disabled={disabled}
        autoComplete={autoComplete ?? "off"}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (v.trim() === "" && value) onChange(undefined);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) {
            if (e.key === "Enter") e.preventDefault();
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const choice = suggestions[active >= 0 ? active : 0];
            if (choice) void pick(choice);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        {...rest}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-xl border border-border bg-white py-1 shadow-card"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                void pick(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-4 py-2.5 text-sm ${
                i === active ? "bg-brand-surface text-brand-deep" : "text-text"
              }`}
            >
              {s.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
