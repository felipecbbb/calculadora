"use client";

import dynamic from "next/dynamic";

import type { RouteMapProps } from "./RouteMapInner";

const RouteMapInner = dynamic(() => import("./RouteMapInner"), {
  ssr: false,
  loading: () => (
    <div
      className="grid h-[400px] place-items-center rounded-2xl border border-border bg-bg-subtle text-sm text-text-muted"
      aria-hidden
    >
      Cargando mapa…
    </div>
  ),
});

export function RouteMap(props: RouteMapProps) {
  return <RouteMapInner {...props} />;
}
