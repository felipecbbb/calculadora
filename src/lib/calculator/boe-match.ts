import "server-only";

import { db } from "@/lib/db";

import type { AdData } from "./ad-extractor";
import { pickBoeMatchWithAi } from "./ai-enrich";

/**
 * Match BOE (o BON Navarra — misma tabla, BON 2026 idéntico al estatal):
 * cruza la AdData extraída del anuncio contra la tabla `BoeVehicle` y
 * devuelve la fila más probable con su nivel de confianza.
 *
 * Si la confianza es alta o media, el cliente puede usar el valor venal
 * del BOE para la fórmula del IEDMT (Art. 5 regla 2ª) en vez del precio
 * del anuncio. Si no hay match suficiente, el cliente cae en modo manual.
 */

export type BoeMatch = {
  id: string;
  model: string;
  variant: string | null;
  /** Caballos fiscales (IVTM). */
  cvf: number;
  /** Potencia BOE (CV). */
  cv: number;
  /** Valor venal nuevo (€). */
  baseValueEur: number;
  confidence: "high" | "medium" | "low";
  /** Score interno (debug — útil para tuning). */
  score: number;
};

const YEAR_NOW = new Date().getFullYear();

export async function findBoeMatch(ad: AdData): Promise<BoeMatch | null> {
  if (!ad.make || !ad.model) return null;

  const rows = await db.boeVehicle.findMany({
    where: { year: 2026, make: { equals: ad.make, mode: "insensitive" } },
    select: { id: true, model: true, variant: true, cvf: true, cv: true, baseValueEur: true },
  });
  if (rows.length === 0) return null;

  const adYear = ad.firstRegDate ? Number(ad.firstRegDate.slice(0, 4)) : null;
  const adModel = normalize(ad.model);
  const adVariant = ad.variant ? normalize(ad.variant) : "";
  const adCombined = `${adModel} ${adVariant}`.trim();

  const scored: Array<{ row: (typeof rows)[number]; score: number }> = [];

  for (const r of rows) {
    const parsed = parseVariant(r.variant ?? "");
    let score = 0;

    // ─ Match de modelo (clave) ─
    const rowModel = normalize(r.model);
    if (rowModel === adModel)
      score += 80; // exacto
    else if (rowModel.includes(adModel)) score += 50;
    else if (adModel.includes(rowModel)) score += 35;
    else if (adCombined && rowModel && tokensOverlap(adCombined, rowModel) >= 2) score += 20;
    else score -= 20;

    // ─ Filtrado/score por CV ─
    if (ad.cv != null && parsed.cv != null) {
      const diff = Math.abs(parsed.cv - ad.cv);
      if (diff === 0) score += 40;
      else if (diff <= 5) score += 30;
      else if (diff <= 20) score += 12;
      else if (diff > 40) score -= 40; // claramente otro motor
    } else if (ad.cv != null && Number(r.cv) > 0) {
      const diff = Math.abs(Number(r.cv) - ad.cv);
      if (diff === 0) score += 30;
      else if (diff <= 10) score += 15;
      else if (diff > 60) score -= 30;
    }

    // ─ Rango de años ─
    if (adYear != null && parsed.yearFrom != null) {
      const yearTo = parsed.yearTo ?? YEAR_NOW;
      if (adYear >= parsed.yearFrom && adYear <= yearTo) score += 35;
      else if (Math.abs(adYear - parsed.yearFrom) <= 1) score += 10;
      else score -= 25;
    }

    // ─ Combustible ─
    if (ad.fuelType && parsed.fuel) {
      if (fuelsMatch(ad.fuelType, parsed.fuel)) score += 20;
      else score -= 35;
    }

    scored.push({ row: r, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < 60) return null;

  // Desempate con IA: si hay varias filas con score parecido al máximo,
  // Claude ve marca/modelo/variante/CV/año/combustible del anuncio
  // junto con las candidatas y elige la correcta. Suele evitar el
  // típico fallo de coger la versión "CS"/"Competition" cuando el
  // anuncio era de la versión base.
  const close = scored.filter((s) => top.score - s.score <= 25).slice(0, 5);
  let chosen = top;
  let aiPicked = false;
  if (close.length >= 2) {
    const candidates = close.map((c) => ({
      model: c.row.model,
      variant: c.row.variant,
      cv: Number(c.row.cv),
    }));
    const pick = await pickBoeMatchWithAi(ad, candidates);
    const picked = pick ? close[pick.index] : undefined;
    if (picked) {
      chosen = picked;
      aiPicked = true;
    }
  }

  const confidence: BoeMatch["confidence"] =
    aiPicked || chosen.score >= 130 ? "high" : chosen.score >= 90 ? "medium" : "low";

  return {
    id: chosen.row.id,
    model: chosen.row.model,
    variant: chosen.row.variant,
    cvf: Number(chosen.row.cvf),
    cv: Number(chosen.row.cv),
    baseValueEur: chosen.row.baseValueEur,
    confidence,
    score: chosen.score,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

type VariantInfo = {
  yearFrom: number | null;
  yearTo: number | null;
  cv: number | null;
  fuel: string | null;
};

/**
 * Parsea variantes BOE típicas: "2019-2020/410cv/GASOLINA",
 * "2022-/530cv/GASOLINA", "2016-2021/450cv/ELECTRICO".
 */
export function parseVariant(s: string): VariantInfo {
  const out: VariantInfo = { yearFrom: null, yearTo: null, cv: null, fuel: null };
  if (!s) return out;
  const parts = s.split("/").map((p) => p.trim());
  for (const part of parts) {
    const yr = part.match(/^(\d{4})\s*-\s*(\d{4})?$/);
    if (yr && yr[1]) {
      out.yearFrom = Number(yr[1]);
      out.yearTo = yr[2] ? Number(yr[2]) : null;
      continue;
    }
    const cv = part.match(/^(\d+(?:[.,]\d+)?)\s*cv$/i);
    if (cv && cv[1]) {
      const n = Number(cv[1].replace(",", "."));
      if (Number.isFinite(n)) out.cv = n;
      continue;
    }
    if (/^[A-ZÁÉÍÓÚÜÑ]+$/.test(part)) {
      out.fuel = part.toUpperCase();
    }
  }
  return out;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter((t) => t.length > 1));
  const tb = new Set(b.split(" ").filter((t) => t.length > 1));
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n;
}

function fuelsMatch(adFuel: NonNullable<AdData["fuelType"]>, boeFuel: string): boolean {
  const f = boeFuel.toUpperCase();
  switch (adFuel) {
    case "gasolina":
      return /GASOLINA|HIBRIDO|HÍBRIDO/.test(f);
    case "diesel":
      return /DIESEL|DIÉSEL/.test(f);
    case "electrico":
      return /ELECTRIC|ELÉCTRIC/.test(f);
    case "hibrido":
      return /HIBRIDO|HÍBRIDO|GASOLINA|HEV|PHEV/.test(f);
    case "gas":
      return /GAS|GLP|LPG|GNC|CNG/.test(f);
    default:
      return false;
  }
}
