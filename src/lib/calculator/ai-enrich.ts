import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { AdData } from "./ad-extractor";
import type { CalcCo2Bracket } from "./engine";

function co2BracketFor(co2Gkm: number): CalcCo2Bracket {
  if (co2Gkm < 120) return "lt120";
  if (co2Gkm < 160) return "120_159";
  if (co2Gkm < 200) return "160_199";
  return "gte200";
}

/**
 * Enriquecimiento con IA tras la extracción base.
 *
 * Casos típicos:
 * - Anuncios antiguos sin "envkv.co2Emissions" → estimamos CO₂ WLTP a partir
 *   de marca/modelo/año/CV/cilindrada/combustible (Claude tiene buenos
 *   datos hasta cutoff Ene 2026, cubre prácticamente cualquier coche
 *   comercializado).
 * - sellerType ausente → ya intentamos detectarlo por texto antes; este
 *   módulo se centra en CO₂.
 *
 * Coste por llamada: ~0,5–1¢ con Opus 4.7 + effort low (input <500 tokens,
 * output ~30 tokens). Solo se invoca cuando el dato falta — no añade
 * coste a anuncios con CO₂ ya presente.
 */

export async function estimateCo2WithAi(ad: AdData): Promise<{
  co2Gkm: number;
  co2Bracket: AdData["co2Bracket"];
} | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!ad.make || !ad.model) return null;

  const year = ad.firstRegDate ? Number(ad.firstRegDate.slice(0, 4)) : null;
  const facts: string[] = [`Marca: ${ad.make}`, `Modelo: ${ad.model}`];
  if (ad.variant) facts.push(`Versión: ${ad.variant}`);
  if (year) facts.push(`Año matriculación: ${year}`);
  if (ad.cv) facts.push(`Potencia: ${ad.cv} CV`);
  if (ad.engineCc) facts.push(`Cilindrada: ${ad.engineCc} cc`);
  if (ad.fuelType) facts.push(`Combustible: ${ad.fuelType}`);

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 256,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              co2Gkm: { type: ["number", "null"] as const },
              confidence: { type: "string" as const },
            },
            required: ["co2Gkm", "confidence"],
          },
        },
      },
      system: [
        {
          type: "text",
          text: `Devuelves emisiones CO₂ WLTP (g/km) SOLO cuando conoces el valor oficial
exacto publicado por el fabricante para esa versión y año concretos (datos de homologación
WLTP). Si el coche es 100% eléctrico (BEV) devuelves 0 g/km. En CUALQUIER otro caso
de duda devuelves null.

PROHIBIDO:
- Estimar a partir de coches similares.
- Extrapolar de generaciones anteriores o posteriores.
- Inventar valores cuando no recuerdas la cifra exacta.
- Promediar valores de versiones distintas.

Es preferible que devuelvas null y el usuario lo rellene a mano que devolver una cifra
inventada. Una cifra incorrecta lleva a un cálculo de impuesto erróneo.

- "confidence": "high" SOLO si conoces el valor exacto de la homologación WLTP de esa
  versión concreta; en cualquier otro caso devuelve null.`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: facts.join("\n") }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const parsed = JSON.parse(textBlock.text) as { co2Gkm: number | null; confidence: string };
    if (parsed.co2Gkm == null) return null;
    if (!Number.isFinite(parsed.co2Gkm) || parsed.co2Gkm < 0 || parsed.co2Gkm > 600) return null;
    // Filtro estricto: solo confiamos en respuestas "high" (valor oficial
    // WLTP conocido para esa versión concreta). Cualquier otra confianza
    // se descarta para no devolver al usuario una cifra inventada.
    if (parsed.confidence !== "high") return null;
    return {
      co2Gkm: Math.round(parsed.co2Gkm),
      co2Bracket: co2BracketFor(parsed.co2Gkm),
    };
  } catch (err) {
    console.error("[ai-enrich] CO2 estimation failed:", err);
    return null;
  }
}

/**
 * Desempata entre N candidatos del BOE cuando el scoring por código deja
 * varias filas con puntuación parecida (típicamente entre variantes M
 * estándar vs CS, o entre años distintos del mismo motor).
 *
 * Le pasamos a Claude el anuncio completo + las filas candidatas en JSON
 * compacto y le pedimos que devuelva el índice de la mejor. Coste muy
 * bajo (~0,3¢) porque el prompt es corto y output es 1 número.
 */
