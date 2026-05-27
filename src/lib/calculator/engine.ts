/**
 * Motor de cálculo de gastos de importación (módulo H del contrato).
 *
 * Calcula el coste total estimado de importar un vehículo a España desde otro
 * país europeo. **No incluye IVA del coche**: por petición del cliente se ha
 * dejado fuera porque su tratamiento (sujeto/exento, intracom con NIF-IVA,
 * inversión del sujeto pasivo, taxas paralelas en Canarias/Ceuta/Melilla)
 * depende de circunstancias que no caben en una calculadora orientativa.
 *
 * Cubre:
 *   - IEDMT (impuesto de matriculación) por tramos de CO₂ WLTP
 *   - Aplicado sobre valor venal con depreciación BOE (Anexo IV
 *     Orden HAC/1501/2025)
 *   - Exenciones: discapacidad ≥ 33%, Canarias / Ceuta / Melilla
 *   - Bonificación 50% por familia numerosa
 *   - Transporte estimado por CP origen → CP destino y modalidad
 *   - Servicios opcionales: pre-compra, ficha reducida, gestión integral
 *   - IVTM anual estatal mínimo (art. 95 TRLRHL)
 *   - Tasa DGT 1.1 (matriculación)
 *
 * Importante: el resultado **no es válido** para vehículos con menos de
 * 6 meses desde su 1ª matriculación o con menos de 6.000 km — entonces
 * Hacienda exige que la base IEDMT sea el valor real de factura.
 */

import { CCAA_NAMES, calculateItpRate, ccaaFromIso, type CCAA } from "./provinces";

export const VEHICLE_TYPES = ["turismo", "off_road", "classic", "ev_or_hybrid"] as const;
export type CalcVehicleType = (typeof VEHICLE_TYPES)[number];

/** Tipo de comprador (rol fiscal): el que va a matricular el coche. */
export const BUYER_TYPES = ["particular", "professional"] as const;
export type CalcBuyerType = (typeof BUYER_TYPES)[number];

/** Tipo de vendedor (rol fiscal): de quién compras el coche en origen. */
export const SELLER_TYPES = ["particular", "professional"] as const;
export type CalcSellerType = (typeof SELLER_TYPES)[number];

/** Tres modalidades de transporte de coches. */
export const TRUCK_TYPES = ["trailer", "open_solo", "closed_solo"] as const;
export type CalcTruckType = (typeof TRUCK_TYPES)[number];

export const TRUCK_LABELS: Record<CalcTruckType, string> = {
  trailer: "Tráiler portacoches (más habitual)",
  open_solo: "Plataforma unitaria abierta",
  closed_solo: "Plataforma unitaria cerrada",
};

/** Tramos de emisiones CO₂ WLTP fijados por la Ley 38/1992 + Ley 34/2007.
 *  Mapean a los epígrafes oficiales del IEDMT:
 *    lt120    → epígrafe 1.º (turismos < 120 g/km) — 0% en todas las CCAA
 *    120_159  → epígrafe 2.º
 *    160_199  → epígrafe 3.º
 *    gte200   → epígrafe 4.º
 *  El campo `rate` aquí es el de península solo para legacy; el tipo real
 *  se calcula con `iedmtRateFor(ccaa, bracket)`. */
export const CO2_BRACKETS = [
  { id: "lt120", label: "Menos de 120 g/km", representativeCo2: 100, rate: 0 },
  { id: "120_159", label: "Entre 120 y 159 g/km", representativeCo2: 140, rate: 0.0475 },
  { id: "160_199", label: "Entre 160 y 199 g/km", representativeCo2: 180, rate: 0.0975 },
  { id: "gte200", label: "200 g/km o más", representativeCo2: 220, rate: 0.1475 },
] as const;
export type CalcCo2Bracket = (typeof CO2_BRACKETS)[number]["id"];

/**
 * Tabla oficial IEDMT 2026 por epígrafe y territorio (Ley 38/1992 art. 70 +
 * tipos generales publicados en sede.agenciatributaria.gob.es).
 *
 *   Península / Baleares · Canarias · Ceuta y Melilla
 *   Epígrafe 1.º (lt120):   0% / 0% / 0%
 *   Epígrafe 2.º (120-159): 4,75% / 3,75% / 0%
 *   Epígrafe 3.º (160-199): 9,75% / 8,75% / 0%
 *   Epígrafe 4.º (≥200):    14,75% / 13,75% / 0%
 *
 * Las CCAA pueden modificar al alza los tipos para los epígrafes 4 y 9
 * (turismos / motos potentes). Las modificaciones vigentes en 2026 según
 * AEAT son:
 *    Andalucía: estatal (no modifica)
 *    Asturias:  16%
 *    Baleares:  16% (solo epígrafe 4 turismos)
 *    Cantabria: 15% (epígrafe 4) — tambien 9,75% epígrafe 3 (igual estatal)
 *    Cataluña:  16%
 *    Murcia:    15,9%
 *    C. Valenciana: 16%
 */
