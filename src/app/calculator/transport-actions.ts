"use server";

import { computeRoute, labelRouteVariants, type TransportRoute } from "@/lib/calculator/transport";
import { transportSchema } from "@/lib/calculator/transport-schema";
import { fetchHereRoutes } from "@/lib/here/routes";
import { rateLimit } from "@/lib/rate-limit";

export type TransportComputed = TransportRoute & { label: string };

export type TransportResult =
  | {
      ok: true;
      routes: TransportComputed[];
      extras: {
        flightsEur: number;
        groundTransportEur: number;
        lodgingEur: number;
        foodEur: number;
      };
    }
  | { ok: false; error: string };

export async function computeTransportAction(input: unknown): Promise<TransportResult> {
  // HERE Maps cobra por petición. Rate limit por IP para evitar abuso.
  const rl = await rateLimit("calc.transport");
  if (!rl.allowed) return { ok: false, error: rl.reason };

  const parsed = transportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Faltan datos: revisa origen, destino y consumo." };
  }
  const v = parsed.data;

  try {
    const here = await fetchHereRoutes({
      origin: { lat: v.originLat, lng: v.originLng },
      destination: { lat: v.destLat, lng: v.destLng },
      pref: v.roadPref,
      alternatives: 2,
    });
    if (here.length === 0) {
      return { ok: false, error: "HERE no encontró ninguna ruta entre esos puntos." };
    }
    const routes = here.map((h) =>
      computeRoute(h, v.fuelType, v.consumption, v.destCountry?.toUpperCase()),
    );
    const labels = labelRouteVariants(routes);
    const computed: TransportComputed[] = routes.map((r, i) => ({
      ...r,
      label: labels[i] ?? "Alternativa",
    }));
    return {
      ok: true,
      routes: computed,
      extras: {
        flightsEur: v.flightsEur,
        groundTransportEur: v.groundTransportEur,
        lodgingEur: v.lodgingEur,
        foodEur: v.foodEur,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado consultando HERE";
    return { ok: false, error: message };
  }
}
