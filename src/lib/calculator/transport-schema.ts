import { z } from "zod";

export const FUEL_TYPES = ["gasoline", "diesel", "electric"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const ROAD_PREFS = [
  "none",
  "tolls",
  "highways",
  "lowEmissions",
  "ferries",
  "vignettes",
  "tollsAndVignettes",
  "stayInCountry",
  "highwaysAndCountry",
] as const;
export type RoadPref = (typeof ROAD_PREFS)[number];

export const ROAD_PREF_LABELS: Record<RoadPref, string> = {
  none: "Ninguna",
  tolls: "Evitar peajes",
  highways: "Evitar vías rápidas",
  lowEmissions: "Evitar zonas de bajas emisiones",
  ferries: "Evitar conexiones marítimas",
  vignettes: "Evitar compra de viñeta",
  tollsAndVignettes: "Evitar peajes y viñetas",
  stayInCountry: "Evitar salir del territorio",
  highwaysAndCountry: "Evitar las autopistas y salir del país",
};

export const FUEL_LABELS: Record<FuelType, string> = {
  gasoline: "Gasolina",
  diesel: "Diésel",
  electric: "Eléctrico",
};

/**
 * El usuario rellena origen/destino vía Google Places; al picker le pedimos
 * lat/lng y countryCode. Los costes adicionales (vuelos, taxis, alojamiento,
 * comida) son opcionales — si los deja en 0 simplemente no suman.
 */
export const transportSchema = z.object({
  originLat: z.number().min(-90).max(90),
  originLng: z.number().min(-180).max(180),
  originLabel: z.string().min(1),
  originCountry: z.string().optional(),

  destLat: z.number().min(-90).max(90),
  destLng: z.number().min(-180).max(180),
  destLabel: z.string().min(1),
  destCountry: z.string().optional(),

  flightsEur: z.number().min(0).default(0),
  groundTransportEur: z.number().min(0).default(0),
  lodgingEur: z.number().min(0).default(0),
  foodEur: z.number().min(0).default(0),

  /** L/100 km para gasolina/diésel · kWh/100 km para eléctrico. */
  consumption: z.number().min(0.1).max(200),
  fuelType: z.enum(FUEL_TYPES),
  roadPref: z.enum(ROAD_PREFS).default("none"),
});

export type TransportInput = z.infer<typeof transportSchema>;
