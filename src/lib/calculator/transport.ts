import { CO2_FACTORS, fuelPriceFor } from "./fuel-prices";
import type { FuelType } from "./transport-schema";

import type { HereRouteSummary } from "@/lib/here/routes";

export type TransportRoute = {
  distanceKm: number;
  durationMin: number;
  /** Peajes en EUR según HERE (currency=EUR). */
  tollsEur: number;
  /** Coste de combustible ponderado por país recorrido. */
  fuelEur: number;
  /** Emisiones del viaje en kg de CO₂. */
  co2Kg: number;
  /** Polilíneas HERE flexpolyline por section. Cada una decodifica por separado. */
  polylines: string[];
  /** Kilómetros por país (ISO-2 → km). */
  kmByCountry: Record<string, number>;
};

/**
 * Combina datos de la ruta HERE con el coche y consumo del usuario para
 * obtener combustible y emisiones. El combustible se pondera por país:
 * para Düsseldorf → Oviedo paga la mayor parte a precio francés, no español.
 *
 * Si HERE no devuelve spans por país (ruta corta intra-país), preferimos el
 * precio del país de destino antes que el fallback genérico UE — para una
 * ruta Madrid → Barcelona el destinationIso="ES" da la media española real
 * en vez de la media UE, que sobreestima.
 */
export function computeRoute(
  here: HereRouteSummary,
  fuelType: FuelType,
  consumptionPer100Km: number,
  destinationIso?: string,
): TransportRoute {
  const distanceKm = here.lengthMeters / 1000;
  const durationMin = Math.round(here.durationSeconds / 60);

  const countries = Object.entries(here.kmByCountry);
  let fuelEur = 0;
  if (countries.length === 0) {
    const price = fuelPriceFor(destinationIso ?? null, fuelType);
    fuelEur = (distanceKm / 100) * consumptionPer100Km * price;
  } else {
    for (const [iso2, km] of countries) {
      const price = fuelPriceFor(iso2, fuelType);
      fuelEur += (km / 100) * consumptionPer100Km * price;
    }
  }

  const totalConsumed = (distanceKm / 100) * consumptionPer100Km;
  const co2Kg = totalConsumed * CO2_FACTORS[fuelType];

  return {
    distanceKm,
    durationMin,
    tollsEur: here.tollsEur,
    fuelEur,
    co2Kg,
    polylines: here.polylines,
    kmByCountry: here.kmByCountry,
  };
}

/**
 * Etiqueta corta del tipo de ruta para los 3 alternativos.
 * HERE devuelve la "recomendada" en posición 0 y luego alternativas
 * ordenadas por preferencia (no por característica explícita) — usamos
 * heurística sobre tiempo/distancia para nombrarlas como ViaMichelin.
 */
export function labelRouteVariants(routes: TransportRoute[]): string[] {
  if (routes.length === 0) return [];
  // Asignamos las etiquetas resolviendo conflictos: la misma ruta no
  // puede ser "más rápida" Y "más económica" — se queda con la primera
  // (por orden de prioridad). El resto cae a "Alternativa".
  const used = new Set<number>();
  const claim = (winner: number, label: string): [number, string] | null => {
    if (used.has(winner)) return null;
    used.add(winner);
    return [winner, label];
  };

  const fastest = routes.indexOf(routes.reduce((a, b) => (a.durationMin <= b.durationMin ? a : b)));
  const cheapest = routes.indexOf(
    routes.reduce((a, b) => (a.tollsEur + a.fuelEur <= b.tollsEur + b.fuelEur ? a : b)),
  );
  const shortest = routes.indexOf(routes.reduce((a, b) => (a.distanceKm <= b.distanceKm ? a : b)));

  const assignments = new Map<number, string>();
  for (const claimed of [
    claim(fastest, "Más rápida"),
    claim(cheapest, "Más económica"),
    claim(shortest, "Más corta"),
  ]) {
    if (claimed) assignments.set(claimed[0], claimed[1]);
  }

  return routes.map((_, i) => assignments.get(i) ?? "Alternativa");
}

/** Formatea duración (minutos) como "16 h 38 min" o "45 min". */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/** Formatea EUR como "271,5 €" (siempre 1 decimal). */
export function formatEur(value: number): string {
  return `${value.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} €`;
}

/** Formatea km como "1690 km" (entero). */
export function formatKm(km: number): string {
  return `${Math.round(km).toLocaleString("es-ES")} km`;
}
