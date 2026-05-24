import "server-only";

import { detectSellerTypeFromHtml, estimateCo2WithAi } from "./ai-enrich";
import { extractAdWithAi } from "./ai-extract";
import type { CalcCo2Bracket } from "./engine";

/**
 * Extrae los datos de un anuncio de coche a partir de la URL.
 *
 * Estrategia v1: solo JSON-LD (schema.org/Vehicle). Pasa fetch al servidor
 * con headers de navegador real, parsea todos los <script type="application/ld+json">
 * y busca el primero que tenga forma de vehículo. Cubre coches.net,
 * AutoScout24 y la mayoría de mobile.de sin coste adicional.
 *
 * Si algún portal devuelve 4xx/5xx (anti-bot) o no publica JSON-LD,
 * devolvemos `{ ok: false, reason }` y la UI le dice al usuario que
 * rellene a mano. No nos peleamos con Cloudflare ni captchas en v1.
 */

export type AdData = {
  make?: string;
  model?: string;
  /** Variante/acabado (p. ej. "Coupé Competition", "Avant 40 TDI quattro"). */
  variant?: string;
  /** Total EUR (gross, lo que aparece en el anuncio). */
  priceEur?: number;
  /**
   * Régimen del precio publicado:
   *   - `deductible_vat`: el anuncio publica IVA deducible. La base imponible
   *     del IEDMT se obtiene restando ese IVA al bruto (o usando el netAmount
   *     si el portal lo expone explícitamente).
   *   - `rebu`: operación con IVA del margen / régimen especial bienes usados
   *     — sin IVA repercutido al cliente, el precio es la base directa.
   *   - undefined: no detectado, el usuario lo elige.
   */
  invoiceRegime?: "deductible_vat" | "rebu";
  /** % IVA del país del anuncio (Alemania 19, Italia 22, España 21…). */
  vatRate?: number;
  /** Valor neto explícito cuando el portal lo publica (p.ej. mobile.de). */
  netPriceEur?: number;
  /** Caballos de vapor (CV). Los kW los recalcula la UI con × 0.7355. */
  cv?: number;
  /** Cilindrada en cc. */
  engineCc?: number;
  /** Emisiones CO₂ en g/km (WLTP idealmente, pero algunos anuncios mezclan NEDC). */
  co2Gkm?: number;
  /** Tramo CO₂ derivado del valor anterior — listo para meter en el form. */
  co2Bracket?: CalcCo2Bracket;
  /** Fecha de primera matriculación en formato ISO (YYYY-MM-DD). */
  firstRegDate?: string;
  /** Kilómetros del cuentakilómetros. */
  kilometers?: number;
  /** Tipo de combustible normalizado. */
  fuelType?: "gasolina" | "diesel" | "electrico" | "hibrido" | "gas";
  /** Vendedor: profesional (concesionario/compraventa) o particular. */
  sellerType?: "professional" | "particular";
  /** Tipo de vehículo (afecta el régimen y depreciación). */
  vehicleType?: "turismo" | "comercial";
};

export type ExtractAdResult =
  | { ok: true; data: AdData; sourceHost: string; html: string }
  | { ok: false; reason: string };

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
};

/**
 * Hosts permitidos. Lista cerrada: el server hace fetch a URLs externas y
 * sin allowlist sería un SSRF (un atacante apuntaría a 169.254.169.254 para
 * exfiltrar credenciales IAM, o a hosts internos de la VPC). Cualquier
 * portal nuevo se añade explícitamente aquí.
 */
const ALLOWED_PORTALS = [
  // mobile.de
  "mobile.de",
  "suchen.mobile.de",
  "home.mobile.de",
  // AutoScout24
  "autoscout24.de",
  "autoscout24.es",
  "autoscout24.it",
  "autoscout24.fr",
  "autoscout24.be",
  "autoscout24.nl",
  "autoscout24.pl",
  "autoscout24.com",
  // Otros portales contractuales
  "coches.net",
  "coches.com",
  "autocasion.com",
];

function isHostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_PORTALS.some((b) => h === b || h.endsWith(`.${b}`));
}

/**
 * Hosts con anti-bot conocido (devuelven 403 / "Access denied" a fetches
 * normales). Para estos saltamos directamente a ScrapingBee si está
 * configurada — ahorra una llamada que va a fallar seguro.
 */
const HOSTILE_HOSTS = [
  "mobile.de",
  "suchen.mobile.de",
  "home.mobile.de",
  "autoscout24.de",
  "autoscout24.es",
  "autoscout24.it",
];

function isHostile(host: string): boolean {
  const h = host.toLowerCase();
  return HOSTILE_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));
}

/**
 * Bloquea IP literales privadas y locales (RFC1918, link-local, loopback,
 * IPv4-mapped IPv6, metadata cloud). Defensa en profundidad: aunque el
 * allowlist de hosts ya evita SSRF directo, esto cubre el caso edge de un
 * portal nuevo que se autoredirija a un host interno o un atacante que
 * pase una IP en la URL.
 */
function isPrivateOrLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ""); // quitar brackets IPv6
  if (h === "localhost" || h === "::1" || h.endsWith(".localhost")) return true;
  // IPv4 directa
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o0 = parseInt(v4[1]!, 10);
    const o1 = parseInt(v4[2]!, 10);
    if (o0 === 10) return true; // 10.0.0.0/8
    if (o0 === 127) return true; // loopback
    if (o0 === 0) return true; // 0.0.0.0/8
    if (o0 === 169 && o1 === 254) return true; // link-local (incl. AWS/GCP metadata)
    if (o0 === 172 && o1 >= 16 && o1 <= 31) return true; // 172.16.0.0/12
    if (o0 === 192 && o1 === 168) return true; // 192.168.0.0/16
    if (o0 >= 224) return true; // multicast / reservado
    return false;
  }
  // IPv6: cualquier "fc00::/7" (unique local), "fe80::/10" (link-local), "::1"
  if (
    h.startsWith("fc") ||
    h.startsWith("fd") ||
    h.startsWith("fe8") ||
    h.startsWith("fe9") ||
    h.startsWith("fea") ||
    h.startsWith("feb")
  ) {
    return true;
  }
  return false;
}

/** Descarga la página a través de ScrapingBee (proxy + residential IPs). */
async function fetchViaScrapingBee(url: string, blockResources = true): Promise<Response> {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error("SCRAPINGBEE_API_KEY no configurada");
  const beeUrl = new URL("https://app.scrapingbee.com/api/v1");
  beeUrl.searchParams.set("api_key", apiKey);
  beeUrl.searchParams.set("url", url);
  // render_js=true es obligatorio para los hostile hosts: mobile.de protege
  // con Akamai Bot Manager y AutoScout24 con DataDome — ambos sirven un
  // "Access denied" de ~2 KB si no resuelves el challenge JS. Con
  // premium_proxy + render_js el coste es ~25 créditos por petición.
  beeUrl.searchParams.set("render_js", "true");
  beeUrl.searchParams.set("premium_proxy", "true");
  // block_resources=true descarta CSS/imágenes/fonts en el rendering —
  // los datos del coche viven en HTML+JS, no en CSS, así que reduce
  // ~30-40% el tiempo (de 8-12s a 5-8s típicos). Pero algunos challenges
  // de Akamai requieren cargar recursos para validar — si la primera
  // pasada falla por timeout, el caller reintenta con blockResources=false.
  if (blockResources) beeUrl.searchParams.set("block_resources", "true");
  return fetch(beeUrl.toString(), {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
}

/** True si el error es un timeout / abort (AbortError, "aborted", etc.). */
function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      err.name === "TimeoutError" ||
      err.name === "AbortError" ||
      msg.includes("timeout") ||
      msg.includes("aborted")
    );
  }
  return false;
}