const IEDMT_BASE: Record<
  CalcCo2Bracket,
  { peninsula: number; canarias: number; ceutaMelilla: number }
> = {
  lt120: { peninsula: 0, canarias: 0, ceutaMelilla: 0 },
  "120_159": { peninsula: 0.0475, canarias: 0.0375, ceutaMelilla: 0 },
  "160_199": { peninsula: 0.0975, canarias: 0.0875, ceutaMelilla: 0 },
  gte200: { peninsula: 0.1475, canarias: 0.1375, ceutaMelilla: 0 },
};

const IEDMT_REGIONAL_OVERRIDES: Partial<Record<CCAA, Partial<Record<CalcCo2Bracket, number>>>> = {
  "ES-AS": { gte200: 0.16 },
  "ES-IB": { gte200: 0.16 },
  "ES-CB": { gte200: 0.15 },
  "ES-CT": { gte200: 0.16 },
  "ES-MC": { gte200: 0.159 },
  "ES-VC": { gte200: 0.16 },
};

/**
 * Devuelve el tipo IEDMT vigente para la CCAA y el tramo CO₂.
 * Aplica primero los overrides autonómicos (16% Asturias, 15% Cantabria,
 * 15,9% Murcia, etc.) y cae a la tabla estatal/canaria/ceuta-melilla.
 */
export function iedmtRateFor(ccaa: CCAA, bracket: CalcCo2Bracket): number {
  const override = IEDMT_REGIONAL_OVERRIDES[ccaa]?.[bracket];
  if (override != null) return override;
  if (ccaa === "ES-CN") return IEDMT_BASE[bracket].canarias;
  if (ccaa === "ES-CE" || ccaa === "ES-ML") return IEDMT_BASE[bracket].ceutaMelilla;
  return IEDMT_BASE[bracket].peninsula;
}

/**
 * Régimen foral bloqueado. Actualmente ninguno: tras revisar el BON 2026
 * (Orden Foral 6/2026 de Navarra), las tablas de precios y la fórmula
 * (Art. 4 regla 2ª) son idénticas al BOE estatal. País Vasco también
 * usa el BOE pero con fórmula simplificada — se gestiona en su propia
 * rama del switch. Se mantiene el array por si algún territorio futuro
 * necesita bloqueo total.
 */
export const FORAL_CCAA: ReadonlyArray<CCAA> = [];

/**
 * Tipo IVA del Impuesto sobre el Valor Añadido aplicable en la primera
 * matriculación, según la fecha. Necesario para la fórmula del Art. 5
 * regla 2ª de la Orden HAC/1501/2025 (descuenta del valor de mercado la
 * imposición indirecta ya soportada).
 *
 * Histórico oficial (AEAT):
 *   1986-01-01 → 12% (entrada del IVA en España)
 *   1992-08-01 → 13%
 *   1993-01-01 → 15%
 *   1995-08-01 → 16%
 *   2010-07-01 → 18%
 *   2012-09-01 → 21% (vigente)
 *
 * Si la fecha es anterior a 1986-01-01, se usa el tipo más antiguo (12%).
 */
const VAT_HISTORY: ReadonlyArray<{ from: string; rate: number }> = [
  { from: "2012-09-01", rate: 0.21 },
  { from: "2010-07-01", rate: 0.18 },
  { from: "1995-08-01", rate: 0.16 },
  { from: "1993-01-01", rate: 0.15 },
  { from: "1992-08-01", rate: 0.13 },
  { from: "1986-01-01", rate: 0.12 },
];

export function vatRateForRegDate(firstRegISO: string): number {
  if (!firstRegISO) return 0.21;
  for (const step of VAT_HISTORY) {
    if (firstRegISO >= step.from) return step.rate;
  }
  return 0.12;
}

/**
 * Tipo IGIC (Impuesto General Indirecto Canario) aplicable a la 1ª
 * matriculación. Reemplaza al IVA en territorio canario. Tipo general
 * vigente para turismos:
 *
 *   1993-01-01 → 4%
 *   1996-01-01 → 4,5%
 *   2010-07-01 → 5%
 *   2012-07-01 → 7%
 *   2020-01-01 → 6,5%   (Ley 7/2019 Presupuestos Canarias)
 *   2020-09-01 → 7%     (Ley 4/2020, vigente)
 */
const IGIC_HISTORY: ReadonlyArray<{ from: string; rate: number }> = [
  { from: "2020-09-01", rate: 0.07 },
  { from: "2020-01-01", rate: 0.065 },
  { from: "2012-07-01", rate: 0.07 },
  { from: "2010-07-01", rate: 0.05 },
  { from: "1996-01-01", rate: 0.045 },
  { from: "1993-01-01", rate: 0.04 },
];

