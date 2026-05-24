import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { AdData } from "./ad-extractor";
import type { CalcCo2Bracket } from "./engine";

/**
 * Fallback con IA: cuando JSON-LD y los parsers por portal no consiguen
 * sacar los datos, mandamos el HTML limpio a Claude Opus 4.7 con
 * structured outputs (json_schema) — devuelve JSON estricto sin extra.
 *
 * Coste aproximado: 1-3¢ por anuncio (entrada ≈ 15k tokens cacheados +
 * salida ≈ 200 tokens). El prompt de sistema se cachea con TTL de 5 min
 * para que ráfagas de extracciones consecutivas casi no paguen input.
 */

const SYSTEM_PROMPT = `Eres un extractor de datos de anuncios de coches usados. Recibes el HTML
limpio de la página de un anuncio (coches.net, AutoScout24, mobile.de, Wallapop, etc.)
en cualquier idioma (es/en/de/fr/it) y devuelves los datos del coche en JSON
estructurado.

PROHIBIDO INVENTAR. Devuelve null para todo campo que no aparezca EXPLÍCITAMENTE en
el HTML del anuncio. Esto es CRÍTICO: el formulario alimenta el cálculo de un impuesto
oficial — una cifra inventada da un cálculo erróneo. Preferimos null y que el usuario
lo rellene a mano que cualquier estimación.

No infieras valores de marca/modelo si la página solo menciona la marca en el menú de
navegación o en un enlace de "ver otros coches similares" — debe aparecer como dato del
anuncio en sí.

Reglas:
- Devuelve únicamente lo que aparezca explícitamente en el HTML. Si un campo
  no se ve o tienes dudas, usa null. No inventes ni estimes ni completes con
  conocimiento general.
- "make": marca, en mayúscula inicial (BMW, Audi, Mercedes-Benz, Volkswagen…).
- "model": modelo base, lo más corto posible que aún sea identificable
  (p. ej. "M2", "A4", "Clase C", "Golf"). Sin acabado ni motor.
- "variant": acabado/versión completa visible en el título o subtítulo
  (p. ej. "Competition Coupé G87", "Avant 40 TDI quattro S line",
  "320d xDrive Touring"). Útil para emparejar con la tabla del BOE.
- "priceEur" SIEMPRE en euros. Si el anuncio está en otra moneda, devuelve null.
- "cv" en caballos de vapor (PS, HP, CV). Si solo dan kW, conviértelo: CV = round(kW / 0.7355).
- "engineCc" en cm³ (centímetros cúbicos). Ignora "1.4 TDI" si solo hay marca comercial.
- "co2Gkm" en g/km (WLTP de preferencia).
- "kilometers" cuentakilómetros total.
- "firstRegDate" en formato ISO YYYY-MM-DD. Si solo aparece "MM/YYYY" usa día 01.
  Si solo aparece "YYYY" usa "YYYY-01-01".
- "fuelType" normalizado: "gasolina" (Benzin/Petrol), "diesel" (Diesel/Gasoil),
  "electrico" (Electric/BEV), "hibrido" (Hybrid/PHEV/HEV), "gas" (LPG/GLP/CNG).
- "sellerType": "professional" si es concesionario, compraventa, dealer,
  Händler, Profesional. "particular" si es venta entre particulares
  (Privatanbieter, Privat, Particular). null si no queda claro.
- "vehicleType": "comercial" si es furgoneta, van, vehículo industrial.
  "turismo" para coches normales (incluye SUV, coupé, sedan, familiar). null si no aplica.`;

/** Schema JSON estricto que Claude debe respetar. */
const AD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    make: { type: ["string", "null"] as const },
    model: { type: ["string", "null"] as const },
    variant: { type: ["string", "null"] as const },
    priceEur: { type: ["number", "null"] as const },
    cv: { type: ["number", "null"] as const },
    engineCc: { type: ["number", "null"] as const },
    co2Gkm: { type: ["number", "null"] as const },
    kilometers: { type: ["number", "null"] as const },
    firstRegDate: { type: ["string", "null"] as const },
    // El enum no se combina bien con type nullable en json_schema strict;
    // confiamos en el system prompt para normalizar los valores admitidos.
    fuelType: { type: ["string", "null"] as const },
    sellerType: { type: ["string", "null"] as const },
    vehicleType: { type: ["string", "null"] as const },
  },
  required: [
    "make",
    "model",
    "variant",
    "priceEur",
    "cv",
    "engineCc",
    "co2Gkm",
    "kilometers",
    "firstRegDate",
    "fuelType",
    "sellerType",
    "vehicleType",
  ],
};

/** Tipo del JSON que esperamos del modelo. */
type AiResult = {
  make: string | null;
  model: string | null;
  variant: string | null;
  priceEur: number | null;
  cv: number | null;
  engineCc: number | null;
  co2Gkm: number | null;
  kilometers: number | null;
  firstRegDate: string | null;
  fuelType: "gasolina" | "diesel" | "electrico" | "hibrido" | "gas" | null;
  sellerType: "professional" | "particular" | null;
  vehicleType: "turismo" | "comercial" | null;
};

export async function extractAdWithAi(html: string, sourceHost: string): Promise<AdData | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const cleaned = cleanHtml(html);
  if (cleaned.length < 200) return null; // No hay nada útil

  const client = new Anthropic({ apiKey });

  let result: AiResult;
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: AD_SCHEMA },
      },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Portal: ${sourceHost}\n\nHTML del anuncio (limpio):\n\n${cleaned}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    result = JSON.parse(textBlock.text) as AiResult;
  } catch (err) {
    console.error("[ai-extract] Claude call failed:", err);
    return null;
  }

  return aiResultToAdData(result);
}

/** Mapea el resultado del modelo a AdData (calcula el tramo CO₂ aquí, no la IA). */
function aiResultToAdData(r: AiResult): AdData {
  const data: AdData = {};
  if (r.make) data.make = r.make;
  if (r.model) data.model = r.model;
  if (r.variant) data.variant = r.variant;
  if (r.priceEur != null) data.priceEur = r.priceEur;
  if (r.cv != null) data.cv = r.cv;
  if (r.engineCc != null) data.engineCc = r.engineCc;
  if (r.kilometers != null) data.kilometers = Math.round(r.kilometers);
  if (r.co2Gkm != null) {
    data.co2Gkm = r.co2Gkm;
    data.co2Bracket = co2BracketFor(r.co2Gkm);
  }
  if (r.firstRegDate && /^\d{4}-\d{2}-\d{2}$/.test(r.firstRegDate)) {
    data.firstRegDate = r.firstRegDate;
  }
  if (r.fuelType) data.fuelType = r.fuelType;
  if (r.sellerType) data.sellerType = r.sellerType;
  if (r.vehicleType) data.vehicleType = r.vehicleType;
  return data;
}

function co2BracketFor(co2Gkm: number): CalcCo2Bracket {
  if (co2Gkm < 120) return "lt120";
  if (co2Gkm < 160) return "120_159";
  if (co2Gkm < 200) return "160_199";
  return "gte200";
}

/**
 * Quita lo que no aporta información (scripts/styles/svg/comentarios), colapsa
 * espacios y trunca a un tamaño razonable. ≈ 15-20k tokens en el peor caso —
 * dentro del presupuesto del prompt cacheado.
 */
function cleanHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60_000);
}