export async function extractAd(url: string): Promise<ExtractAdResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "URL no válida" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, reason: "Solo se admiten URLs http(s)" };
  }
  // Defensa SSRF — bloqueamos primero IP literales privadas/locales y
  // después exigimos que el host esté en la allowlist de portales.
  if (isPrivateOrLocalHost(parsed.hostname)) {
    return { ok: false, reason: "URL no válida" };
  }
  if (!isHostAllowed(parsed.hostname)) {
    return {
      ok: false,
      reason:
        "Por seguridad sólo aceptamos anuncios de portales reconocidos (mobile.de, AutoScout24, coches.net, autocasion.com).",
    };
  }

  let html: string;
  const hasScrapingBee = !!process.env.SCRAPINGBEE_API_KEY;
  const hostile = isHostile(parsed.host);
  try {
    // Para hosts hostiles conocidos vamos directos a ScrapingBee (si lo
    // tenemos). Si no, intentamos fetch normal y caemos a ScrapingBee si
    // recibimos 403 (típico de DataDome/Cloudflare).
    let res: Response;
    if (hostile && hasScrapingBee) {
      try {
        res = await fetchViaScrapingBee(parsed.toString(), true);
      } catch (err) {
        // Algunos challenges Akamai requieren cargar CSS/imágenes para
        // validar — si el primer intento expiró, reintentamos sin
        // block_resources (más lento pero más fiable).
        if (isTimeoutError(err)) {
          res = await fetchViaScrapingBee(parsed.toString(), false);
        } else {
          throw err;
        }
      }
    } else {
      res = await fetch(parsed.toString(), {
        method: "GET",
        headers: BROWSER_HEADERS,
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok && res.status === 403 && hasScrapingBee) {
        res = await fetchViaScrapingBee(parsed.toString());
      }
    }
    if (!res.ok) {
      if (hostile && !hasScrapingBee) {
        return {
          ok: false,
          reason: `${parsed.host} bloquea importaciones automáticas (HTTP ${res.status}). Necesitas configurar SCRAPINGBEE_API_KEY para este portal, o rellena los datos a mano.`,
        };
      }
      return {
        ok: false,
        reason: `El portal devolvió ${res.status} (anti-bot o página no encontrada).`,
      };
    }
    html = await res.text();
  } catch (err) {
    if (isTimeoutError(err)) {
      return {
        ok: false,
        reason:
          "El portal tardó demasiado en responder. Vuelve a intentarlo o rellena los datos a mano.",
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `No se pudo descargar el anuncio: ${msg}` };
  }

  // 1) JSON-LD genérico (schema.org/Vehicle) — coches.net, AutoScout24, …
  //    Buscamos vehículos al nivel raíz o anidados en `Product → offers → itemOffered`
  //    (cómo lo publica AutoScout24).
  //    El enrich (sellerType + CO₂ con IA) lo hace el caller para poder
  //    paralelizarlo con el match BOE en el server action.
  const ldNodes = extractAllJsonLd(html);
  for (const node of ldNodes) {
    const ctx = findVehicleContext(node);
    if (ctx) {
      return { ok: true, data: vehicleContextToAdData(ctx), sourceHost: parsed.host, html };
    }
  }

  // 2) Parsers específicos por portal (cuando no publican JSON-LD del coche).
  if (parsed.host.endsWith("mobile.de")) {
    const mobile = parseMobileDe(html, parsed);
    if (mobile && Object.keys(mobile).length > 0) {
      return { ok: true, data: mobile, sourceHost: parsed.host, html };
    }
  }

  // 3) Último recurso: pasar el HTML a Claude para extracción inteligente.
  //    Solo se activa si ANTHROPIC_API_KEY está configurada. Cubre Wallapop
  //    y cualquier portal nuevo sin necesidad de escribir un parser.
  const hasAiKey = !!process.env.ANTHROPIC_API_KEY;
  if (hasAiKey) {
    const aiData = await extractAdWithAi(html, parsed.host);
    if (aiData && Object.keys(aiData).length > 0) {
      return { ok: true, data: aiData, sourceHost: parsed.host, html };
    }
  }

  return {
    ok: false,
    reason: !hasAiKey
      ? `${parsed.host} no publica datos estructurados y ANTHROPIC_API_KEY no está configurada en el servidor (añadirla en Vercel → Settings → Environment Variables y redesplegar). Mientras tanto, rellena a mano.`
      : ldNodes.length === 0
        ? "El anuncio no publica datos estructurados y la IA tampoco encontró información útil. Rellena a mano."
        : "No encuentro datos de coche en este anuncio (puede ser una página de listado, no un anuncio individual).",
  };
}

/**
 * Rellena huecos típicos cuando la extracción base no los cubre:
 *  - sellerType: detección por texto (keywords en HTML).
 *  - co2Gkm + co2Bracket: estimación con Claude a partir de marca/modelo/
 *    año/CV/cilindrada/combustible. Anuncios anteriores a 2018 muchas
 *    veces no publican CO₂ y sin él no podemos calcular el IEDMT.
 */
export async function enrich(data: AdData, html: string): Promise<AdData> {
  const enriched = { ...data };

  if (!enriched.sellerType) {
    const guess = detectSellerTypeFromHtml(html);
    if (guess) enriched.sellerType = guess;
  }

  // Si la extracción primaria no determinó el régimen IVA, miramos el HTML.
  // mobile.de ya lo trae en el state (price.netAmount/vatRate). AS24 muestra
  // un badge "1" + texto "MwSt. ausweisbar" / "IVA deducible".
  if (!enriched.invoiceRegime) {
    enriched.invoiceRegime = detectInvoiceRegimeFromHtml(html);
  }
  // Si es deducible y no tenemos vatRate, asumimos el del país (heurística
  // por TLD del anuncio cuando esté disponible).
  if (enriched.invoiceRegime === "deductible_vat" && enriched.vatRate == null) {
    enriched.vatRate = guessVatRateFromHtml(html) ?? 0.21;
  }

  if (enriched.co2Gkm == null || enriched.co2Bracket == null) {
    const est = await estimateCo2WithAi(enriched);
    if (est) {
      enriched.co2Gkm = est.co2Gkm;
      enriched.co2Bracket = est.co2Bracket;
    }
  }

  return enriched;
}

/** Heurística por texto del HTML para distinguir REBU vs IVA deducible. */
function detectInvoiceRegimeFromHtml(html: string): AdData["invoiceRegime"] {
  const visible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .toLowerCase();
  // Patrones que indican IVA deducible — los portales lo dicen claro
  // cuando aplica (sin ambigüedad).
  if (
    /\b(iva deducible|vat deductible|mwst\. ausweisbar|mwst\. ?ausgewiesen|netto[^a-z]|tva récupérable|imposta deducibile)\b/.test(
      visible,
    )
  ) {
    return "deductible_vat";
  }
  // REBU explícito (regimen especial bienes usados, diferencial, etc.)
  if (
    /\b(régimen rebu|regimen rebu|differenzbesteuert|differenzbesteuerung|margin scheme|margin vat|rebu)\b/.test(
      visible,
    )
  ) {
    return "rebu";
  }
  return undefined;
}

/** Adivina % IVA según pistas del HTML (texto "MwSt", país del dealer). */
function guessVatRateFromHtml(html: string): number | undefined {
  const m = html.match(/(\d{1,2}(?:[.,]\d)?)\s*%\s*(?:mwst|iva|tva|vat)/i);
  if (m && m[1]) {
    const n = Number(m[1].replace(",", "."));
    if (n >= 5 && n <= 27) return n / 100;
  }
  // Por TLD del propio anuncio si no hay número explícito.
  if (/\.de\//i.test(html)) return 0.19;
  if (/\.it\//i.test(html)) return 0.22;
  if (/\.fr\//i.test(html)) return 0.2;
  if (/\.es\//i.test(html)) return 0.21;
  if (/\.pt\//i.test(html)) return 0.23;
  return undefined;
}

/**
 * Parser específico de mobile.de. Sus páginas de detalle traen toda la info
 * en `window.__INITIAL_STATE__.search.vip.ads.{adId}.data.ad` con:
 *   - `make`, `model`, `subTitle` (variante)
 *   - `price.grossAmount` (entero EUR)
 *   - `attributes[]` con tags: mileage, cubicCapacity, power, envkv.co2Emissions,
 *     firstRegistration, fuel…
 */
function parseMobileDe(html: string, url: URL): AdData | null {
  const idx = html.indexOf("window.__INITIAL_STATE__");
  if (idx < 0) return null;
  const eq = html.indexOf("= {", idx);
  if (eq < 0) return null;

  // Balancear llaves respetando strings escapados — la regex simple no vale
  // porque el blob tiene >100 KB y contiene `{`/`}` dentro de strings.
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = eq + 2; i < html.length; i++) {
    const c = html[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;

  let state: JsonNode;
  try {
    state = JSON.parse(html.slice(eq + 2, end));
  } catch {
    return null;
  }

  // mobile.de admite dos formatos de URL:
  //   ?id=455223300                              (deep-link de la app)
  //   /auto-inserat/<slug>/455223300.html         (URL para compartir)
  const adId = url.searchParams.get("id") ?? url.pathname.match(/(\d{6,})\.html?$/i)?.[1];
  if (!adId) return null;
  const ad = pickPath(state, `search.vip.ads.${adId}.data.ad`);
  if (!ad || typeof ad !== "object") return null;
  const adObj = ad as JsonNode;

  const data: AdData = {};
  const make = readString(adObj, ["make", "makeKey"]);
  const model = readString(adObj, ["model", "modelKey"]);
  if (make) data.make = make;
  if (model) data.model = model;

  // El subTitle suele traer la variante completa (p. ej. "Coupé LiveProf HUD…").
  const subTitle = readString(adObj, ["subTitle"]);
  if (subTitle) data.variant = subTitle;

  // mobile.de: onCustomerBehalf=false significa que el concesionario es
  // propietario directo del coche (anuncio de profesional). Cuando es true
  // la venta es por cuenta de un cliente particular — caso ambiguo, no
  // forzamos sellerType para que el usuario lo confirme.
  const onBehalf = pickPath(adObj, "onCustomerBehalf");
  if (onBehalf === false) data.sellerType = "professional";

  const price = pickPath(adObj, "price.grossAmount");
  if (typeof price === "number") data.priceEur = price;
  else {
    const priceStr = pickPath(adObj, "price.gross");
    const n = parseGermanNumber(priceStr);
    if (n != null) data.priceEur = n;
  }

  // Régimen del precio: mobile.de incluye `price.netAmount` y `price.vatRate`
  // SOLO cuando el coche es IVA deducible. En REBU no aparecen — el precio
  // bruto es la base directa.
  const netAmount = pickPath(adObj, "price.netAmount");
  const vatRate = pickPath(adObj, "price.vatRate");
  if (typeof netAmount === "number" && netAmount > 0) {
    data.netPriceEur = netAmount;
    data.invoiceRegime = "deductible_vat";
    if (typeof vatRate === "number") data.vatRate = vatRate / 100;
  } else if (data.priceEur != null) {
    // Si tenemos precio pero sin netAmount, mobile.de lo está vendiendo
    // como REBU (precio único sin IVA repercutido).
    data.invoiceRegime = "rebu";
  }

  const attrs = adObj["attributes"];
  if (Array.isArray(attrs)) {
    const byTag = new Map<string, unknown>();
    for (const a of attrs) {
      if (a && typeof a === "object") {
        const aa = a as JsonNode;
        const tag = aa["tag"];
        if (typeof tag === "string") byTag.set(tag, aa["value"]);
      }
    }

    const mileage = parseGermanNumber(byTag.get("mileage"));
    if (mileage != null) data.kilometers = mileage;

    const cc = parseGermanNumber(byTag.get("cubicCapacity"));
    if (cc != null) data.engineCc = cc;

    // "353 kW (480 PS)" → 480 CV
    const power = byTag.get("power");
    if (typeof power === "string") {
      const ps = power.match(/(\d+)\s*PS/);
      const kw = power.match(/(\d+)\s*kW/);
      if (ps) data.cv = Number(ps[1]);
      else if (kw) data.cv = Math.round(Number(kw[1]) / 0.7355);
    }

    const co2 = parseGermanNumber(byTag.get("envkv.co2Emissions"));
    if (co2 != null) {
      data.co2Gkm = co2;
      data.co2Bracket = co2BracketFor(co2);
    }

    // "09/2024" → "2024-09-01"
    const reg = byTag.get("firstRegistration");
    if (typeof reg === "string") {
      const m = reg.match(/^(\d{1,2})\/(\d{4})$/);
      if (m && m[1] && m[2]) {
        data.firstRegDate = `${m[2]}-${m[1].padStart(2, "0")}-01`;
      }
    }

    const fuel = byTag.get("fuel");
    if (typeof fuel === "string") data.fuelType = normalizeFuel(fuel);
  }

  return data;
}

/** Parsea números en formato alemán: "22.000", "1.234,56", "2.993 cm³". */
function parseGermanNumber(s: unknown): number | undefined {
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s !== "string") return undefined;
  // Quitar puntos de miles, sustituir coma decimal por punto, extraer número.
  const cleaned = s.replace(/\./g, "").replace(",", ".");
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/** Extrae todos los nodos JSON-LD del HTML y los aplana (incluye @graph). */
function extractAllJsonLd(html: string): JsonNode[] {
  const out: JsonNode[] = [];
  const re = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      out.push(...flatten(JSON.parse(raw)));
    } catch {
      /* ignoramos JSON-LD malformado */
    }
  }
  return out;
}

type JsonNode = Record<string, unknown>;

function flatten(node: unknown): JsonNode[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (typeof node !== "object") return [];
  const obj = node as JsonNode;
  if ("@graph" in obj) return flatten(obj["@graph"]);
  return [obj];
}

function isVehicleNode(node: JsonNode): boolean {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (t) => typeof t === "string" && /\b(vehicle|car|motorvehicle|automobile)\b/i.test(t),
  );
}

type VehicleContext = {
  /** Nodo con los specs del coche (Vehicle/Car/MotorVehicle/Automobile). */
  vehicle: JsonNode;
  /** Nodo Offer asociado (donde está el precio). Opcional. */
  offers?: JsonNode;
  /** Brand del nodo padre (cuando el coche está envuelto en un Product). */
  brand?: JsonNode | string;
};

/**
 * Localiza el contexto del vehículo. Cubre dos formas comunes:
 *   - JSON-LD raíz es directamente Vehicle/Car (coches.net, mobile.de algunos).
 *   - JSON-LD raíz es Product con `offers.itemOffered` Car (AutoScout24).
 */
function findVehicleContext(node: JsonNode): VehicleContext | null {
  if (isVehicleNode(node)) return { vehicle: node };

  const offers = node["offers"];
  const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of offerList) {
    if (!o || typeof o !== "object") continue;
    const offerObj = o as JsonNode;
    const item = offerObj["itemOffered"];
    if (item && typeof item === "object" && isVehicleNode(item as JsonNode)) {
      return {
        vehicle: item as JsonNode,
        offers: offerObj,
        brand: (node["brand"] as JsonNode | string | undefined) ?? undefined,
      };
    }
  }
  return null;
}

function vehicleContextToAdData(ctx: VehicleContext): AdData {
  const node = ctx.vehicle;
  const data: AdData = {};

  // ─ Marca y modelo ─
  // El brand puede estar en el nodo vehículo o en el Product padre (AutoScout24).
  data.make =
    readString(node, ["brand.name", "brand", "manufacturer.name", "manufacturer"]) ??
    readBrandString(ctx.brand) ??
    undefined;
  data.model = readString(node, ["model", "vehicleModel.name", "vehicleModel"]);

  // ─ Precio: en offers (incluido el offers del contexto) ─
  const priceCents =
    readPrice(node) ?? (ctx.offers ? readPrice({ offers: ctx.offers }) : undefined);
  if (priceCents != null) data.priceEur = priceCents;

  // ─ Régimen IVA según schema.org ─
  // `priceSpecification.valueAddedTaxIncluded` = false → IVA deducible
  // (precio publicado NO incluye IVA, hay que aplicar el % aparte).
  // = true → precio incluye IVA o REBU. La heurística por texto en HTML
  // (en enrich()) detecta los REBU/deducible más fiable; aquí solo
  // recogemos lo que viene en el JSON-LD si existe.
  const vatIncluded = readBool(ctx.offers ?? node, [
    "priceSpecification.valueAddedTaxIncluded",
    "valueAddedTaxIncluded",
  ]);
  if (vatIncluded === false) {
    data.invoiceRegime = "deductible_vat";
  }

  const power = readPower(node);
  if (power != null) data.cv = power;

  const cc = readDisplacement(node);
  if (cc != null) data.engineCc = cc;

  const km = readNumber(node, ["mileageFromOdometer.value", "mileageFromOdometer"]);
  if (km != null) data.kilometers = Math.round(km);

  const co2 = readCo2(node);
  if (co2 != null) {
    data.co2Gkm = co2;
    data.co2Bracket = co2BracketFor(co2);
  }

  const date = readDate(node, [
    "dateVehicleFirstRegistered",
    "productionDate",
    "vehicleModelDate",
    "releaseDate",
  ]);
  if (date) data.firstRegDate = date;

  const fuel = readString(node, ["vehicleEngine.fuelType", "fuelType"]);
  if (fuel) data.fuelType = normalizeFuel(fuel);

  return data;
}

function readBrandString(brand: VehicleContext["brand"]): string | undefined {
  if (!brand) return undefined;
  if (typeof brand === "string") return brand.trim() || undefined;
  if (typeof brand === "object" && "name" in brand && typeof brand.name === "string") {
    return brand.name.trim() || undefined;
  }
  return undefined;
}

function pickPath(node: JsonNode, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, node);
}

function readBool(node: unknown, paths: string[]): boolean | undefined {
  if (!node || typeof node !== "object") return undefined;
  for (const p of paths) {
    const v = pickPath(node as JsonNode, p);
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (v.toLowerCase() === "true") return true;
      if (v.toLowerCase() === "false") return false;
    }
  }
  return undefined;
}

function readString(node: JsonNode, paths: string[]): string | undefined {
  for (const p of paths) {
    const v = pickPath(node, p);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function readNumber(node: JsonNode, paths: string[]): number | undefined {
  for (const p of paths) {
    const v = pickPath(node, p);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(
        v
          .replace(/[^\d.,-]/g, "")
          .replace(/\./g, "")
          .replace(",", "."),
      );
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function readDate(node: JsonNode, paths: string[]): string | undefined {
  for (const p of paths) {
    const v = pickPath(node, p);
    if (typeof v === "string") {
      // schema.org usa ISO 8601. Recortamos a YYYY-MM-DD.
      const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
      // Algunas listas usan solo YYYY → asumimos 1 enero.
      const yr = v.match(/^(\d{4})$/);
      if (yr) return `${yr[1]}-01-01`;
    }
  }
  return undefined;
}

/** Precio: schema.org usa offers.price (en moneda local) y offers.priceCurrency. */
function readPrice(node: JsonNode): number | undefined {
  const offers = node["offers"];
  const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of offerList) {
    if (!o || typeof o !== "object") continue;
    const oo = o as JsonNode;
    const price = readNumber(oo, ["price", "highPrice", "lowPrice"]);
    if (price == null) continue;
    const currency = readString(oo, ["priceCurrency"]) ?? "EUR";
    if (currency.toUpperCase() === "EUR") return price;
    // Fuera de EUR no convertimos en v1 — devolvemos el número y la UI
    // avisará. Mantenerlo sin conversión es honesto.
    return price;
  }
  return readNumber(node, ["price"]);
}

/** Potencia: schema.org usa vehicleEngine.enginePower con unitCode (HP/CV o KW). */
function readPower(node: JsonNode): number | undefined {
  const engine = node["vehicleEngine"];
  const engineList = Array.isArray(engine) ? engine : engine ? [engine] : [];
  for (const e of engineList) {
    if (!e || typeof e !== "object") continue;
    const ee = e as JsonNode;
    const epower = ee["enginePower"];
    const powerList = Array.isArray(epower) ? epower : epower ? [epower] : [];
    for (const p of powerList) {
      if (!p || typeof p !== "object") continue;
      const pp = p as JsonNode;
      const value = readNumber(pp, ["value"]);
      if (value == null) continue;
      const unit = (readString(pp, ["unitCode", "unitText"]) ?? "").toUpperCase();
      // UCUM: KWT = kilowatt, KWH y KW también vistos en la práctica.
      if (unit === "KWT" || unit === "KWH" || unit === "KW") {
        return Math.round(value / 0.7355);
      }
      // BHP / HP / PS / CV / sin unidad → tratamos como CV directamente
      // (1 BHP ≈ 1.014 CV — error <1.5% irrelevante para nuestro matching).
      return Math.round(value);
    }
  }
  return readNumber(node, ["enginePower.value", "enginePower"]);
}

/** Cilindrada: maneja vehicleEngine como array (AutoScout24) y unitCode (CMQ=cc, LTR=litros). */
function readDisplacement(node: JsonNode): number | undefined {
  const engine = node["vehicleEngine"];
  const engineList = Array.isArray(engine) ? engine : engine ? [engine] : [];
  for (const e of engineList) {
    if (!e || typeof e !== "object") continue;
    const ed = (e as JsonNode)["engineDisplacement"];
    if (!ed) continue;
    if (typeof ed === "number") return ed;
    if (typeof ed === "object") {
      const value = readNumber(ed as JsonNode, ["value"]);
      if (value == null) continue;
      const unit = (readString(ed as JsonNode, ["unitCode", "unitText"]) ?? "").toUpperCase();
      // LTR = litros → ×1000. CMQ/CM3 ó sin unidad → ya está en cc.
      if (unit === "LTR" || unit === "L") return Math.round(value * 1000);
      return Math.round(value);
    }
  }
  return readNumber(node, ["engineDisplacement.value", "engineDisplacement"]);
}

/** CO₂: schema.org no estandariza el campo. Probamos los comunes. */
function readCo2(node: JsonNode): number | undefined {
  return readNumber(node, [
    "vehicleEngine.co2Emissions",
    "vehicleEngine.emissionsCO2",
    "emissionsCO2",
    "co2Emissions",
    "co2EmissionValue",
  ]);
}

function co2BracketFor(co2Gkm: number): CalcCo2Bracket {
  if (co2Gkm < 120) return "lt120";
  if (co2Gkm < 160) return "120_159";
  if (co2Gkm < 200) return "160_199";
  return "gte200";
}

function normalizeFuel(s: string): AdData["fuelType"] {
  const v = s.toLowerCase();
  if (/diesel|gasoil|diésel|dièsel/.test(v)) return "diesel";
  if (/elect|bev|ev|electric/.test(v)) return "electrico";
  if (/hybrid|hibrid|phev|hev/.test(v)) return "hibrido";
  if (/lpg|cng|gas|glp/.test(v)) return "gas";
  if (/petrol|gasolin|benzin/.test(v)) return "gasolina";
  return undefined;
}
