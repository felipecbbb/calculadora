import { TransportCalculator } from "../calculator/TransportCalculator";

export const metadata = {
  title: "Calculadora de transporte",
  description: "Estima el coste de mover un coche entre dos ciudades.",
  robots: { index: false, follow: false },
};

export default function TransporteStandalonePage() {
  return (
    <main className="min-h-screen bg-bg">
      <section className="border-b border-border bg-bg-subtle py-10">
        <div className="mx-auto max-w-5xl px-4">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-brand-accent">
            Calculadora
          </span>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-brand-deep md:text-4xl">
            Coste de transporte
          </h1>
          <p className="mt-3 max-w-2xl text-text-soft">
            Estima el coste de mover un coche entre dos ciudades — combustible, peajes y viáticos.
          </p>
        </div>
      </section>
      <section className="py-12">
        <div className="mx-auto max-w-5xl px-4">
          <TransportCalculator />
        </div>
      </section>
    </main>
  );
}
