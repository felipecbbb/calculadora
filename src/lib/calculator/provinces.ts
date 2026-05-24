/**
 * Provincias españolas indexadas por los 2 primeros dígitos del código postal.
 * Cada entrada incluye nombre, CCAA a la que pertenece y coordenadas
 * aproximadas del centro provincial (capital) para estimar distancias por
 * fórmula Haversine al introducir CP origen y destino.
 *
 * El cliente del marketplace pide la provincia donde se matriculará el
 * vehículo. Las CCAA derivadas se usan internamente para aplicar el régimen
 * fiscal correcto (Canarias, Ceuta, Melilla, regímenes forales).
 */

export type Province = {
  /** Dos primeros dígitos del CP (string para conservar el cero a la izquierda). */
  cp: string;
  /** Código ISO 3166-2 ES-XX (provincia). Útil al exportar facturas. */
  iso: string;
  name: string;
  /** Comunidad autónoma a la que pertenece. */
  ccaa: CCAA;
  /** Coordenadas (lat, lng) de la capital provincial — para estimar distancias. */
  lat: number;
  lng: number;
};

export type CCAA =
  | "ES-AN"
  | "ES-AR"
  | "ES-AS"
  | "ES-CN"
  | "ES-CB"
  | "ES-CL"
  | "ES-CM"
  | "ES-CT"
  | "ES-EX"
  | "ES-GA"
  | "ES-IB"
  | "ES-MD"
  | "ES-MC"
  | "ES-NC"
  | "ES-PV"
  | "ES-RI"
  | "ES-VC"
  | "ES-CE"
  | "ES-ML";

/**
 * Tipo del Impuesto sobre Transmisiones Patrimoniales (TPO) aplicable a la
 * compraventa de vehículos usados entre particulares en 2026, por CCAA.
 *
 * Solo se aplica cuando comprador y vendedor son ambos PARTICULARES. Si el
 * vendedor es profesional, la operación lleva IVA y NO ITP.
 *
 * Base imponible: el mayor entre el precio declarado y el valor venal del
 * Anexo I BOE con depreciación del Anexo IV.
 *
 * Fuentes:
 *   - Swipoo (https://swipoo.com/impuesto-de-transmisiones-patrimoniales)
 *   - Garantía Global · ITP por comunidad autónoma 2026
 *   - RACE · Impuesto transmisiones patrimoniales coche
 *
 * NOTA: cada CCAA puede tener tarifas fijas para vehículos antiguos
 * (Aragón, Cantabria, Comunidad Valenciana…), reducciones por etiqueta
 * CERO y bonificaciones por familia numerosa. La calculadora aplica el
 * tipo general + las reglas más comunes (CVF > 15, antigüedad > 10 años).
 */

/** Tipos generales por CCAA · 2026. */
const ITP_GENERAL_RATE: Record<CCAA, number> = {
  "ES-AN": 0.04, // Andalucía
  "ES-AR": 0.04, // Aragón
  "ES-AS": 0.04, // Asturias
  "ES-CN": 0.055, // Canarias (ITP canario, IGIC no se aplica P→P)
  "ES-CB": 0.06, // Cantabria
  "ES-CL": 0.05, // Castilla y León
  "ES-CM": 0.06, // Castilla-La Mancha
  "ES-CT": 0.05, // Cataluña (>10 años → exento)
  "ES-EX": 0.06, // Extremadura
  "ES-GA": 0.03, // Galicia (bajado en reformas recientes)
  "ES-IB": 0.04, // Baleares
  "ES-MD": 0.04, // Madrid
  "ES-MC": 0.04, // Murcia
  "ES-NC": 0.04, // Navarra (foral)
  "ES-PV": 0.04, // País Vasco (foral)
  "ES-RI": 0.04, // La Rioja
  "ES-VC": 0.06, // Comunidad Valenciana
  "ES-CE": 0.04, // Ceuta
  "ES-ML": 0.04, // Melilla
};

/** CCAA donde se aplica un tipo especial del 8% para vehículos con más de
 *  15 caballos fiscales (turismos y todoterrenos). */
const ITP_HIGH_CVF_CCAA: ReadonlySet<CCAA> = new Set(["ES-AN", "ES-AS", "ES-IB", "ES-CL"]);

export type ItpInputs = {
  ccaa: CCAA;
  cvf: number;
  /** Potencia real (CV, no caballos fiscales) — necesaria para Canarias
   *  donde a partir de 200 CV se aplica un tipo distinto. */
  cv: number;
  ageYears: number;
};

export type ItpResult = {
  rate: number;
  /** Texto que explica de dónde sale el tipo aplicado (general / 8% por
   *  >15 CVF / 0% en Cataluña >10 años / etc). */
  reason?: string;
};

