"use client";

import { useMemo, useState, useTransition } from "react";

import { RouteMap } from "@/components/calculator/RouteMap";
import { PlacesAutocomplete } from "@/components/PlacesAutocomplete";
import { formatDuration, formatEur, formatKm } from "@/lib/calculator/transport";
import {
  FUEL_LABELS,
  FUEL_TYPES,
  ROAD_PREFS,
  ROAD_PREF_LABELS,
  type FuelType,
  type RoadPref,
} from "@/lib/calculator/transport-schema";

import { computeTransportAction, type TransportResult } from "./transport-actions";

const inputClass =
  "w-full rounded-xl border border-border bg-white px-4 py-3 text-sm font-semibold text-brand-deep placeholder:text-text-muted focus:border-brand-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-accent/20";
const labelClass = "block text-[11px] font-extrabold uppercase tracking-[0.18em] text-brand-deep";

type Place = { lat: number; lng: number; label: string; country?: string };

type ExtraCosts = {
  flightsEur: number;
  groundTransportEur: number;
  lodgingEur: number;
  foodEur: number;
};

const DEFAULT_EXTRAS: ExtraCosts = {
  flightsEur: 0,
  groundTransportEur: 0,
  lodgingEur: 0,
  foodEur: 0,
};

export function TransportCalculator() {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [consumption, setConsumption] = useState<number | "">(6.5);
  const [fuelType, setFuelType] = useState<FuelType>("gasoline");
  const [roadPref, setRoadPref] = useState<RoadPref>("none");
  const [extras, setExtras] = useState<ExtraCosts>(DEFAULT_EXTRAS);
  const [result, setResult] = useState<TransportResult | null>(null);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const consumptionUnit = fuelType === "electric" ? "kWh / 100 km" : "L / 100 km";
  const validation: string[] = [];
  if (!origin) validation.push("elige el lugar de partida del desplegable");
  if (!destination) validation.push("elige el lugar de destino del desplegable");
  if (typeof consumption !== "number" || consumption <= 0)
    validation.push("introduce un consumo medio válido");
  // Mismas coords (mismo lugar elegido a ambos lados) → HERE devolvería 0 km
  // y la UX queda confusa. Lo bloqueamos con tolerancia de ~10 m.
  if (origin && destination && areSameCoord(origin, destination)) {
    validation.push("origen y destino son el mismo lugar");
  }
  const canCompute = validation.length === 0;

  function onCompute() {
    if (!canCompute) {
      setSubmitError(`Para calcular la ruta: ${validation.join("; ")}.`);
      return;
    }
    setSubmitError(null);
    const payload = {
      originLat: origin!.lat,
      originLng: origin!.lng,
      originLabel: origin!.label,
      originCountry: origin!.country,
      destLat: destination!.lat,
      destLng: destination!.lng,
      destLabel: destination!.label,
      destCountry: destination!.country,
      consumption: Number(consumption),
      fuelType,
      roadPref,
      ...extras,
    };
    startTransition(async () => {
      const res = await computeTransportAction(payload);
      setResult(res);
      if (res.ok) setSelectedRoute(0);
      else setSubmitError(res.error);
    });
  }

  const routes = result && result.ok ? result.routes : [];
  const selected = routes[selectedRoute];
  const extrasTotal = useMemo(
    () => extras.flightsEur + extras.groundTransportEur + extras.lodgingEur + extras.foodEur,
    [extras],
  );
  const tripTotal = selected ? selected.tollsEur + selected.fuelEur + extrasTotal : extrasTotal;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      {/* ─── Columna izquierda: formulario ─── */}
      <div className="grid gap-4 rounded-2xl border border-border bg-white p-5 shadow-soft">
        <Field label="Lugar de partida">
          <PlacesAutocomplete
            kind="geocode"
            countries={[]}
            placeholder="Múnich, Düsseldorf, Madrid…"
            inputClassName={inputClass}
            onChange={(p) => {
              // Cualquier cambio en origen invalida el resultado anterior.
              setResult(null);
              if (p && p.lat != null && p.lng != null) {
                setOrigin({
                  lat: p.lat,
                  lng: p.lng,
                  label: p.address,
                  country: p.countryCode,
                });
              } else {
                setOrigin(null);
              }
            }}
          />
          <PlaceConfirmation place={origin} />
        </Field>

        <Field label="Lugar de destino">
          <PlacesAutocomplete
            kind="geocode"
            countries={[]}
            placeholder="Oviedo, Sevilla, Barcelona…"
            inputClassName={inputClass}
            onChange={(p) => {
              setResult(null);
              if (p && p.lat != null && p.lng != null) {
                setDestination({
                  lat: p.lat,
                  lng: p.lng,
                  label: p.address,
                  country: p.countryCode,
                });
              } else {
                setDestination(null);
              }
            }}
          />
          <PlaceConfirmation place={destination} />
        </Field>

        <Field label="Tipo de combustible">
          <div className="grid grid-cols-3 gap-2">
            {FUEL_TYPES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFuelType(f)}
                className={[
                  "rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors",
                  fuelType === f
                    ? "border-brand-accent bg-brand-surface text-brand-deep"
                    : "border-border bg-white text-text-soft hover:bg-bg-subtle",
                ].join(" ")}
              >
                {FUEL_LABELS[f]}
              </button>
            ))}
          </div>
        </Field>

        <Field label={`Consumo medio (${consumptionUnit})`}>
          <input
            type="number"
            step="0.1"
            inputMode="decimal"
            placeholder={fuelType === "electric" ? "p. ej. 17" : "p. ej. 6,5"}
            className={inputClass}
            value={consumption}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              setConsumption(Number.isFinite(n) ? n : "");
            }}
          />
        </Field>

        <Field label="Tus preferencias en carretera">
          <select
            className={inputClass}
            value={roadPref}
            onChange={(e) => setRoadPref(e.target.value as RoadPref)}
          >
            {ROAD_PREFS.map((p) => (
              <option key={p} value={p}>
                {ROAD_PREF_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>

        <div className="border-t border-border pt-4">
          <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.18em] text-text-soft">
            Otros costes del viaje
          </p>
          <div className="grid grid-cols-2 gap-3">
            <EurField
              label="Vuelos"
              value={extras.flightsEur}
              onChange={(v) => setExtras({ ...extras, flightsEur: v })}
            />
            <EurField
              label="Taxis / bus / tren"
              value={extras.groundTransportEur}
              onChange={(v) => setExtras({ ...extras, groundTransportEur: v })}
            />
            <EurField
              label="Alojamiento"
              value={extras.lodgingEur}
              onChange={(v) => setExtras({ ...extras, lodgingEur: v })}
            />
            <EurField
              label="Comida"
              value={extras.foodEur}
              onChange={(v) => setExtras({ ...extras, foodEur: v })}
            />
          </div>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={onCompute}
          className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-accent px-6 text-sm font-bold text-white shadow-soft hover:bg-brand-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Calculando ruta…" : "Calcular ruta y coste"}
        </button>

        {submitError && (
          <div
            role="alert"
            className="rounded-lg border border-state-error/30 bg-state-error/5 px-3 py-2 text-xs text-state-error"
          >
            {submitError}
          </div>
        )}
      </div>

      {/* ─── Columna derecha: resultados ─── */}
      <div className="grid gap-4">
        {!result && (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-bg-subtle p-10 text-center">
            <div className="rounded-full bg-brand-surface p-4 text-brand-accent">
              <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
                <path
                  d="M3 12 12 3l9 9M5 10v10h14V10"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3 className="mt-4 text-lg font-bold text-brand-deep">Calcula tu ruta</h3>
            <p className="mt-2 max-w-xs text-sm text-text-soft">
              Introduce origen, destino y consumo y obtendrás distancia, tiempo, peajes y coste de
              combustible con datos reales de carretera.
            </p>
          </div>
        )}

        {result && result.ok && (
          <>
            {/* Tarjetas de las 3 rutas */}
            <div className="grid gap-2">
              {routes.map((r, i) => {
                const total = r.tollsEur + r.fuelEur;
                const isSelected = i === selectedRoute;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedRoute(i)}
                    className={[
                      "grid grid-cols-4 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                      isSelected
                        ? "border-brand-accent bg-brand-deep text-white shadow-elevated"
                        : "border-border bg-white text-brand-deep hover:bg-bg-subtle",
                    ].join(" ")}
                  >
                    <div>
                      <span
                        className={[
                          "block text-[10px] font-bold uppercase tracking-widest",
                          isSelected ? "text-brand-soft" : "text-text-muted",
                        ].join(" ")}
                      >
                        {r.label}
                      </span>
                      <span className="font-display text-lg font-extrabold">
                        {formatDuration(r.durationMin)}
                      </span>
                    </div>
                    <div className="font-mono text-sm font-bold tabular-nums">
                      {formatEur(total)}
                    </div>
                    <div
                      className={[
                        "font-mono text-sm tabular-nums",
                        isSelected ? "text-white/80" : "text-text-soft",
                      ].join(" ")}
                    >
                      {formatKm(r.distanceKm)}
                    </div>
                    <div
                      className={[
                        "font-mono text-sm tabular-nums",
                        isSelected ? "text-white/80" : "text-text-soft",
                      ].join(" ")}
                    >
                      {Math.round(r.co2Kg)} kg CO₂
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Coste / mapa de carreteras */}
            {selected && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Card title="Coste de este viaje">
                  <Stat label="Peajes" value={formatEur(selected.tollsEur)} />
                  <Stat label="Combustible" value={formatEur(selected.fuelEur)} />
                </Card>
                <Card title="Mapa de carreteras">
                  <Stat label="Distancia" value={formatKm(selected.distanceKm)} />
                  <Stat
                    label="Emisiones CO₂"
                    value={`${Math.round(selected.co2Kg).toLocaleString("es-ES")} kg`}
                  />
                </Card>
              </div>
            )}

            {/* Mapa */}
            {origin && destination && (
              <RouteMap
                routes={routes.map((r) => ({ polylines: r.polylines }))}
                selectedIndex={selectedRoute}
                origin={{ lat: origin.lat, lng: origin.lng, label: origin.label }}
                destination={{
                  lat: destination.lat,
                  lng: destination.lng,
                  label: destination.label,
                }}
              />
            )}

            {/* Total con todos los costes */}
            <div className="rounded-2xl bg-brand-deep p-6 text-white shadow-elevated">
              <p className="text-xs font-bold uppercase tracking-widest text-brand-soft">
                Total estimado del viaje
              </p>
              <p className="mt-2 font-display text-4xl font-extrabold tracking-tight md:text-5xl">
                {formatEur(tripTotal)}
              </p>
              <ul className="mt-4 grid gap-1 text-sm text-white/85">
                {selected && (
                  <>
                    <TotalRow label="Peajes" value={formatEur(selected.tollsEur)} />
                    <TotalRow label="Combustible" value={formatEur(selected.fuelEur)} />
                  </>
                )}
                <TotalRow label="Vuelos" value={formatEur(extras.flightsEur)} />
                <TotalRow label="Taxis / bus / tren" value={formatEur(extras.groundTransportEur)} />
                <TotalRow label="Alojamiento" value={formatEur(extras.lodgingEur)} />
                <TotalRow label="Comida" value={formatEur(extras.foodEur)} />
              </ul>
            </div>

            <p className="rounded-lg border border-border bg-bg-subtle px-4 py-3 text-xs text-text-muted">
              Distancia, tiempo y peajes calculados con HERE Routes v8 (datos reales de carretera).
              El combustible se pondera por país atravesado con precios medios actualizados. Las
              cifras son orientativas — los peajes pueden variar según categoría del vehículo y la
              gasolina por estación de servicio.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Pequeños helpers de UI ───────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

/** Trata dos coordenadas como iguales si están a menos de ~10 m (≈ 0.0001°). */
function areSameCoord(a: Place, b: Place): boolean {
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
}

function PlaceConfirmation({ place }: { place: Place | null }) {
  if (!place) return null;
  return (
    <span className="mt-1 flex items-start gap-1.5 text-[11px] text-state-success">
      <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-3 w-3 flex-none" aria-hidden>
        <path
          d="m5 12 4 4 10-10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="truncate text-text-soft">{place.label}</span>
    </span>
  );
}

function EurField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-widest text-text-soft">
        {label}
      </span>
      <div className="relative mt-1.5">
        <input
          type="number"
          step="1"
          inputMode="decimal"
          placeholder="0"
          className={`${inputClass} py-2.5 pr-8`}
          value={value === 0 ? "" : value}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            onChange(Number.isFinite(n) && n >= 0 ? n : 0);
          }}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-text-muted">
          €
        </span>
      </div>
    </label>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-soft">
      <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-text-muted">
        {title}
      </h3>
      <div className="mt-2 grid gap-1">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-soft">{label}</span>
      <span className="font-mono font-bold tabular-nums text-brand-deep">{value}</span>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </li>
  );
}