export function igicRateForRegDate(firstRegISO: string): number {
  if (!firstRegISO) return 0.07;
  for (const step of IGIC_HISTORY) {
    if (firstRegISO >= step.from) return step.rate;
  }
  return 0.04;
}

// Tabla de depreciación oficial — Anexo IV de la Orden HAC/1501/2025
// (precios medios de venta 2026, BOE 23 dic 2025).
const DEPRECIATION_BOE_2026: ReadonlyArray<{ maxYears: number; factor: number }> = [
  { maxYears: 1, factor: 1.0 },
  { maxYears: 2, factor: 0.84 },
  { maxYears: 3, factor: 0.67 },
  { maxYears: 4, factor: 0.56 },
  { maxYears: 5, factor: 0.47 },
  { maxYears: 6, factor: 0.39 },
  { maxYears: 7, factor: 0.34 },
  { maxYears: 8, factor: 0.28 },
  { maxYears: 9, factor: 0.24 },
  { maxYears: 10, factor: 0.19 },
  { maxYears: 11, factor: 0.17 },
  { maxYears: 12, factor: 0.13 },
  { maxYears: Infinity, factor: 0.1 },
];

export function depreciationFactor(ageYears: number, type: CalcVehicleType): number {
  let factor = 0.1;
  for (const step of DEPRECIATION_BOE_2026) {
    if (ageYears < step.maxYears) {
      factor = step.factor;
      break;
    }
  }
  // Vehículos clásicos no se deprecian por debajo del 50%.
  if (type === "classic" && factor < 0.5) factor = 0.5;
  return factor;
}

export function ageInYears(firstRegISO: string, ref: Date = new Date()): number {
  const reg = new Date(firstRegISO);
  if (isNaN(reg.getTime())) return 0;
  const diffMs = ref.getTime() - reg.getTime();
  return Math.max(0, diffMs / (365.25 * 24 * 60 * 60 * 1000));
}

/** Indica si el cálculo IEDMT NO es válido por la regla de los 6m / 6000 km. */
/**
 * Caballos fiscales (CVF) según la fórmula oficial para turismos
 * (Reglamento del Impuesto sobre Vehículos de Tracción Mecánica, anexo):
 *   CVF = (cilindrada_cc / N_cilindros)^0.6 × 0.08 × N_cilindros
 * Se usa cuando el vehículo no aparece en las tablas BOE y el CVF no
 * viene dado. Devuelve 0 si los parámetros no son válidos.
 */
export function calcCvfFromEngine(cc: number, cylinders: number): number {
  if (!Number.isFinite(cc) || !Number.isFinite(cylinders) || cc <= 0 || cylinders <= 0) {
    return 0;
  }
  const cvf = Math.pow(cc / cylinders, 0.6) * 0.08 * cylinders;
  return Math.round(cvf * 100) / 100;
}

export function isIedmtCalcValid(ageYears: number, kilometers: number | undefined): boolean {
  if (ageYears < 0.5) return false;
  if (kilometers != null && kilometers < 6000) return false;
  return true;
}

// Estimación de transporte por modalidad. Rangos medios 2025 con un mínimo
// fijo independiente de la distancia.
const TRANSPORT_RATES: Record<CalcTruckType, { ratePerKm: number; minCents: number }> = {
  trailer: { ratePerKm: 0.7, minCents: 350_00 },
  open_solo: { ratePerKm: 1.1, minCents: 600_00 },
  closed_solo: { ratePerKm: 1.45, minCents: 800_00 },
};

export function transportEstimateCents(distanceKm: number, type: CalcTruckType): number {
  if (distanceKm <= 0) return 0;
  const cfg = TRANSPORT_RATES[type];
  return Math.max(cfg.minCents, Math.round(distanceKm * cfg.ratePerKm * 100));
}

// IVTM anual estatal mínimo (art. 95 RDLeg 2/2004 TRLRHL). Cada
// ayuntamiento puede aplicar un coeficiente de hasta 2x. Mostramos el suelo
// legal — la mayoría de capitales lo duplican.
function ivtmAnnualCents(cvf: number): number {
  const tramos: ReadonlyArray<{ maxCvf: number; eur: number }> = [
    { maxCvf: 7.99, eur: 12.62 },
    { maxCvf: 11.99, eur: 34.08 },
    { maxCvf: 15.99, eur: 71.94 },
    { maxCvf: 19.99, eur: 89.61 },
    { maxCvf: Infinity, eur: 112.0 },
  ];
  for (const t of tramos) {
    if (cvf <= t.maxCvf) return Math.round(t.eur * 100);
  }
  return Math.round(112.0 * 100);
}

// Tasa DGT 1.1 — Expedición de permiso de circulación. Importe oficial
// vigente (congelado desde 2022).
const DGT_FEES_CENTS = 99_77;