/**
 * Calcula el tipo ITP aplicable a una compraventa concreta P→P según CCAA,
 * caballos fiscales y antigüedad del vehículo. Aplica las reglas más
 * extendidas (>15 CVF en Andalucía/Asturias/Baleares/Castilla y León,
 * exención Cataluña >10 años). Para casos especiales (familia numerosa,
 * etiqueta CERO, vehículos comerciales) la calculadora muestra el tipo
 * general — son matices fuera del alcance MVP.
 */
export function calculateItpRate(input: ItpInputs): ItpResult {
  const { ccaa, cvf, cv, ageYears } = input;

  // Cataluña: vehículos > 10 años están exentos del ITP.
  if (ccaa === "ES-CT" && ageYears > 10) {
    return { rate: 0, reason: "Cataluña · vehículo > 10 años → exento" };
  }

  // Canarias: 3 tramos según antigüedad y potencia real.
  if (ccaa === "ES-CN") {
    if (ageYears > 10) {
      return { rate: 0.04, reason: "Canarias · vehículo > 10 años" };
    }
    if (cv > 200) {
      return { rate: 0.065, reason: "Canarias · vehículo > 200 CV" };
    }
    return { rate: 0.055 };
  }

  // Andalucía / Asturias / Baleares / Castilla y León: 8% si CVF > 15.
  if (ITP_HIGH_CVF_CCAA.has(ccaa) && cvf > 15) {
    return { rate: 0.08, reason: `Tipo agravado del 8% por CVF > 15 (${CCAA_NAMES[ccaa]})` };
  }

  return { rate: ITP_GENERAL_RATE[ccaa] };
}

/** Compatibilidad: alias del tipo general. Se mantiene para que el motor
 *  pueda seguir usándolo si solo necesita el tipo base. Para el cálculo
 *  real usa `calculateItpRate`. */
export const ITP_RATES_BY_CCAA: Record<CCAA, number> = ITP_GENERAL_RATE;

export const CCAA_NAMES: Record<CCAA, string> = {
  "ES-AN": "Andalucía",
  "ES-AR": "Aragón",
  "ES-AS": "Asturias",
  "ES-CN": "Canarias",
  "ES-CB": "Cantabria",
  "ES-CL": "Castilla y León",
  "ES-CM": "Castilla-La Mancha",
  "ES-CT": "Cataluña",
  "ES-EX": "Extremadura",
  "ES-GA": "Galicia",
  "ES-IB": "Islas Baleares",
  "ES-MD": "Madrid",
  "ES-MC": "Murcia",
  "ES-NC": "Navarra",
  "ES-PV": "País Vasco",
  "ES-RI": "La Rioja",
  "ES-VC": "Comunidad Valenciana",
  "ES-CE": "Ceuta",
  "ES-ML": "Melilla",
};

