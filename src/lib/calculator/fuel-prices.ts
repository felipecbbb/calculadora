/**
 * Precios medios de combustible y electricidad por país.
 *
 * Datos aproximados de 2025-2026 expresados en EUR para que el motor pueda
 * sumar peajes (que HERE devuelve en EUR cuando pedimos `currency=EUR`) con
 * el coste de combustible sin tener que mezclar divisas. Fuente principal:
 * GlobalPetrolPrices.com (media mensual) y Eurostat para electricidad
 * residencial en la UE. Para `electricity` se asume carga doméstica.
 *
 * El dataset es estático a propósito — la calculadora estima, no factura.
 * Mantener actualizado este fichero cuando los precios cambien significativamente.
 */

export type FuelPrices = {
  /** EUR por litro de gasolina 95 octanos. */
  gasoline: number;
  /** EUR por litro de diésel. */
  diesel: number;
  /** EUR por kWh de electricidad residencial (carga lenta en casa). */
  electricity: number;
};

export type FuelType = "gasoline" | "diesel" | "electric";

/**
 * Precios por código ISO 3166-1 alpha-2.
 * Cobertura: UE + EFTA + UK + USA, Canadá, México, principales mercados LatAm,
 * Marruecos, Turquía, Australia, Nueva Zelanda, Japón, Corea, China, India.
 * Lo no cubierto cae al `FUEL_PRICES_FALLBACK`.
 */
export const FUEL_PRICES: Record<string, FuelPrices> = {
  // ─── UE 27 ───
  AT: { gasoline: 1.55, diesel: 1.62, electricity: 0.28 },
  BE: { gasoline: 1.74, diesel: 1.86, electricity: 0.35 },
  BG: { gasoline: 1.32, diesel: 1.35, electricity: 0.12 },
  HR: { gasoline: 1.55, diesel: 1.49, electricity: 0.16 },
  CY: { gasoline: 1.49, diesel: 1.59, electricity: 0.28 },
  CZ: { gasoline: 1.55, diesel: 1.49, electricity: 0.26 },
  DK: { gasoline: 1.93, diesel: 1.78, electricity: 0.39 },
  EE: { gasoline: 1.69, diesel: 1.64, electricity: 0.22 },
  FI: { gasoline: 1.85, diesel: 1.74, electricity: 0.16 },
  FR: { gasoline: 1.84, diesel: 1.73, electricity: 0.25 },
  DE: { gasoline: 1.79, diesel: 1.69, electricity: 0.4 },
  GR: { gasoline: 1.88, diesel: 1.59, electricity: 0.18 },
  HU: { gasoline: 1.55, diesel: 1.55, electricity: 0.1 },
  IE: { gasoline: 1.79, diesel: 1.79, electricity: 0.36 },
  IT: { gasoline: 1.85, diesel: 1.72, electricity: 0.32 },
  LV: { gasoline: 1.64, diesel: 1.59, electricity: 0.21 },
  LT: { gasoline: 1.51, diesel: 1.42, electricity: 0.18 },
  LU: { gasoline: 1.59, diesel: 1.49, electricity: 0.21 },
  MT: { gasoline: 1.34, diesel: 1.21, electricity: 0.13 },
  NL: { gasoline: 2.05, diesel: 1.78, electricity: 0.35 },
  PL: { gasoline: 1.45, diesel: 1.48, electricity: 0.21 },
  PT: { gasoline: 1.79, diesel: 1.59, electricity: 0.23 },
  RO: { gasoline: 1.45, diesel: 1.48, electricity: 0.21 },
  SK: { gasoline: 1.59, diesel: 1.49, electricity: 0.19 },
  SI: { gasoline: 1.49, diesel: 1.55, electricity: 0.18 },
  ES: { gasoline: 1.49, diesel: 1.42, electricity: 0.2 },
  SE: { gasoline: 1.65, diesel: 1.74, electricity: 0.32 },

  // ─── EFTA + UK ───
  CH: { gasoline: 1.85, diesel: 1.92, electricity: 0.27 },
  NO: { gasoline: 1.92, diesel: 1.78, electricity: 0.13 },
  IS: { gasoline: 2.05, diesel: 1.95, electricity: 0.12 },
  GB: { gasoline: 1.69, diesel: 1.75, electricity: 0.33 },
  UK: { gasoline: 1.69, diesel: 1.75, electricity: 0.33 },

  // ─── Este de Europa / Balcanes ───
  RS: { gasoline: 1.59, diesel: 1.59, electricity: 0.1 },
  BA: { gasoline: 1.32, diesel: 1.32, electricity: 0.1 },
  MK: { gasoline: 1.45, diesel: 1.39, electricity: 0.13 },
  AL: { gasoline: 1.69, diesel: 1.69, electricity: 0.12 },
  ME: { gasoline: 1.49, diesel: 1.42, electricity: 0.11 },
  UA: { gasoline: 1.39, diesel: 1.39, electricity: 0.05 },
  MD: { gasoline: 1.32, diesel: 1.25, electricity: 0.15 },
  BY: { gasoline: 0.85, diesel: 0.89, electricity: 0.07 },
  RU: { gasoline: 0.65, diesel: 0.79, electricity: 0.05 },
  TR: { gasoline: 1.42, diesel: 1.45, electricity: 0.1 },

  // ─── Norteamérica ───
  US: { gasoline: 0.95, diesel: 1.05, electricity: 0.16 },
  CA: { gasoline: 1.15, diesel: 1.25, electricity: 0.13 },
  MX: { gasoline: 1.15, diesel: 1.25, electricity: 0.09 },

  // ─── LatAm (selección) ───
  BR: { gasoline: 1.05, diesel: 0.95, electricity: 0.18 },
  AR: { gasoline: 0.95, diesel: 0.95, electricity: 0.05 },
  CL: { gasoline: 1.32, diesel: 1.15, electricity: 0.15 },
  CO: { gasoline: 0.85, diesel: 0.79, electricity: 0.18 },
  PE: { gasoline: 1.15, diesel: 1.05, electricity: 0.18 },
  UY: { gasoline: 1.79, diesel: 1.59, electricity: 0.22 },

  // ─── África / MENA (selección) ───
  MA: { gasoline: 1.32, diesel: 1.25, electricity: 0.15 },
  DZ: { gasoline: 0.35, diesel: 0.25, electricity: 0.04 },
  TN: { gasoline: 0.85, diesel: 0.75, electricity: 0.08 },
  EG: { gasoline: 0.4, diesel: 0.3, electricity: 0.04 },
  ZA: { gasoline: 1.25, diesel: 1.2, electricity: 0.15 },
  SA: { gasoline: 0.6, diesel: 0.4, electricity: 0.05 },
  AE: { gasoline: 0.78, diesel: 0.85, electricity: 0.08 },
  IL: { gasoline: 1.92, diesel: 1.65, electricity: 0.16 },

  // ─── Asia (selección) ───
  JP: { gasoline: 1.05, diesel: 0.95, electricity: 0.22 },
  KR: { gasoline: 1.25, diesel: 1.15, electricity: 0.12 },
  CN: { gasoline: 1.05, diesel: 1.05, electricity: 0.08 },
  IN: { gasoline: 1.15, diesel: 1.05, electricity: 0.08 },
  TH: { gasoline: 1.05, diesel: 0.95, electricity: 0.12 },
  ID: { gasoline: 0.85, diesel: 0.75, electricity: 0.1 },
  PH: { gasoline: 1.15, diesel: 1.05, electricity: 0.18 },
  VN: { gasoline: 0.95, diesel: 0.85, electricity: 0.08 },
  MY: { gasoline: 0.45, diesel: 0.5, electricity: 0.07 },
  SG: { gasoline: 2.05, diesel: 1.85, electricity: 0.22 },
  HK: { gasoline: 2.65, diesel: 2.35, electricity: 0.16 },
  TW: { gasoline: 0.95, diesel: 0.85, electricity: 0.1 },

  // ─── Oceanía ───
  AU: { gasoline: 1.15, diesel: 1.25, electricity: 0.25 },
  NZ: { gasoline: 1.65, diesel: 1.35, electricity: 0.2 },
};