// Tasa DGT 1.4 — Permisos temporales para traslados y pruebas. Necesaria
// para obtener la matrícula provisional verde con la que circular el
// vehículo importado mientras se completa la matriculación definitiva.
// Importe oficial DGT 2026: 20,61 €.
const GREEN_PLATES_FEE_CENTS = 20_61;

// Placas físicas (provisionales y definitivas). Importes orientativos del
// mercado — varían según el lugar de compra.
const GREEN_PLATES_PHYSICAL_CENTS = 30_00;
const FINAL_PLATES_CENTS = 30_00;

// ITV de matriculación. Importe medio nacional — varía según estación y
// localidad.
const REG_ITV_CENTS = 170_00;

// Servicios opcionales con valores comunicados por el cliente (orientativos
// — el coste real lo fija el profesional contratado).
const SERVICE_PREINSPECTION_CENTS = 350_00;
const SERVICE_FICHA_REDUCIDA_CENTS = 70_00;
const SERVICE_FULL_MANAGEMENT_CENTS = 1_500_00;

export type CalculatorInput = {
  // Bloque 1 · vehículo
  /** Tipo opcional. Se elimina del UI por petición del cliente; el motor
   * sigue aceptándolo internamente (default 'turismo') para que la
   * depreciación BOE pueda aplicar el suelo del 50% a clásicos cuando se
   * detecte por antigüedad. */
  vehicleType?: CalcVehicleType;
  /** "new" indica que el usuario eligió expresamente coche nuevo en el
   *  formulario. Lo usamos para forzar la línea de IVA 21% en el desglose
   *  aunque la antigüedad/km no encajen con la regla AEAT de "nuevo a
   *  efectos fiscales" (la regla legal sigue rigiendo el cálculo del
   *  IEDMT vía `isNewVehicle`). */
  vehicleCondition?: "new" | "used";
  make: string;
  model: string;
  purchasePriceEur: number;
  /** Base imponible del IEDMT introducida explícitamente por el usuario en
   *  el flujo coche usado fuera de BOE/BON. Cuando está presente, sustituye
   *  a `purchasePriceEur` solo para el cálculo del IEDMT — el desglose final
   *  sigue mostrando `purchasePriceEur` como "Precio del coche". */
  iedmtBaseEur?: number;
  /** Valor venal a nuevo del BOE 2026 — base para IEDMT con depreciación. */
  boeBaseValueEur?: number;
  /** Valor del BON Navarra 2026 para el mismo modelo. Se aplica como base
   *  ÚNICAMENTE cuando provinceIso = ES-NC (Navarra). */
  bonBaseValueEur?: number;
  /** Cilindrada en cc — solo se introduce en modo manual. */
  engineCc?: number;
  /** Factura ordinaria con IVA deducible (true) vs REBU (false). El engine
   * descuenta el IVA del bruto al calcular la base IEDMT cuando es true. */
  invoiceHasDeductibleVat?: boolean;
  /** % IVA del país del anuncio para sacar el neto (0.19 DE, 0.22 IT…). */
  vatRateOverride?: number;
  /** Neto explícito publicado por el portal (mobile.de Netto), si lo trae. */
  netPriceEur?: number;

  // Bloque 2 · matriculación e impuestos
  /** Potencia kW (la del coche en ficha técnica, no caballos fiscales). */
  powerKw: number;
  cvf: number;
  co2Bracket: CalcCo2Bracket;
  firstRegDate: string; // YYYY-MM-DD
  /** Kilómetros actuales (opcional) — usado para validar 6m/6000km. */
  kilometers?: number;
  /** Provincia donde se matriculará. ISO 3166-2 ES-XX. */
  provinceIso: string;
  buyerType: CalcBuyerType;
  sellerType: CalcSellerType;
  largeFamily: boolean;
  disability33: boolean;

  // Bloque 3 · transporte
  originCp: string;
  destinationCp: string;
  distanceKm: number;
  truckType: CalcTruckType;

  // Servicios opcionales
  preInspection: boolean;
  fichaReducida: boolean;
  fullManagement: boolean;
};

