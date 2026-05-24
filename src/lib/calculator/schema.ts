import { z } from "zod";

import { BUYER_TYPES, CO2_BRACKETS, SELLER_TYPES, TRUCK_TYPES, VEHICLE_TYPES } from "./engine";

type Co2Id = (typeof CO2_BRACKETS)[number]["id"];
const CO2_IDS = CO2_BRACKETS.map((b) => b.id) as unknown as readonly [Co2Id, ...Co2Id[]];

export const calculatorSchema = z.object({
  // Bloque 1
  vehicleType: z.enum(VEHICLE_TYPES).default("turismo"),
  /** "new" = <6 meses o <6000 km. "used" = resto. El cálculo de coches
   *  nuevos está en standby — solo se admite "used" en la fórmula actual. */
  vehicleCondition: z.enum(["new", "used"]).default("used"),
  make: z.string().trim().min(1, "Selecciona la marca").max(80),
  model: z.string().trim().min(1, "Selecciona el modelo").max(160),
  purchasePriceEur: z
    .number({ invalid_type_error: "Indica el precio" })
    .min(500, "Precio demasiado bajo")
    .max(2_000_000, "Precio fuera de rango"),
  boeBaseValueEur: z.number().min(0).max(2_000_000).optional(),
  /** Valor del Anexo I del BON Navarra para el mismo modelo. Solo se rellena
   *  cuando el match BOE→BON existe; si la CCAA elegida es ES-NC, el engine
   *  usa ESTE valor (no el BOE) como VM antes de la depreciación. */
  bonBaseValueEur: z.number().min(0).max(2_000_000).optional(),
  /** Cilindrada en cc — necesaria al matricular un vehículo no listado en BOE. */
  engineCc: z.number().int().min(0).max(20_000).optional(),
  /** Nº de cilindros — usado junto a la cilindrada para calcular el CVF
   *  con la fórmula oficial cuando el vehículo no está en BOE. */
  cylinders: z.number().int().min(1).max(16).optional(),
  /** En modo manual: si la factura introducida lleva IVA deducible (factura
   * ordinaria con IVA repercutido) o no (REBU). */
  invoiceHasDeductibleVat: z.boolean().default(true),
  /** % IVA del país del anuncio (0.19 Alemania, 0.21 España, 0.22 Italia…).
   *  Solo se usa para sacar la base imponible del precio bruto cuando la
   *  factura es deducible y no tenemos el neto explícito. Default 0.21. */
  vatRateOverride: z.number().min(0).max(0.3).optional(),
  /** Valor neto explícito cuando el portal lo publica (mobile.de Netto). */
  netPriceEur: z.number().min(0).max(2_000_000).optional(),

  // Bloque 2
  powerKw: z.number({ invalid_type_error: "Indica la potencia en kW" }).min(0).max(2000),
  cvf: z.number({ invalid_type_error: "Indica los caballos fiscales" }).min(0).max(60),
  co2Bracket: z.enum(CO2_IDS),
  firstRegDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
  kilometers: z.number().min(0).max(2_000_000).optional(),
  provinceIso: z.string().regex(/^ES-[A-Z]{1,3}$/, "Provincia no válida"),
  buyerType: z.enum(BUYER_TYPES),
  sellerType: z.enum(SELLER_TYPES),
  largeFamily: z.boolean().default(false),
  disability33: z.boolean().default(false),

  // Bloque 3
  originCp: z.string().regex(/^\d{5}$/, "Código postal no válido (5 dígitos)"),
  destinationCp: z.string().regex(/^\d{5}$/, "Código postal no válido (5 dígitos)"),
  distanceKm: z.number().min(0).max(20_000),
  truckType: z.enum(TRUCK_TYPES),

  // Servicios
  preInspection: z.boolean().default(false),
  fichaReducida: z.boolean().default(false),
  fullManagement: z.boolean().default(false),
});

export type CalculatorFormValues = z.infer<typeof calculatorSchema>;