/**
 * Fallback razonable cuando no tenemos precio para un país concreto.
 * Aproximadamente la media ponderada UE — usar cuando el ISO no esté
 * cubierto en `FUEL_PRICES`.
 */
export const FUEL_PRICES_FALLBACK: FuelPrices = {
  gasoline: 1.55,
  diesel: 1.5,
  electricity: 0.22,
};

/** Devuelve el precio por unidad (€/L para combustibles, €/kWh para eléctrico). */
export function fuelPriceFor(countryIso: string | undefined | null, fuelType: FuelType): number {
  const iso = (countryIso ?? "").toUpperCase();
  const country = FUEL_PRICES[iso] ?? FUEL_PRICES_FALLBACK;
  if (fuelType === "electric") return country.electricity;
  return country[fuelType];
}

/**
 * Factor de emisiones de CO₂ por unidad de combustible quemada.
 * - Gasolina: 2,31 kg CO₂ / L (factor IPCC + AEMA).
 * - Diésel: 2,68 kg CO₂ / L.
 * - Eléctrico: depende del mix; usamos media UE 2025 ≈ 0,23 kg CO₂ / kWh.
 *   Es una aproximación — un coche cargado solo con renovables emite cero,
 *   uno con mix de carbón emite mucho más.
 */
export const CO2_FACTORS: Record<FuelType, number> = {
  gasoline: 2.31,
  diesel: 2.68,
  electric: 0.23,
};
