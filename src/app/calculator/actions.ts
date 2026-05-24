"use server";

import { enrich, extractAd, type AdData } from "@/lib/calculator/ad-extractor";
import { findBoeMatch, type BoeMatch } from "@/lib/calculator/boe-match";
import { type CalculatorResult } from "@/lib/calculator/engine";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export type ExtractAdActionResult =
  | { ok: true; data: AdData; sourceHost: string; boeMatch: BoeMatch | null }
  | { ok: false; error: string };

export async function extractAdAction(url: unknown): Promise<ExtractAdActionResult> {
  // Rate limit primero — esta acción dispara ScrapingBee y Claude (ambos
  // pagados) y un atacante sin auth podría disparar la factura con un
  // script. 10 extracciones / minuto / IP cubre el caso real (un usuario
  // probando 3-5 anuncios distintos seguidos).
  const rl = await rateLimit("calc.extractAd");
  if (!rl.allowed) return { ok: false, error: rl.reason };
  if (typeof url !== "string" || url.trim().length === 0) {
    return { ok: false, error: "URL vacía" };
  }
  const res = await extractAd(url.trim());
  if (!res.ok) return { ok: false, error: res.reason };

  // Enriquecimiento (sellerType + CO₂ con IA si falta) y match BOE
  // corren EN PARALELO: enrich solo lee/modifica campos que el match
  // BOE no usa (sellerType, co2Gkm), así que no hay riesgo de
  // condición de carrera. Ahorra 2-5 s de espera para el usuario.
  const [enriched, boeMatch] = await Promise.all([
    enrich(res.data, res.html),
    findBoeMatch(res.data).catch(() => null),
  ]);

  return { ok: true, data: enriched, sourceHost: res.sourceHost, boeMatch };
}

export type SaveCalculationResult =
  | { ok: true; result: CalculatorResult; requestId: string }
  | { ok: false; needsAuth: true }
  | { ok: false; error: string };

// En el repo standalone NO hay auth, así que guardar no aplica. Devolvemos
// `needsAuth: true` para que el botón "Guardar" del form quede gris.
export async function saveCalculationAction(_input: unknown): Promise<SaveCalculationResult> {
  return { ok: false, needsAuth: true };
}

export async function deleteCalculationAction(_id: string): Promise<{ ok: boolean }> {
  return { ok: false };
}

/**
 * Lista de marcas disponibles en la tabla BOE/BON 2026.
 * Ordenadas alfabéticamente. Se llaman una sola vez al montar el formulario y
 * se cachean en memoria del cliente. El parámetro `source` permite consultar
 * el BOE estatal (Orden HAC/1501/2025) o el BON Navarra (Orden Foral 6/2026).
 */
export async function listBoeMakesAction(source: "BOE" | "BON" = "BOE"): Promise<string[]> {
  const rows = await db.boeVehicle
    .groupBy({
      by: ["make"],
      where: { year: 2026, source },
      orderBy: { make: "asc" },
    })
    .catch(() => [] as Array<{ make: string }>);
  return rows.map((r) => r.make);
}

export type BoeModel = {
  id: string;
  /** Nombre del modelo (campo `model` de la tabla). */
  label: string;
  /** Cadena descriptiva: variant + cv + fuel para distinguir versiones. */
  variant: string | null;
  cvf: number;
  cv: number;
  baseValueEur: number;
};

/**
 * Devuelve TODOS los modelos del BOE/BON 2026 para una marca dada.
 * Mercedes (5.294 filas) es el peor caso ≈ 800 KB en wire — aceptable
 * porque la respuesta se cachea en el cliente al cambiar de marca y el
 * Combobox filtra en local. Ordenados alfabéticamente para que el dropdown
 * muestre una lista navegable antes de teclear.
 */
export async function listBoeModelsAction(
  make: string,
  source: "BOE" | "BON" = "BOE",
): Promise<BoeModel[]> {
  if (!make || make.length < 2) return [];
  const rows = await db.boeVehicle
    .findMany({
      where: { year: 2026, source, make },
      select: {
        id: true,
        model: true,
        variant: true,
        cvf: true,
        cv: true,
        baseValueEur: true,
      },
      orderBy: [{ model: "asc" }, { baseValueEur: "desc" }],
    })
    .catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    label: r.model,
    variant: r.variant,
    cvf: Number(r.cvf),
    cv: Number(r.cv),
    baseValueEur: r.baseValueEur,
  }));
}

/**
 * Busca el equivalente en la tabla BON Navarra para un modelo elegido del BOE
 * estatal. El usuario elige primero marca/modelo en el BOE (bloque 1); cuando
 * en el bloque 2 selecciona Navarra como CCAA, intentamos resolver el mismo
 * modelo en el BON. Si lo encontramos, el engine usa el `baseValueEur` BON
 * (que puede divergir ~1,5% de los modelos respecto al BOE en 2026). Si no
 * lo encontramos, devolvemos `null` y la UI pide al usuario que vuelva a
 * elegir entre los modelos disponibles en el BON.
 *
 * Match: clave normalizada `(make, model, cv)` para tolerar diferencias
 * cosméticas en el nombre (espacios, paréntesis) entre fuentes.
 */
export async function findBonEquivalentAction(
  make: string,
  model: string,
  cv: number,
): Promise<BoeModel | null> {
  if (!make || !model || !cv) return null;
  // Normalización al estilo del cross-check ad-hoc (uppercase, sin paréntesis,
  // colapsando espacios, sin puntuación de separación).
  const normalize = (s: string) =>
    s
      .toUpperCase()
      .replace(/[()[\]/.,;:'"]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // Buscamos por marca exacta (case-insensitive) y filtramos en memoria por
  // model normalizado + cv. La marca está indexada, así que la consulta es
  // rápida (≤ 5.5k filas Mercedes worst case).
  const candidates = await db.boeVehicle
    .findMany({
      where: {
        year: 2026,
        source: "BON",
        make: { equals: make, mode: "insensitive" },
      },
      select: {
        id: true,
        model: true,
        variant: true,
        cvf: true,
        cv: true,
        baseValueEur: true,
      },
    })
    .catch(() => []);
  const target = normalize(model);
  const hit = candidates.find(
    (c) => normalize(c.model) === target && Math.round(Number(c.cv)) === Math.round(cv),
  );
  if (!hit) return null;
  return {
    id: hit.id,
    label: hit.model,
    variant: hit.variant,
    cvf: Number(hit.cvf),
    cv: Number(hit.cv),
    baseValueEur: hit.baseValueEur,
  };
}