export type CalculatorResult = {
  input: CalculatorInput;
  totals: {
    grandTotalCents: number;
    upfrontCents: number; // todo lo que pagas para tener el coche en casa
    annualCents: number; // IVTM (recurrente)
  };
  breakdown: {
    purchaseCents: number;
    iedmt: {
      rate: number;
      bracketLabel: string;
      baseCents: number;
      depreciationFactor: number;
      ageYears: number;
      amountCents: number;
      /** Valor de mercado tras minoración (VM = precio_medio × % minoración).
       *  En modo manual coincide con el precio neto introducido. */
      vmCents: number;
      /** Tipo de IVA del año de 1ª matriculación, en tanto por uno (Art. 5
       *  regla 2ª Orden HAC/1501/2025). 0 si no aplica (modo manual / forales). */
      vatRate: number;
      /** Identifica qué fórmula se ha aplicado para que la UI pueda explicarla:
       *    - "boe":      VM / (1 + IVA + IEDMT) × IEDMT   (Art. 5 regla 2ª)
       *    - "manual":   precio_neto × IEDMT               (no listado en BOE)
       *    - "canarias": VM × tipo canario (régimen propio, IGIC ≠ IVA)
       *    - "foral":    no se calcula — régimen foral
       *    - "exempt":   exención total (Ceuta/Melilla, discapacidad) */
      formula: "boe" | "manual" | "canarias" | "foral" | "exempt";
      /** Origen del valor venal usado para VM: BOE estatal o BON Navarra.
       *  Solo es relevante cuando formula = "boe" o "canarias"; en "manual"
       *  no se usa porque la base es el precio de factura. */
      valueSource: "BOE" | "BON";
      /** Motivo de exención total (rate efectivo = 0): Ceuta/Melilla, discapacidad. */
      exemptionReason?: string;
      /** Motivo de bonificación parcial sobre el IEDMT (sin anularlo).
       *  Actualmente: familia numerosa (50%). */
      bonificationReason?: string;
    };
    /** ITP solo cuando comprador y vendedor son ambos particulares. */
    itp: {
      applies: boolean;
      rate: number;
      baseCents: number;
      amountCents: number;
      ccaaLabel: string;
      /** Motivo del tipo aplicado cuando hay regla especial (Cataluña >10
       *  años exento, Canarias >200 CV, etc). null en el caso general. */
      reason: string | null;
    };
    transport: {
      cents: number;
      distanceKm: number;
      modeLabel: string;
    };
    inspectionCents: number;
    fichaReducidaCents: number;
    fullManagementCents: number;
    /** Tasa DGT 1.1 (expedición permiso de circulación). */
    dgtFeesCents: number;
    /** Tasa matrículas verdes provisionales (DGT 4.5). */
    greenPlatesFeeCents: number;
    /** Coste físico de las placas verdes provisionales. */
    greenPlatesPhysicalCents: number;
    /** Coste físico de las placas definitivas. */
    finalPlatesCents: number;
    /** ITV de matriculación. */
    regItvCents: number;
    /** Primera anualidad del IVTM (incluida en el desembolso inicial). */
    ivtmAnnualCents: number;
    /** IVA 21% sobre el precio de factura para coches NUEVOS — informativo
     *  (el IVA ya va en el precio que paga el usuario, no se suma al total).
     *  0 cuando no aplica (usados, exenciones, foral, etc.). */
    invoiceVatCents: number;
  };
  /** Avisos textuales que la UI muestra al usuario (notas + disclaimers). */
  notes: string[];
  warnings: string[];
  /** CCAA donde se matriculará el vehículo (drives IEDMT/ITP). */
  region: { ccaa: CCAA; ccaaName: string } | null;
};

