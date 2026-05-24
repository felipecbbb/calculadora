import { CalculatorForm } from "./CalculatorForm";

export const metadata = {
  title: "Calculadora de matriculación",
  description:
    "Calcula al detalle el coste total de importar un coche desde Europa: precio sin IVA, transporte, IEDMT por tramos de CO₂ WLTP, ficha reducida, gestoría e IVTM anual.",
  robots: { index: false, follow: false },
};

export default function CalculatorPage() {
  return (
    <main className="min-h-screen bg-bg">
      <section className="border-b border-border bg-bg-subtle py-10">
        <div className="mx-auto max-w-5xl px-4">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-brand-accent">
            Calculadora
          </span>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-brand-deep md:text-4xl">
            ¿Cuánto te costará realmente importar tu coche?
          </h1>
          <p className="mt-3 max-w-2xl text-text-soft">
            Calcula partida a partida: precio sin IVA, transporte, impuesto de matriculación, ficha
            reducida y gestión integral. Datos oficiales del BOE 2026 con depreciación BOE.
          </p>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="mx-auto max-w-5xl px-4">
          <CalculatorForm isAuthenticated={false} />
        </div>
      </section>

      <section className="border-t border-border bg-bg-subtle py-12">
        <div className="mx-auto max-w-3xl px-4 text-sm text-text-soft">
          <h2 className="font-display text-xl font-extrabold tracking-tight text-brand-deep">
            Cómo se calcula
          </h2>
          <ul className="mt-4 grid gap-3">
            <li>
              <strong className="text-brand-deep">IEDMT (impuesto de matriculación):</strong> 0% si
              CO₂ &lt; 120 g/km, 4,75% (120–159), 9,75% (160–199) o 14,75% (≥ 200) — Ley 38/1992
              modificada por Ley 34/2007. Base imponible: valor venal con depreciación oficial del
              BOE 2026 aplicada al precio de compra. Exención automática en Canarias, Ceuta y
              Melilla, y bonificación del 50% para familias numerosas.
            </li>
            <li>
              <strong className="text-brand-deep">Transporte:</strong> estimación según modalidad y
              distancia entre los códigos postales de origen y entrega.
            </li>
            <li>
              <strong className="text-brand-deep">IVTM:</strong> impuesto anual orientativo según
              caballos fiscales (CVF) y tramos del art. 95 TRLRHL.
            </li>
          </ul>
          <p className="mt-6 text-xs text-text-muted">
            La calculadora no presta asesoramiento fiscal.
          </p>
        </div>
      </section>
    </main>
  );
}
