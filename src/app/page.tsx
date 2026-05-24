import Link from "next/link";

export const metadata = {
  robots: { index: false, follow: false },
};

export default function HomePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg-subtle p-6">
      <div className="grid max-w-md gap-6 text-center">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand-deep md:text-3xl">
          Calculadoras
        </h1>
        <p className="text-sm text-text-soft">Elige qué quieres calcular.</p>
        <div className="grid gap-3">
          <Link
            href="/calculator"
            className="rounded-2xl border border-border bg-white p-5 text-left shadow-soft transition-shadow hover:shadow-card"
          >
            <strong className="block text-brand-deep">Importación + matriculación</strong>
            <span className="mt-1 block text-xs text-text-soft">
              Precio del coche, IEDMT por tramos de CO₂, ficha reducida, IVTM y desglose.
            </span>
          </Link>
          <Link
            href="/transporte"
            className="rounded-2xl border border-border bg-white p-5 text-left shadow-soft transition-shadow hover:shadow-card"
          >
            <strong className="block text-brand-deep">Solo transporte</strong>
            <span className="mt-1 block text-xs text-text-soft">
              Coste de mover un coche entre dos ciudades (combustible, peajes, viáticos).
            </span>
          </Link>
        </div>
      </div>
    </main>
  );
}
