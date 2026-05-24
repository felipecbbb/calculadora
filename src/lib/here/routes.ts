import "server-only";

/**
 * Cliente HERE Routes v8 — el motor de rutas que alimenta la calculadora
 * de transporte. Devuelve hasta `alternatives + 1` rutas con km totales,
 * duración, peajes en EUR, polilínea codificada (flexpolyline) y desglose
 * de kilómetros por país (necesario para ponderar el coste de combustible
 * en viajes transfronterizos).
 *
 * Docs: https://developer.here.com/documentation/routing-api/8.6.0/dev_guide/
 */

const HERE_BASE = "https://router.hereapi.com/v8/routes";

export type HereCoord = { lat: number; lng: number };

/** Preferencias de carretera mostradas al usuario (matchean la captura de Michelin). */
export type RoadPref =
  | "none"
  | "tolls"
  | "highways"
  | "lowEmissions"
  | "ferries"
  | "vignettes"
  | "tollsAndVignettes"
  | "stayInCountry"
  | "highwaysAndCountry";

export type HereRouteSummary = {
  /** Distancia total en metros. */
  lengthMeters: number;
  /** Duración total en segundos. */
  durationSeconds: number;
  /** Total de peajes en EUR (0 si no hay). */
  tollsEur: number;
  /** Polilíneas HERE flexpolyline por section (una ruta = N sections). */
  polylines: string[];
  /** Kilómetros por país ISO 3166-1 alpha-2 (ES, FR, DE…). */
  kmByCountry: Record<string, number>;
};

/**
 * Mapeo preferencia → features que HERE acepta en `avoid[features]`.
 * Lo que no tiene equivalente nativo cae a `[]` y se documenta en la UI.
 */
const HERE_AVOID: Record<RoadPref, string[]> = {
  none: [],
  tolls: ["tollRoad"],
  highways: ["controlledAccessHighway"],
  // Zonas de bajas emisiones: HERE no expone un toggle limpio; se queda como
  // intención del usuario que mostramos en la UI pero no se envía a HERE.
  lowEmissions: [],
  ferries: ["ferry", "carShuttleTrain"],
  // Viñetas: la mayoría de tramos de viñeta están marcados como tollRoad
  // en HERE, así que reaprovechamos el flag.
  vignettes: ["tollRoad"],
  tollsAndVignettes: ["tollRoad"],
  // "Salir del territorio" requeriría limitar el routing a un país concreto,
  // cosa que solo aplica si origen y destino están en el mismo. Sin avoid.
  stayInCountry: [],
  highwaysAndCountry: ["controlledAccessHighway"],
};

/** ISO 3166-1 alpha-3 → alpha-2 (HERE devuelve 3 letras, nuestro dataset usa 2). */
const ISO3_TO_ISO2: Record<string, string> = {
  ESP: "ES",
  FRA: "FR",
  DEU: "DE",
  PRT: "PT",
  ITA: "IT",
  GBR: "GB",
  IRL: "IE",
  BEL: "BE",
  NLD: "NL",
  LUX: "LU",
  CHE: "CH",
  AUT: "AT",
  LIE: "LI",
  AND: "AD",
  POL: "PL",
  CZE: "CZ",
  SVK: "SK",
  HUN: "HU",
  SVN: "SI",
  HRV: "HR",
  BGR: "BG",
  ROU: "RO",
  GRC: "GR",
  DNK: "DK",
  SWE: "SE",
  NOR: "NO",
  FIN: "FI",
  ISL: "IS",
  EST: "EE",
  LVA: "LV",
  LTU: "LT",
  CYP: "CY",
  MLT: "MT",
  SRB: "RS",
  BIH: "BA",
  MKD: "MK",
  MNE: "ME",
  ALB: "AL",
  UKR: "UA",
  MDA: "MD",
  BLR: "BY",
  RUS: "RU",
  TUR: "TR",
  MAR: "MA",
  DZA: "DZ",
  TUN: "TN",
  EGY: "EG",
  ZAF: "ZA",
  SAU: "SA",
  ARE: "AE",
  ISR: "IL",
  JPN: "JP",
  KOR: "KR",
  CHN: "CN",
  IND: "IN",
  THA: "TH",
  IDN: "ID",
  PHL: "PH",
  VNM: "VN",
  MYS: "MY",
  SGP: "SG",
  HKG: "HK",
  TWN: "TW",
  AUS: "AU",
  NZL: "NZ",
  USA: "US",
  CAN: "CA",
  MEX: "MX",
  BRA: "BR",
  ARG: "AR",
  CHL: "CL",
  COL: "CO",
  PER: "PE",
  URY: "UY",
};

