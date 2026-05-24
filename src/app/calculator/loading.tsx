export default function CalculatorLoading() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-subtle">
      <header className="border-b border-border bg-white">
        <div className="container-page flex h-16 items-center" />
      </header>
      <div className="container-page flex-1 py-10">
        <div className="h-8 w-64 animate-pulse rounded bg-bg-muted" />
        <div className="mt-2 h-3 w-96 animate-pulse rounded bg-bg-muted" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr,1.05fr]">
          <div className="grid gap-4">
            {[180, 320, 240, 200].map((h, i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl bg-bg-muted"
                style={{ height: `${h}px` }}
              />
            ))}
          </div>
          <div className="h-[420px] animate-pulse rounded-2xl bg-bg-muted" />
        </div>
      </div>
    </main>
  );
}
