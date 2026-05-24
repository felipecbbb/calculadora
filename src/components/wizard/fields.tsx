"use client";

import type { FieldError } from "react-hook-form";

const inputClass =
  "w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-brand-deep placeholder:text-text-muted focus:border-brand-accent focus:outline-none focus:ring-2 focus:ring-brand-accent/30 [color-scheme:light]";

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-xs font-bold uppercase tracking-widest text-text-muted">
      {children}
    </span>
  );
}

export function FieldError({ error }: { error?: FieldError | { message?: string } | null }) {
  if (!error?.message) return null;
  return <span className="mt-1 block text-xs text-state-error">{error.message}</span>;
}

export function FieldHint({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-xs text-text-muted">{children}</span>;
}

export function TextField({
  label,
  error,
  hint,
  className,
  type = "text",
  leadingIcon,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: FieldError | { message?: string };
  hint?: React.ReactNode;
  leadingIcon?: React.ReactNode;
}) {
  const isDateLike = type === "date" || type === "month" || type === "datetime-local";
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        {leadingIcon && (
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            aria-hidden
          >
            {leadingIcon}
          </span>
        )}
        <input
          type={type}
          className={[
            inputClass,
            isDateLike
              ? "[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
              : "",
            leadingIcon ? "pl-10" : "",
            error ? "border-state-error focus:ring-state-error/30" : "",
            className ?? "",
          ].join(" ")}
          {...props}
        />
      </div>
      {error ? <FieldError error={error} /> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </label>
  );
}

export function TextareaField({
  label,
  error,
  hint,
  rows = 4,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: FieldError | { message?: string };
  hint?: React.ReactNode;
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <textarea
        rows={rows}
        className={[
          inputClass,
          "min-h-[6rem]",
          error ? "border-state-error focus:ring-state-error/30" : "",
          className ?? "",
        ].join(" ")}
        {...props}
      />
      {error ? <FieldError error={error} /> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </label>
  );
}

export function SelectField({
  label,
  error,
  hint,
  options,
  placeholder,
  className,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label: string;
  error?: FieldError | { message?: string };
  hint?: React.ReactNode;
  options: ReadonlyArray<readonly [string, string]>;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <select
        className={[
          inputClass,
          error ? "border-state-error focus:ring-state-error/30" : "",
          className ?? "",
        ].join(" ")}
        {...props}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map(([value, optionLabel]) => (
          <option key={value} value={value}>
            {optionLabel}
          </option>
        ))}
      </select>
      {error ? <FieldError error={error} /> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </label>
  );
}

export function RadioCardGroup<T extends string>({
  name,
  label,
  value,
  onChange,
  options,
  error,
}: {
  name: string;
  label: string;
  value: T | undefined;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; title: string; description?: string }>;
  error?: FieldError | { message?: string };
}) {
  return (
    <fieldset>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((opt) => {
          const checked = value === opt.value;
          return (
            <label
              key={opt.value}
              className={[
                "relative flex cursor-pointer flex-col rounded-xl border bg-white p-4 transition-colors",
                checked
                  ? "border-brand-accent ring-2 ring-brand-accent/30"
                  : "border-border hover:border-brand-soft",
              ].join(" ")}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={checked}
                onChange={() => onChange(opt.value)}
                className="sr-only"
              />
              <span className="text-sm font-bold text-brand-deep">{opt.title}</span>
              {opt.description && (
                <span className="mt-1 text-xs text-text-soft">{opt.description}</span>
              )}
            </label>
          );
        })}
      </div>
      <FieldError error={error} />
    </fieldset>
  );
}

export function CheckboxField({
  label,
  hint,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: React.ReactNode;
  error?: FieldError | { message?: string };
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 flex-none rounded border-border text-brand-accent focus:ring-brand-accent/40"
        {...props}
      />
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-brand-deep">{label}</span>
        {error ? (
          <FieldError error={error} />
        ) : hint ? (
          <span className="mt-0.5 text-xs text-text-soft">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}