export function calculate(input: CalculatorInput): CalculatorResult {
  const notes: string[] = [];
  const warnings: string[] = [];
  const purchaseCents = Math.round(input.purchasePriceEur * 100);

  // El selector pide directamente CCAA. Aceptamos también códigos provinciales
  // por compatibilidad con cálculos guardados antes del rediseño del bloque 1.
  const ccaa = ccaaFromIso(input.provinceIso);

  // — Edad y depreciación —
  const ageYears = ageInYears(input.firstRegDate);
  const depFactor = depreciationFactor(ageYears, input.vehicleType ?? "turismo");

  // — IEDMT — Fórmula del Art. 5 regla 2ª de la Orden HAC/1501/2025:
  //   BI = VM / (1 + tipoIVA + tipoIEDMT)
  //   IEDMT = BI × tipoIEDMT
  // Donde VM = precio_medio_Anexo_I × % minoración del Anexo IV. Esta
  // fórmula descuenta del valor de mercado la imposición indirecta ya
  // soportada en el momento de la primera matriculación, evitando doble
  // imposición. Si el coche está listado en BOE usamos boeBaseValueEur
  // como precio medio. Si no (modo manual), Alejandro confirmó que se
  // aplica precio neto factura × tipoIEDMT directo, sin minoración.
  const bracket = CO2_BRACKETS.find((b) => b.id === input.co2Bracket) ?? CO2_BRACKETS[3];
  const isForal = ccaa != null && FORAL_CCAA.includes(ccaa);
  const isPaisVasco = ccaa === "ES-PV";
  const isCanarias = ccaa === "ES-CN";
  const isCeutaMelilla = ccaa === "ES-CE" || ccaa === "ES-ML";
  const isNavarra = ccaa === "ES-NC";

  // Selección de fuente del valor venal a nuevo: BON Navarra cuando se
  // matricula en Navarra (si tenemos el equivalente parseado para ese
  // modelo); en el resto de territorios, BOE estatal. País Vasco usa BOE
  // estatal con su propia fórmula simplificada (gestionada más abajo).
  const useBon = isNavarra && !!(input.bonBaseValueEur && input.bonBaseValueEur > 0);
  const tableBaseValueEur = useBon ? input.bonBaseValueEur! : input.boeBaseValueEur;
  const valueSource: "BOE" | "BON" = useBon ? "BON" : "BOE";
  const isBoeMode = !!(tableBaseValueEur && tableBaseValueEur > 0);

  // "Coche nuevo" a efectos fiscales (Art. 5 regla 2ª y normas AEAT): <6 meses
  // desde 1ª matriculación O <6.000 km. Para estos la fórmula del BOE
  // (depreciación + minorización + denominador) NO aplica — caemos a la
  // fórmula simplificada: precio de factura × tipo CO₂. Lo mismo para
  // coches usados que no aparecen en el BOE/BON Navarra.
  const isNewVehicle = !isIedmtCalcValid(ageYears, input.kilometers);
  const effectiveBoeMode = isBoeMode && !isNewVehicle;

  // VM = valor de mercado tras minoración. Solo en modo BOE-usado aplica
  // % depreciación del Anexo IV. En el resto de casos vmEur es el precio
  // que el usuario introduce. En el flujo "coche usado fuera de BOE/BON"
  // el usuario rellena un campo separado (`iedmtBaseEur`) que es la base
  // imponible del IEDMT — distinta del precio del coche que va al desglose.
  // Si `iedmtBaseEur` está presente lo usamos; si no, fallback al precio.
  const iedmtBaseFromInput =
    input.iedmtBaseEur != null && input.iedmtBaseEur > 0
      ? input.iedmtBaseEur
      : input.purchasePriceEur;
  const vmEur = effectiveBoeMode ? (tableBaseValueEur as number) * depFactor : iedmtBaseFromInput;
  const vmCents = Math.round(vmEur * 100);

  // Para la fórmula simplificada (precio × tipoCO₂), si la factura lleva
  // IVA deducible obtenemos la base imponible quitándole el IVA al bruto.
  // Tres caminos por fiabilidad:
  //   1. `netPriceEur` explícito (mobile.de lo trae en price.netAmount).
  //      Lo usamos directo — es exacto, sin asumir % de IVA.
  //   2. `vatRateOverride` (% del país: 0,19 DE, 0,22 IT, 0,2 FR…).
  //   3. Default 0,21 (España) si solo sabemos que es deducible.
  // En REBU no hay IVA repercutido, el precio bruto YA es la base.
  const simplifiedBaseCents = (() => {
    if (!input.invoiceHasDeductibleVat) return vmCents;
    if (input.netPriceEur != null && input.netPriceEur > 0) {
      return Math.round(input.netPriceEur * 100);
    }
    const rate = input.vatRateOverride ?? 0.21;
    return Math.round(vmCents / (1 + rate));
  })();

  const appliedIedmtRate = ccaa ? iedmtRateFor(ccaa, bracket.id) : bracket.rate;
  // En Canarias el IGIC sustituye al IVA en el denominador de la fórmula del
  // Art. 5 regla 2ª (confirmado por el cliente, may-2026). País Vasco usa el
  // BOE estatal pero NO descuenta imposición previa, así que vatRate=0. En
  // modo manual tampoco aplica porque el precio neto ya es valor actual.
  const vatRate =
    !effectiveBoeMode || isPaisVasco
      ? 0
      : isCanarias
        ? igicRateForRegDate(input.firstRegDate)
        : vatRateForRegDate(input.firstRegDate);

  let baseIedmtCents = 0;
  let iedmtCents = 0;
  let formula: "boe" | "manual" | "canarias" | "foral" | "exempt" = "boe";
  let exemptionReason: string | undefined;
  let bonificationReason: string | undefined;

  if (isForal) {
    formula = "foral";
    warnings.push(
      `El IEDMT en ${CCAA_NAMES[ccaa as CCAA]} se rige por normativa foral propia (Concierto / Convenio Económico). Esta calculadora no calcula el impuesto en territorios forales — consulta con un gestor o con la Hacienda Foral correspondiente.`,
    );
  } else if (isCeutaMelilla) {
    formula = "exempt";
    exemptionReason = `No se aplica IEDMT en ${ccaa === "ES-CE" ? "Ceuta" : "Melilla"}`;
  } else if (input.disability33) {
    formula = "exempt";
    exemptionReason = "Exención total por discapacidad ≥ 33% (art. 66.1.d Ley 38/1992)";
  } else if (isPaisVasco && effectiveBoeMode) {
    // País Vasco con coche usado en BOE: fórmula simplificada foral
    // (VM × tipoIEDMT) sin descontar imposición previa. Tramos estatales.
    formula = "boe";
    baseIedmtCents = vmCents;
    iedmtCents = Math.round(baseIedmtCents * appliedIedmtRate);
  } else if (isCanarias && effectiveBoeMode) {
    // Canarias con coche usado en BOE: fórmula del Art. 5 regla 2ª con
    // IGIC sustituyendo al IVA en el denominador.
    formula = "canarias";
    baseIedmtCents = Math.round(vmCents / (1 + vatRate + appliedIedmtRate));
    iedmtCents = Math.round(baseIedmtCents * appliedIedmtRate);
  } else if (effectiveBoeMode) {
    // Coche USADO presente en BOE/BON: fórmula oficial del Art. 5 regla 2ª.
    // BI = (VM × depreciación) / (1 + IVA + tipoIEDMT)
    baseIedmtCents = Math.round(vmCents / (1 + vatRate + appliedIedmtRate));
    iedmtCents = Math.round(baseIedmtCents * appliedIedmtRate);
    formula = "boe";
  } else {
    // Fórmula simplificada (coches nuevos < 6m/<6000km O usados NO listados
    // en BOE/BON): BI = precio factura (neto si IVA deducible) × tipoIEDMT.
    // Sin depreciación, sin minorización, sin denominador. Aplica a Canarias
    // y País Vasco también con sus tipos respectivos.
    formula = isCanarias ? "canarias" : "manual";
    baseIedmtCents = simplifiedBaseCents;
    iedmtCents = Math.round(baseIedmtCents * appliedIedmtRate);
  }

  if (input.largeFamily && iedmtCents > 0 && formula !== "exempt" && formula !== "foral") {
    // Art. 66.4 Ley 38/1992: reducción 50% sobre la base imponible.
    // Matemáticamente equivale a iedmtCents × 0,5 — lo aplico al importe final.
    baseIedmtCents = Math.round(baseIedmtCents * 0.5);
    iedmtCents = Math.round(iedmtCents * 0.5);
    bonificationReason = "Reducción del 50% por familia numerosa (art. 66.4 Ley 38/1992)";
  }

  // — Aviso fórmula simplificada —
  // Cuando no entra en BOE (coche nuevo, o usado no listado) usamos
  // precio factura × tipoCO₂. Avisamos en notas para que el usuario sepa
  // qué fórmula está alimentando el IEDMT y por qué.
  if (formula !== "foral" && formula !== "exempt" && !effectiveBoeMode) {
    if (isNewVehicle && isBoeMode) {
      notes.push(
        "Vehículo considerado nuevo (< 6 meses desde 1ª matriculación o < 6.000 km). " +
          "El IEDMT se calcula sobre el precio de la factura × tipo CO₂, sin aplicar " +
          "depreciación ni minorización del BOE.",
      );
    } else if (!isBoeMode) {
      notes.push(
        "Vehículo no localizado en la tabla del BOE/BON Navarra. El IEDMT se calcula " +
          "sobre el precio de la factura × tipo CO₂, sin depreciación ni minorización.",
      );
    }
    if (input.invoiceHasDeductibleVat) {
      notes.push(
        "Factura con IVA deducible: el 21% se descuenta del precio antes de aplicar el tipo CO₂.",
      );
    }
  }

  // — ITP (solo particular → particular) —
  // La base imponible es el mayor entre el precio de transmisión declarado y
  // el valor venal según BOE (Anexo I) con depreciación (Anexo IV). El tipo
  // depende de la CCAA + reglas especiales (CVF > 15, Canarias por antigüedad
  // y CV, exención Cataluña > 10 años). El motivo se muestra como subtítulo
  // de la fila ITP en el desglose, no como nota legal aparte.
  const itpApplies = input.buyerType === "particular" && input.sellerType === "particular";
  const cvFromKw = input.powerKw / 0.7355;
  const itpComputed =
    itpApplies && ccaa
      ? calculateItpRate({ ccaa, cvf: input.cvf, cv: cvFromKw, ageYears })
      : { rate: 0, reason: undefined };
  const itpBaseCents = itpApplies ? Math.max(purchaseCents, baseIedmtCents) : 0;
  const itpAmountCents = itpApplies ? Math.round(itpBaseCents * itpComputed.rate) : 0;
  const itpCcaaLabel = ccaa ? CCAA_NAMES[ccaa] : "—";

  // — Transporte —
  const transportCents = transportEstimateCents(input.distanceKm, input.truckType);

  // — Servicios opcionales —
  const inspectionCents = input.preInspection ? SERVICE_PREINSPECTION_CENTS : 0;
  const fichaReducidaCents = input.fichaReducida ? SERVICE_FICHA_REDUCIDA_CENTS : 0;
  const fullManagementCents = input.fullManagement ? SERVICE_FULL_MANAGEMENT_CENTS : 0;

  // — Tasas DGT y placas —
  const dgtFeesCents = DGT_FEES_CENTS;
  const greenPlatesFeeCents = GREEN_PLATES_FEE_CENTS;
  const greenPlatesPhysicalCents = GREEN_PLATES_PHYSICAL_CENTS;
  const finalPlatesCents = FINAL_PLATES_CENTS;
  const regItvCents = REG_ITV_CENTS;

  const ivtmAnnualValue = ivtmAnnualCents(input.cvf);

  // — IVA 21% para coches NUEVOS —
  // El usuario introduce el precio del coche SIN IVA. Sumamos el 21% como
  // partida independiente del desglose y la incluimos en el total a pagar
  // (precio neto × 0,21). Disparador = vehicleCondition === "new" del
  // formulario (decisión del usuario), no `isNewVehicle` (regla AEAT por
  // antigüedad/km) — pueden divergir cuando el usuario marca "nuevo" pero
  // los datos técnicos no encajan en la ventana de <6 meses o <6.000 km.
  // En usados, IVA no aplica como línea — va dentro del cálculo del IEDMT
  // cuando hay factura deducible.
  const isUserMarkedNew = input.vehicleCondition === "new";
  const invoiceVatCents = isUserMarkedNew ? Math.round(purchaseCents * 0.21) : 0;
  if (isUserMarkedNew && invoiceVatCents > 0) {
    notes.push(
      "Coche nuevo: añadimos el IVA al 21% sobre el precio que has introducido (precio neto). El importe se suma al total a pagar.",
    );
  }

  const upfrontCents =
    purchaseCents +
    invoiceVatCents +
    iedmtCents +
    itpAmountCents +
    transportCents +
    inspectionCents +
    fichaReducidaCents +
    fullManagementCents +
    dgtFeesCents +
    greenPlatesFeeCents +
    greenPlatesPhysicalCents +
    finalPlatesCents +
    regItvCents +
    ivtmAnnualValue;

  // — Disclaimers legales siempre presentes (los 3 que pidió el cliente) —
  notes.push(
    "El resultado del cálculo del impuesto de matriculación mostrado en esta calculadora no será válido para vehículos con menos de 6 meses desde su primera matriculación o con menos de 6.000 km, debiendo calcularse en estos casos en función del valor de compra reflejado en factura.",
  );
  notes.push(
    "Los costes de transporte, revisión pre-compra, ficha reducida y gestión integral de importación son estimaciones orientativas y podrán variar en función del profesional contratado y de otros factores, como fluctuaciones en el precio del combustible, demanda de servicios, disponibilidad o urgencia.",
  );
  notes.push(
    "Las empresas y trabajadores autónomos inscritos en el Registro de Operadores Intracomunitarios (ROI) y con NIF-IVA intracomunitario válido podrán beneficiarse, en determinados supuestos, de la facturación de servicios sin IVA mediante operación intracomunitaria, siempre que la operación se realice correctamente y se cumplan los requisitos fiscales aplicables, pudiendo resultar exenta de IVA en origen y aplicarse el mecanismo de inversión del sujeto pasivo, de conformidad con la Ley 37/1992, de 28 de diciembre, del Impuesto sobre el Valor Añadido, y las modificaciones introducidas por el Real Decreto-ley 7/2021, de 27 de abril, en vigor desde el 1 de julio de 2021.",
  );

  return {
    input,
    totals: {
      grandTotalCents: upfrontCents,
      upfrontCents,
      annualCents: ivtmAnnualValue,
    },
    breakdown: {
      purchaseCents,
      iedmt: {
        rate: appliedIedmtRate,
        bracketLabel: bracket.label,
        baseCents: baseIedmtCents,
        depreciationFactor: depFactor,
        ageYears: Number(ageYears.toFixed(2)),
        amountCents: iedmtCents,
        vmCents,
        vatRate,
        formula,
        valueSource,
        exemptionReason,
        bonificationReason,
      },
      itp: {
        applies: itpApplies,
        rate: itpComputed.rate,
        baseCents: itpBaseCents,
        amountCents: itpAmountCents,
        ccaaLabel: itpCcaaLabel,
        reason: itpComputed.reason ?? null,
      },
      transport: {
        cents: transportCents,
        distanceKm: input.distanceKm,
        modeLabel: TRUCK_LABELS[input.truckType],
      },
      inspectionCents,
      fichaReducidaCents,
      fullManagementCents,
      dgtFeesCents,
      greenPlatesFeeCents,
      greenPlatesPhysicalCents,
      finalPlatesCents,
      regItvCents,
      ivtmAnnualCents: ivtmAnnualValue,
      invoiceVatCents,
    },
    notes,
    warnings,
    region: ccaa ? { ccaa, ccaaName: CCAA_NAMES[ccaa] } : null,
  };
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