export const PROVINCES: ReadonlyArray<Province> = [
  { cp: "01", iso: "ES-VI", name: "Álava", ccaa: "ES-PV", lat: 42.847, lng: -2.673 },
  { cp: "02", iso: "ES-AB", name: "Albacete", ccaa: "ES-CM", lat: 38.994, lng: -1.858 },
  { cp: "03", iso: "ES-A", name: "Alicante", ccaa: "ES-VC", lat: 38.345, lng: -0.481 },
  { cp: "04", iso: "ES-AL", name: "Almería", ccaa: "ES-AN", lat: 36.834, lng: -2.464 },
  { cp: "05", iso: "ES-AV", name: "Ávila", ccaa: "ES-CL", lat: 40.656, lng: -4.681 },
  { cp: "06", iso: "ES-BA", name: "Badajoz", ccaa: "ES-EX", lat: 38.879, lng: -6.97 },
  { cp: "07", iso: "ES-PM", name: "Baleares", ccaa: "ES-IB", lat: 39.57, lng: 2.65 },
  { cp: "08", iso: "ES-B", name: "Barcelona", ccaa: "ES-CT", lat: 41.385, lng: 2.173 },
  { cp: "09", iso: "ES-BU", name: "Burgos", ccaa: "ES-CL", lat: 42.341, lng: -3.7 },
  { cp: "10", iso: "ES-CC", name: "Cáceres", ccaa: "ES-EX", lat: 39.476, lng: -6.371 },
  { cp: "11", iso: "ES-CA", name: "Cádiz", ccaa: "ES-AN", lat: 36.527, lng: -6.292 },
  { cp: "12", iso: "ES-CS", name: "Castellón", ccaa: "ES-VC", lat: 39.986, lng: -0.037 },
  { cp: "13", iso: "ES-CR", name: "Ciudad Real", ccaa: "ES-CM", lat: 38.984, lng: -3.927 },
  { cp: "14", iso: "ES-CO", name: "Córdoba", ccaa: "ES-AN", lat: 37.884, lng: -4.779 },
  { cp: "15", iso: "ES-C", name: "A Coruña", ccaa: "ES-GA", lat: 43.362, lng: -8.411 },
  { cp: "16", iso: "ES-CU", name: "Cuenca", ccaa: "ES-CM", lat: 40.07, lng: -2.135 },
  { cp: "17", iso: "ES-GI", name: "Girona", ccaa: "ES-CT", lat: 41.984, lng: 2.825 },
  { cp: "18", iso: "ES-GR", name: "Granada", ccaa: "ES-AN", lat: 37.177, lng: -3.598 },
  { cp: "19", iso: "ES-GU", name: "Guadalajara", ccaa: "ES-CM", lat: 40.633, lng: -3.166 },
  { cp: "20", iso: "ES-SS", name: "Gipuzkoa", ccaa: "ES-PV", lat: 43.318, lng: -1.981 },
  { cp: "21", iso: "ES-H", name: "Huelva", ccaa: "ES-AN", lat: 37.262, lng: -6.944 },
  { cp: "22", iso: "ES-HU", name: "Huesca", ccaa: "ES-AR", lat: 42.137, lng: -0.408 },
  { cp: "23", iso: "ES-J", name: "Jaén", ccaa: "ES-AN", lat: 37.766, lng: -3.789 },
  { cp: "24", iso: "ES-LE", name: "León", ccaa: "ES-CL", lat: 42.598, lng: -5.567 },
  { cp: "25", iso: "ES-L", name: "Lleida", ccaa: "ES-CT", lat: 41.617, lng: 0.62 },
  { cp: "26", iso: "ES-LO", name: "La Rioja", ccaa: "ES-RI", lat: 42.466, lng: -2.45 },
  { cp: "27", iso: "ES-LU", name: "Lugo", ccaa: "ES-GA", lat: 43.012, lng: -7.555 },
  { cp: "28", iso: "ES-M", name: "Madrid", ccaa: "ES-MD", lat: 40.4168, lng: -3.7038 },
  { cp: "29", iso: "ES-MA", name: "Málaga", ccaa: "ES-AN", lat: 36.721, lng: -4.421 },
  { cp: "30", iso: "ES-MU", name: "Murcia", ccaa: "ES-MC", lat: 37.984, lng: -1.128 },
  { cp: "31", iso: "ES-NA", name: "Navarra", ccaa: "ES-NC", lat: 42.812, lng: -1.645 },
  { cp: "32", iso: "ES-OR", name: "Ourense", ccaa: "ES-GA", lat: 42.336, lng: -7.864 },
  { cp: "33", iso: "ES-O", name: "Asturias", ccaa: "ES-AS", lat: 43.362, lng: -5.849 },
  { cp: "34", iso: "ES-P", name: "Palencia", ccaa: "ES-CL", lat: 42.011, lng: -4.532 },
  { cp: "35", iso: "ES-GC", name: "Las Palmas", ccaa: "ES-CN", lat: 28.124, lng: -15.43 },
  { cp: "36", iso: "ES-PO", name: "Pontevedra", ccaa: "ES-GA", lat: 42.434, lng: -8.648 },
  { cp: "37", iso: "ES-SA", name: "Salamanca", ccaa: "ES-CL", lat: 40.97, lng: -5.663 },
  {
    cp: "38",
    iso: "ES-TF",
    name: "Santa Cruz de Tenerife",
    ccaa: "ES-CN",
    lat: 28.466,
    lng: -16.251,
  },
  { cp: "39", iso: "ES-S", name: "Cantabria", ccaa: "ES-CB", lat: 43.463, lng: -3.81 },
  { cp: "40", iso: "ES-SG", name: "Segovia", ccaa: "ES-CL", lat: 40.949, lng: -4.118 },
  { cp: "41", iso: "ES-SE", name: "Sevilla", ccaa: "ES-AN", lat: 37.389, lng: -5.984 },
  { cp: "42", iso: "ES-SO", name: "Soria", ccaa: "ES-CL", lat: 41.764, lng: -2.467 },
  { cp: "43", iso: "ES-T", name: "Tarragona", ccaa: "ES-CT", lat: 41.119, lng: 1.244 },
  { cp: "44", iso: "ES-TE", name: "Teruel", ccaa: "ES-AR", lat: 40.344, lng: -1.107 },
  { cp: "45", iso: "ES-TO", name: "Toledo", ccaa: "ES-CM", lat: 39.857, lng: -4.024 },
  { cp: "46", iso: "ES-V", name: "Valencia", ccaa: "ES-VC", lat: 39.469, lng: -0.376 },
  { cp: "47", iso: "ES-VA", name: "Valladolid", ccaa: "ES-CL", lat: 41.652, lng: -4.724 },
  { cp: "48", iso: "ES-BI", name: "Bizkaia", ccaa: "ES-PV", lat: 43.263, lng: -2.935 },
  { cp: "49", iso: "ES-ZA", name: "Zamora", ccaa: "ES-CL", lat: 41.504, lng: -5.745 },
  { cp: "50", iso: "ES-Z", name: "Zaragoza", ccaa: "ES-AR", lat: 41.649, lng: -0.886 },
  { cp: "51", iso: "ES-CE", name: "Ceuta", ccaa: "ES-CE", lat: 35.889, lng: -5.32 },
  { cp: "52", iso: "ES-ML", name: "Melilla", ccaa: "ES-ML", lat: 35.293, lng: -2.938 },
];