/** Convierte ISO-3 a ISO-2. Si no lo tenemos mapeado, devolvemos las 2 primeras. */
function toIso2(iso3: string): string {
  return ISO3_TO_ISO2[iso3] ?? iso3.slice(0, 2);
}

type HereSpan = { countryCode?: string; length?: number };
type HereTollFare = { price?: { value?: number } };
type HereToll = { fares?: HereTollFare[] };
type HereSection = {
  polyline?: string;
  summary?: { length: number; duration: number };
  tolls?: HereToll[];
  spans?: HereSpan[];
};
type HereRoute = { sections: HereSection[] };
type HereRoutesResponse = { routes: HereRoute[] };

export async function fetchHereRoutes(input: {
  origin: HereCoord;
  destination: HereCoord;
  pref: RoadPref;
  /** Cuántas alternativas pedir además de la principal. Default 2 → 3 rutas. */
  alternatives?: number;
}): Promise<HereRouteSummary[]> {
  const key = process.env.HERE_API_KEY;
  if (!key) {
    throw new Error(
      "HERE_API_KEY no disponible en el servidor. Local: añadirla a .env y reiniciar `npm run dev`. Producción (Vercel): añadirla en Project Settings → Environment Variables y redesplegar.",
    );
  }

  const params = new URLSearchParams({
    transportMode: "car",
    origin: `${input.origin.lat},${input.origin.lng}`,
    destination: `${input.destination.lat},${input.destination.lng}`,
    return: "summary,polyline,tolls",
    spans: "countryCode,length",
    currency: "EUR",
    lang: "es-ES",
    alternatives: String(input.alternatives ?? 2),
    apiKey: key,
  });
  const avoids = HERE_AVOID[input.pref];
  if (avoids.length > 0) params.set("avoid[features]", avoids.join(","));

  const res = await fetch(`${HERE_BASE}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HERE Routes ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => null)) as HereRoutesResponse | null;
  if (!data || !Array.isArray(data.routes)) {
    throw new Error("HERE Routes devolvió una respuesta inesperada");
  }
  return data.routes.filter((r) => Array.isArray(r?.sections)).map(summarize);
}

function summarize(route: HereRoute): HereRouteSummary {
  let lengthMeters = 0;
  let durationSeconds = 0;
  let tollsEur = 0;
  const polylines: string[] = [];
  const kmByCountry: Record<string, number> = {};

  for (const section of route.sections) {
    if (section.summary) {
      lengthMeters += section.summary.length;
      durationSeconds += section.summary.duration;
    }
    if (section.polyline) polylines.push(section.polyline);
    if (section.tolls) {
      for (const toll of section.tolls) {
        const fare = toll.fares?.[0]?.price?.value ?? 0;
        tollsEur += fare;
      }
    }
    if (section.spans) {
      for (const span of section.spans) {
        if (!span.countryCode || !span.length) continue;
        const iso2 = toIso2(span.countryCode);
        kmByCountry[iso2] = (kmByCountry[iso2] ?? 0) + span.length / 1000;
      }
    }
  }

  return {
    lengthMeters,
    durationSeconds,
    tollsEur,
    // Devolvemos TODAS las polilíneas (una por section). Cada una es un
    // flexpolyline independiente — concatenarlas como strings rompe el
    // decoder, así que el cliente decodifica cada section por separado.
    polylines,
    kmByCountry,
  };
}
