# Calculadora

Calculadora standalone de costes de importación y matriculación de vehículos en España.

- `/` — landing con dos enlaces.
- `/calculator` — calculadora completa (IEDMT por tramos CO₂ WLTP, IVTM, transporte, tasas).
- `/transporte` — solo coste de transporte entre dos ciudades.

## Setup

```bash
cp .env.example .env.local
# Rellenar las variables (Supabase + APIs externas)

npm install
npm run dev
```

## Datos

La calculadora lee la tabla `BoeVehicle` de Supabase (BOE estatal + BON Navarra 2026). No escribe nada — es solo lectura.

## Deploy

Vercel detecta Next.js automáticamente. Variables de entorno requeridas (ver `.env.example`):
- `DATABASE_URL`, `DIRECT_URL` (Supabase pooler)
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `HERE_API_KEY`
- `SCRAPINGBEE_API_KEY`
- `ANTHROPIC_API_KEY`