const PROVINCES_BY_CP = new Map(PROVINCES.map((p) => [p.cp, p]));
const PROVINCES_BY_ISO = new Map(PROVINCES.map((p) => [p.iso, p]));

/**
 * Resuelve la provincia a partir de un CP español de 5 dígitos. Si el formato
 * no es válido o el prefijo no corresponde a ninguna provincia, devuelve null.
 */
export function provinceFromCp(cp: string): Province | null {
  const trimmed = cp.trim();
  if (!/^\d{5}$/.test(trimmed)) return null;
  return PROVINCES_BY_CP.get(trimmed.slice(0, 2)) ?? null;
}

export function provinceFromIso(iso: string): Province | null {
  return PROVINCES_BY_ISO.get(iso) ?? null;
}

/**
 * Resuelve la CCAA a partir de un código ISO. Acepta dos formatos:
 *   - Directamente un código de CCAA (`ES-MD`, `ES-CT`, `ES-PV`…) — útil
 *     cuando la calculadora pregunta por comunidad autónoma.
 *   - Un código de provincia (`ES-VI`, `ES-B`, `ES-M`…) — entonces resuelve
 *     por la tabla de provincias. Mantiene compatibilidad con cálculos
 *     guardados antiguos que persisten códigos provinciales.
 */
export function ccaaFromIso(iso: string): CCAA | null {
  if (iso in CCAA_NAMES) return iso as CCAA;
  return provinceFromIso(iso)?.ccaa ?? null;
}

/** Lista ordenada alfabéticamente de CCAA para usar en selects. */
export const CCAA_OPTIONS: ReadonlyArray<{ iso: CCAA; name: string }> = (
  Object.entries(CCAA_NAMES) as Array<[CCAA, string]>
)
  .map(([iso, name]) => ({ iso, name }))
  .sort((a, b) => a.name.localeCompare(b.name, "es"));

/**
 * Distancia por carretera estimada entre dos códigos postales españoles.
 * Calcula la distancia ortodrómica (Haversine) entre las capitales
 * provinciales de origen y destino y aplica un factor 1.25 que aproxima
 * el detour típico por la red viaria.
 *
 * Devuelve null si alguno de los CPs no resuelve a una provincia conocida.
 */
export function estimateRoadDistanceKm(originCp: string, destCp: string): number | null {
  const a = provinceFromCp(originCp);
  const b = provinceFromCp(destCp);
  if (!a || !b) return null;
  if (a.cp === b.cp) return 30; // misma provincia: estimacion conservadora
  const orthodromic = haversine(a.lat, a.lng, b.lat, b.lng);
  return Math.round(orthodromic * 1.25);
}

/**
 * Devuelve la provincia cuya capital está más cerca de las coordenadas
 * dadas. Útil cuando Google Places devuelve un lugar (ciudad) sin código
 * postal explícito — derivamos un CP de 5 dígitos a partir del prefijo
 * provincial + "000". Sirve para el cálculo de distancia interno.
 */
export function nearestProvince(lat: number, lng: number): Province | null {
  let best: Province | null = null;
  let bestDist = Infinity;
  for (const p of PROVINCES) {
    const d = haversine(lat, lng, p.lat, p.lng);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/**
 * Distancia por carretera estimada entre dos coordenadas absolutas.
 * Útil cuando uno de los puntos no está en España (Múnich, Roma…) y por
 * tanto no resuelve a una provincia de nuestra tabla. Aplica el mismo
 * factor 1.25 que `estimateRoadDistanceKm` para aproximar el recorrido
 * real frente a la distancia ortodrómica.
 */
export function roadDistanceFromCoordsKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return Math.round(haversine(a.lat, a.lng, b.lat, b.lng) * 1.25);
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