export async function pickBoeMatchWithAi<
  T extends { model: string; variant: string | null; cv: number },
>(ad: AdData, candidates: T[]): Promise<{ index: number; reason: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || candidates.length === 0) return null;

  const adSummary: string[] = [`Marca: ${ad.make ?? "?"}`, `Modelo: ${ad.model ?? "?"}`];
  if (ad.variant) adSummary.push(`Versión: ${ad.variant}`);
  if (ad.cv) adSummary.push(`Potencia: ${ad.cv} CV`);
  if (ad.engineCc) adSummary.push(`Cilindrada: ${ad.engineCc} cc`);
  if (ad.fuelType) adSummary.push(`Combustible: ${ad.fuelType}`);
  if (ad.firstRegDate) adSummary.push(`1ª matriculación: ${ad.firstRegDate}`);

  const rows = candidates
    .map((c, i) => `${i}: ${c.model} | ${c.variant ?? "—"} | ${c.cv} CV`)
    .join("\n");

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 256,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              index: { type: "integer" as const },
              reason: { type: "string" as const },
            },
            required: ["index", "reason"],
          },
        },
      },
      system: [
        {
          type: "text",
          text: `Eres un experto en la tabla del BOE de precios medios de vehículos.
Recibes los datos de un anuncio y una lista numerada de filas candidatas del BOE.
Devuelves el índice de la fila que MEJOR encaja con el coche del anuncio.

Reglas:
- Prioriza coincidencia exacta de modelo y versión (p.ej. "M2 Coupé" ≠ "M2 CS Coupé").
- La potencia (CV) debe ser igual o muy similar (±5 CV).
- El año del anuncio debe caer dentro del rango de la variante (ej. "2022-/530cv" cubre 2022 en adelante).
- Si dudas entre dos casi idénticas, prefiere la más BÁSICA (sin "CS", "Competition", "Performance"
  añadido) cuando el anuncio no menciona explícitamente esa versión especial.

ABSTENCIÓN: si ninguna candidata encaja claramente con los datos del anuncio (por ejemplo,
diferencias grandes de CV, año fuera de rango en todas, modelo distinto), devuelve index = -1
y explica en "reason" qué falla. NO elijas una candidata "a ojo" si no hay match claro —
el sistema dejará al usuario revisar a mano.

- "reason": una frase corta explicando por qué (o por qué te abstienes).`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `ANUNCIO:\n${adSummary.join("\n")}\n\nCANDIDATAS BOE:\n${rows}\n\nDevuelve el índice de la mejor.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const parsed = JSON.parse(textBlock.text) as { index: number; reason: string };
    if (!Number.isInteger(parsed.index)) return null;
    // -1 = abstención explícita. El caller cae al ganador del scoring heurístico.
    if (parsed.index < 0 || parsed.index >= candidates.length) return null;
    return { index: parsed.index, reason: parsed.reason };
  } catch (err) {
    console.error("[ai-enrich] BOE disambiguation failed:", err);
    return null;
  }
}

/**
 * Detecta tipo de vendedor (profesional/particular) por keywords del HTML.
 * Cubre los tres idiomas principales y los términos exactos que usan
 * mobile.de, AutoScout24, coches.net, Wallapop.
 */
export function detectSellerTypeFromHtml(html: string): AdData["sellerType"] | undefined {
  // Sólo escaneamos el HTML "visible" — quitamos scripts/styles para no
  // matchear código JS que mencione "Händler" o similar.
  const visible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .toLowerCase();

  // Particular tiene prioridad porque "Privatanbieter" en una página de
  // dealer aparecería como término rechazado/comparativo, mientras que
  // "Händler" en página de particular es muy raro.
  if (
    /\b(privatanbieter|vendeur particulier|particular|private seller|privatkauf)\b/.test(visible)
  ) {
    return "particular";
  }
  if (
    /\b(händler|haendler|gewerblicher anbieter|concesionario|profesional|dealer|professional)\b/.test(
      visible,
    )
  ) {
    return "professional";
  }
  return undefined;
}
