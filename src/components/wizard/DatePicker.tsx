"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { FieldError, FieldHint, FieldLabel } from "./fields";

type IsoDate = string; // YYYY-MM-DD

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

function toIso(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromIso(s: IsoDate): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function buildMonthGrid(month: Date): Array<Date | null> {
  const first = startOfMonth(month);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  }
  while (cells.length < 42) cells.push(null);
  return cells;
}
function formatLong(d: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

export function DatePicker({
  label,
  hint,
  error,
  value,
  onChange,
  minDate,
  maxDate,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: { message?: string };
  value: IsoDate | undefined;
  onChange: (next: IsoDate | undefined) => void;
  minDate?: Date;
  maxDate?: Date;
}) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const minD = useMemo(() => (minDate ? startOfDay(minDate) : new Date(1900, 0, 1)), [minDate]);
  const maxD = useMemo(() => (maxDate ? startOfDay(maxDate) : today), [maxDate, today]);

  const [open, setOpen] = useState(false);
  const initialDate = fromIso(value ?? "") ?? maxD;
  const [monthRef, setMonthRef] = useState(() => startOfMonth(initialDate));
  const [pending, setPending] = useState<Date | undefined>(fromIso(value ?? ""));
  const wrapRef = useRef<HTMLDivElement>(null);
  // Foco automático al día actual (o al ya seleccionado) cuando se abre el
  // calendario, para que pulsar Enter lo confirme sin tocar el ratón.
  const focusDayRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => focusDayRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    if (open) {
      const v = fromIso(value ?? "");
      setPending(v);
      setMonthRef(startOfMonth(v ?? maxD));
    }
  }, [open, value, maxD]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = maxD.getFullYear(); y >= minD.getFullYear(); y--) list.push(y);
    return list;
  }, [minD, maxD]);

  function pickDay(d: Date) {
    // Clic o Enter sobre un día → seleccionar y cerrar de inmediato. Antes
    // requería una pulsación extra en "Seleccionar"; ahora el botón ya solo
    // existe como confirmación por si el usuario solo cambió de mes/año.
    setPending(d);
    onChange(toIso(d));
    setOpen(false);
  }
  function clear() {
    setPending(undefined);
    onChange(undefined);
    setOpen(false);
  }
  function setYear(y: number) {
    setMonthRef(new Date(y, monthRef.getMonth(), 1));
  }
  function setMonth(m: number) {
    setMonthRef(new Date(monthRef.getFullYear(), m, 1));
  }

  const triggerLabel = (() => {
    const v = fromIso(value ?? "");
    if (v) return formatLong(v);
    return "Selecciona fecha";
  })();

  const cells = useMemo(() => buildMonthGrid(monthRef), [monthRef]);

  return (
    <div ref={wrapRef} className="relative">
      {label && <FieldLabel>{label}</FieldLabel>}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={[
          "mt-1 flex w-full items-center gap-2 rounded-lg border bg-white px-3 py-2.5 text-left text-sm font-semibold transition-colors",
          error?.message
            ? "border-state-error focus:border-state-error focus:ring-2 focus:ring-state-error/30"
            : "border-border focus:border-brand-accent focus:outline-none focus:ring-2 focus:ring-brand-accent/30",
          value ? "text-brand-deep" : "text-text-muted",
        ].join(" ")}
      >
        <CalendarIcon />
        <span className="flex-1">{triggerLabel}</span>
        <span aria-hidden className="text-text-muted">
          ▾
        </span>
      </button>
      {error?.message ? <FieldError error={error} /> : hint ? <FieldHint>{hint}</FieldHint> : null}

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-border bg-white p-4 shadow-elevated">
          {/* Selector mes y año */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <select
              value={monthRef.getMonth()}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="h-9 rounded-lg border border-border bg-white px-2 text-sm font-semibold text-brand-deep focus:border-brand-accent focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
            >
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={monthRef.getFullYear()}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-9 rounded-lg border border-border bg-white px-2 text-sm font-semibold text-brand-deep focus:border-brand-accent focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Navegación de mes */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMonthRef(addMonths(monthRef, -1))}
              aria-label="Mes anterior"
              className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-bg-subtle hover:text-text"
            >
              ‹
            </button>
            <span className="text-sm font-bold text-brand-deep">
              {MONTH_NAMES[monthRef.getMonth()]} {monthRef.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setMonthRef(addMonths(monthRef, 1))}
              aria-label="Mes siguiente"
              className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-bg-subtle hover:text-text"
            >
              ›
            </button>
          </div>

          {/* Calendario */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-widest text-text-muted">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <span key={`empty-${i}`} />;
              const disabled = d < minD || d > maxD;
              const isSelected = pending && isSameDay(d, pending);
              const isToday = isSameDay(d, today);
              // Foco prioritario: día seleccionado > hoy. Solo enfocamos un
              // día por mes renderizado, así que si pending no cae en este
              // mes, se enfocará hoy (si está visible).
              const shouldFocus = isSelected || (!pending && isToday);
              return (
                <button
                  key={`d-${d.getTime()}`}
                  ref={shouldFocus ? focusDayRef : undefined}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickDay(d)}
                  className={[
                    "flex h-9 items-center justify-center rounded-full text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-brand-accent/40",
                    disabled
                      ? "cursor-not-allowed text-text-muted/40"
                      : isSelected
                        ? "bg-brand-accent font-bold text-white"
                        : isToday
                          ? "border border-brand-accent text-brand-deep hover:bg-brand-surface"
                          : "text-text hover:bg-bg-subtle",
                  ].join(" ")}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Acciones */}
          <div className="mt-4 flex items-center justify-end gap-3 border-t border-border pt-3">
            <button
              type="button"
              onClick={clear}
              className="text-sm font-semibold text-text-soft hover:text-state-error"
            >
              Borrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-4 w-4"} fill="none" aria-hidden>
      <rect x="4" y="6" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4 10h16 M9 4v4 M15 4v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
