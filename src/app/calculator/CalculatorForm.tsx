"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { forwardRef, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { PlacesAutocomplete } from "@/components/PlacesAutocomplete";
import { DatePicker } from "@/components/wizard/DatePicker";
import type { RoutePlace } from "@/lib/google-maps";
import type { AdData } from "@/lib/calculator/ad-extractor";
import type { BoeMatch } from "@/lib/calculator/boe-match";
import {
  CO2_BRACKETS,
  TRUCK_LABELS,
  TRUCK_TYPES,
  calcCvfFromEngine,
  calculate,
  formatCents,
  type CalculatorResult,
} from "@/lib/calculator/engine";
import {
  CCAA_OPTIONS,
  estimateRoadDistanceKm,
  nearestProvince,
  roadDistanceFromCoordsKm,
} from "@/lib/calculator/provinces";
import { calculatorSchema, type CalculatorFormValues } from "@/lib/calculator/schema";

import {
  extractAdAction,
  findBonEquivalentAction,
  listBoeMakesAction,
  listBoeModelsAction,
  saveCalculationAction,
  type BoeModel,
} from "./actions";

const inputClass =
  "w-full rounded-xl border border-border bg-white px-4 py-3 text-sm font-semibold text-brand-deep placeholder:text-text-muted focus:border-brand-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-accent/20";
const labelClass = "block text-[11px] font-extrabold uppercase tracking-[0.18em] text-brand-deep";

const DEFAULT_VALUES: CalculatorFormValues = {
  vehicleType: "turismo",
  vehicleCondition: "used",
  make: "",
  model: "",
  purchasePriceEur: 0,
  engineCc: undefined,
  cylinders: undefined,
  invoiceHasDeductibleVat: true,
  powerKw: 0,
  cvf: 0,
  co2Bracket: "" as CalculatorFormValues["co2Bracket"],
  firstRegDate: "",
  kilometers: undefined,
  provinceIso: "",
  buyerType: "" as CalculatorFormValues["buyerType"],
  sellerType: "" as CalculatorFormValues["sellerType"],
  largeFamily: false,
  disability33: false,
  originCp: "",
  destinationCp: "",
  distanceKm: 0,
  truckType: "trailer",
  preInspection: false,
  fichaReducida: false,
  fullManagement: false,
};

const PENDING_KEY = "carrevol.pendingCalc";
const DRAFT_KEY = "carrevol.calcDraft";

const STEP_TITLES = ["Vehículo", "Matriculación", "Transporte", "Servicios adicionales"] as const;

export function CalculatorForm({ isAuthenticated }: { isAuthenticated: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<BoeModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  // BON Navarra: cuando el usuario elige Navarra como CCAA, resolvemos el
  // modelo equivalente en el BON. Si lo encontramos, se setea
  // `values.bonBaseValueEur` silenciosamente. Si NO, marcamos `bonNotFound`
  // y la UI pide al usuario que vuelva a elegir entre los modelos del BON.
  const [bonResolving, setBonResolving] = useState(false);
  const [bonNotFound, setBonNotFound] = useState(false);
  const [bonMakes, setBonMakes] = useState<string[]>([]);
  const [bonModels, setBonModels] = useState<BoeModel[]>([]);
  const [bonLoadingModels, setBonLoadingModels] = useState(false);
  const [bonMakeChoice, setBonMakeChoice] = useState("");
  // Modal IVA deducible/REBU para el campo "Precio del coche" en flujo de
  // coche NUEVO (compartido con InvoiceVatToggle de usados no-BOE).
  const [priceHelpOpen, setPriceHelpOpen] = useState(false);
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(null);

  // ─── Importar anuncio (JSON-LD) ───
  const [adUrl, setAdUrl] = useState("");
  const [adPending, startAdTransition] = useTransition();
  const [adError, setAdError] = useState<string | null>(null);
  const [adSuccess, setAdSuccess] = useState<string | null>(null);
  // Resultado completo de la última importación — alimenta el panel de
  // resumen de datos extraídos que renderizamos bajo el botón Importar.
  type AdImported = { data: AdData; sourceHost: string; boeMatch: BoeMatch | null };
  const [adImported, setAdImported] = useState<AdImported | null>(null);

  // ─── Modo de entrada del bloque 1 ───
  // null = el usuario aún no ha elegido; "link" = importar de anuncio;
  // "manual" = rellenar marca/modelo a mano (BOE search o texto libre).
  // Se persiste en localStorage junto al borrador.
  type EntryMode = "link" | "manual" | null;
  const [entryMode, setEntryMode] = useState<EntryMode>(null);

  // ─── Estado conversacional ───
  // Solo trackeamos el bloque más alto desbloqueado. Una vez desbloqueado,
  // el bloque permanece abierto siempre — el usuario puede ver toda la
  // información rellenada sin tener que reabrirlo. Los bloques aún no
  // alcanzados se muestran con título atenuado en gris.
  const [unlockedStep, setUnlockedStep] = useState<1 | 2 | 3 | 4>(1);
  // El desglose NO se muestra hasta que el usuario pulse "Calcular mis
  // gastos" en el bloque 4. Una vez visible, sigue reaccionando a los
  // cambios del formulario en vivo.
  const [showResult, setShowResult] = useState(false);

  const ref1 = useRef<HTMLDivElement>(null);
  const ref2 = useRef<HTMLDivElement>(null);
  const ref3 = useRef<HTMLDivElement>(null);
  const ref4 = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => [null, ref1, ref2, ref3, ref4] as const, []);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<CalculatorFormValues>({
    resolver: zodResolver(calculatorSchema),
    defaultValues: DEFAULT_VALUES,
    mode: "onChange",
  });

  const values = useWatch({ control });

  const liveResult: CalculatorResult | null = useMemo(() => {
    const parsed = calculatorSchema.safeParse(values);
    if (!parsed.success) return null;
    return calculate(parsed.data);
  }, [values]);

  useEffect(() => {
    listBoeMakesAction()
      .then(setMakes)
      .catch(() => setMakes([]));
  }, []);

  // Bloquea el comportamiento por defecto del navegador en inputs numéricos:
  // si el cursor está sobre un input[type=number] enfocado y el usuario hace
  // scroll, el valor sube/baja sin querer. Cancelamos ese wheel para todos
  // los inputs numéricos del form de una vez.
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement &&
        target.type === "number" &&
        document.activeElement === target
      ) {
        e.preventDefault();
      }
    }
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  // ─── Persistencia del borrador en localStorage ───
  // Restaurar al montar (si hay) y guardar a medida que el usuario
  // teclea (debounced). Si el usuario sale y vuelve, conserva todo lo
  // rellenado: form values, paso desbloqueado, modo manual y coords.
  const draftHydratedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        values?: Partial<CalculatorFormValues>;
        unlockedStep?: 1 | 2 | 3 | 4;
        customMode?: boolean;
        originCoords?: { lat: number; lng: number } | null;
        destCoords?: { lat: number; lng: number } | null;
        entryMode?: EntryMode;
      };
      // Limpiar campos obsoletos / no reconocidos: si el schema actual del
      // form cambió desde la última vez que el usuario guardó el borrador,
      // un setValue con clave inexistente lanza warning de RHF y desordena
      // el form. Solo aplicamos las claves que siguen en DEFAULT_VALUES.
      if (parsed.values && typeof parsed.values === "object") {
        const validKeys = Object.keys(DEFAULT_VALUES) as Array<keyof CalculatorFormValues>;
        const sanitized: Partial<CalculatorFormValues> = {};
        for (const k of validKeys) {
          if (k in parsed.values) {
            (sanitized as Record<string, unknown>)[k] = (parsed.values as Record<string, unknown>)[
              k
            ];
          }
        }
        reset({ ...DEFAULT_VALUES, ...sanitized });
      }
      if (parsed.unlockedStep && [1, 2, 3, 4].includes(parsed.unlockedStep)) {
        setUnlockedStep(parsed.unlockedStep);
      }
      if (parsed.customMode === true) setCustomMode(true);
      if (parsed.entryMode === "link" || parsed.entryMode === "manual") {
        setEntryMode(parsed.entryMode);
      }
      if (
        parsed.originCoords &&
        typeof parsed.originCoords === "object" &&
        Number.isFinite(parsed.originCoords.lat) &&
        Number.isFinite(parsed.originCoords.lng)
      ) {
        setOriginCoords(parsed.originCoords);
      }
      if (
        parsed.destCoords &&
        typeof parsed.destCoords === "object" &&
        Number.isFinite(parsed.destCoords.lat) &&
        Number.isFinite(parsed.destCoords.lng)
      ) {
        setDestCoords(parsed.destCoords);
      }
    } catch {
      // Borrador corrupto: lo limpiamos para no quedar atascados leyendo
      // basura una y otra vez en cada visita.
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* localStorage bloqueado */
      }
    } finally {
      draftHydratedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            values,
            unlockedStep,
            customMode,
            originCoords,
            destCoords,
            entryMode,
          }),
        );
      } catch {
        /* localStorage lleno o bloqueado: silencio */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [values, unlockedStep, customMode, originCoords, destCoords, entryMode]);

  const originCp = values.originCp;
  const destinationCp = values.destinationCp;
  useEffect(() => {
    if (originCoords && destCoords) {
      const km = roadDistanceFromCoordsKm(originCoords, destCoords);
      setValue("distanceKm", km, { shouldValidate: true });
      return;
    }
    if (!originCp || !destinationCp) return;
    if (!/^\d{5}$/.test(originCp) || !/^\d{5}$/.test(destinationCp)) return;
    const km = estimateRoadDistanceKm(originCp, destinationCp);
    if (km != null) setValue("distanceKm", km, { shouldValidate: true });
  }, [originCp, destinationCp, originCoords, destCoords, setValue]);

  // ─── Auto-cálculo de CVF en modo manual ───
  // Cuando el coche NO está en BOE, el CVF se deriva de cilindrada + nº de
  // cilindros con la fórmula oficial. En modo BOE el CVF viene de onPickModel
  // y respetamos ese valor (es el dato oficial publicado por Hacienda).
  const engineCcVal = values.engineCc;
  const cylindersVal = values.cylinders;
  useEffect(() => {
    if (!customMode) return;
    const cvf = calcCvfFromEngine(engineCcVal ?? 0, cylindersVal ?? 0);
    if (cvf > 0) {
      setValue("cvf", cvf, { shouldValidate: true });
    }
  }, [customMode, engineCcVal, cylindersVal, setValue]);

  // ─── Propagación del precio como base imponible directa (modo manual) ───
  // En modo manual + IVA deducible, el campo "Precio" YA es la base sin IVA
  // (el usuario mete el precio menor del anuncio de 2 precios, o el único
  // si es REBU). Lo replicamos en netPriceEur para que el engine lo use
  // como base directa y no lo divida por 1,21.
  const priceVal = values.purchasePriceEur;
  const hasDeductibleVat = values.invoiceHasDeductibleVat;
  useEffect(() => {
    if (!customMode) return;
    if (priceVal != null && priceVal > 0) {
      setValue("netPriceEur", priceVal, { shouldValidate: true });
    }
  }, [customMode, priceVal, hasDeductibleVat, setValue]);

  // ─── BON Navarra ───
  // Cuando el usuario elige ES-NC (Navarra) en bloque 2 y tiene marca/modelo
  // del BOE estatal, resolvemos el equivalente en el BON. La fuente que
  // Hacienda Foral aplica al matricular en Navarra es el BON, no el BOE
  // estatal — y aunque ~96,5% de los modelos coinciden, ~1,5% diverge en
  // precio. Si encontramos match → silencioso, set `bonBaseValueEur`. Si NO
  // → set `bonNotFound = true` y la UI muestra un selector limitado al BON
  // para que el usuario re-elija marca/modelo con la tabla foral.
  const provinceIsoVal = values.provinceIso;
  const makeForBon = values.make;
  const modelForBon = values.model;
  const powerKwForBon = values.powerKw;
  const boeBaseForBon = values.boeBaseValueEur;
  useEffect(() => {
    if (provinceIsoVal !== "ES-NC") {
      // Salimos de Navarra → limpiamos cualquier resolución BON previa.
      if (values.bonBaseValueEur != null) {
        setValue("bonBaseValueEur", undefined, { shouldValidate: true });
      }
      setBonNotFound(false);
      return;
    }
    // En Navarra. Solo intentamos resolver si tenemos modelo BOE seleccionado
    // (modo manual / customMode no aplica — ahí la base es la factura).
    if (!makeForBon || !modelForBon || !boeBaseForBon || boeBaseForBon <= 0) return;
    let cancelled = false;
    setBonResolving(true);
    const cv = Math.round((powerKwForBon || 0) / 0.7355);
    findBonEquivalentAction(makeForBon, modelForBon, cv)
      .then((bon) => {
        if (cancelled) return;
        if (bon) {
          setValue("bonBaseValueEur", bon.baseValueEur, { shouldValidate: true });
          setBonNotFound(false);
        } else {
          setValue("bonBaseValueEur", undefined, { shouldValidate: true });
          setBonNotFound(true);
        }
      })
      .catch(() => {
        if (!cancelled) setBonNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setBonResolving(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provinceIsoVal, makeForBon, modelForBon, boeBaseForBon, powerKwForBon]);

  // ─── BON Navarra: selector de re-pick cuando el modelo no está ───
  // Solo activo cuando `bonNotFound = true`. Cargamos marcas y modelos del
  // BON desde el server. La lista de marcas se carga una vez; la de modelos
  // depende del make elegido por el usuario.
  useEffect(() => {
    if (!bonNotFound || bonMakes.length > 0) return;
    listBoeMakesAction("BON")
      .then(setBonMakes)
      .catch(() => undefined);
  }, [bonNotFound, bonMakes.length]);
  useEffect(() => {
    if (!bonMakeChoice) {
      setBonModels([]);
      return;
    }
    setBonLoadingModels(true);
    listBoeModelsAction(bonMakeChoice, "BON")
      .then(setBonModels)
      .catch(() => setBonModels([]))
      .finally(() => setBonLoadingModels(false));
  }, [bonMakeChoice]);

  // ─── Coche nuevo → flujo siempre manual ───
  // Para coches nuevos no aplica BOE (Hacienda calcula sobre la factura).
  // Forzamos customMode = true y entryMode = "manual" para que el usuario
  // meta marca/modelo/precio a mano y aparezcan los campos técnicos.
  // Comprador particular + vendedor profesional (única combinación válida
  // para una primera matriculación con factura ordinaria).
  //
  // Importante: cuando el usuario vuelve a "used" tras haber estado en "new",
  // RESETEAMOS customMode y entryMode para que pueda volver al carril BOE
  // (en vez de quedarse atrapado en modo manual). Usamos un ref para
  // detectar la transición new→used sólo cuando viene de new (no en el
  // mount inicial donde vehicleCondition arranca en "used").
  const prevVehicleCondition = useRef<string | undefined>(values.vehicleCondition);
  useEffect(() => {
    const prev = prevVehicleCondition.current;
    const curr = values.vehicleCondition;
    prevVehicleCondition.current = curr;

    if (curr === "new") {
      setCustomMode(true);
      setEntryMode("manual");
      setValue("buyerType", "particular", { shouldValidate: true });
      setValue("sellerType", "professional", { shouldValidate: true });
      // El precio de un coche nuevo es la factura con IVA — el engine no debe
      // restar IVA de nuevo cuando aplica la fórmula simplificada.
      setValue("invoiceHasDeductibleVat", false, { shouldValidate: true });
      return;
    }

    // Llegamos aquí solo si curr !== "new" (el return de arriba ya filtró).
    if ((prev as string | undefined) === "new") {
      // Transición new → used: limpia el modo "manual forzado" para que el
      // usuario vuelva a ver la elección BOE vs manual.
      setCustomMode(false);
      setEntryMode(null);
      setValue("make", "", { shouldValidate: true });
      setValue("model", "", { shouldValidate: true });
      setValue("boeBaseValueEur", undefined, { shouldValidate: true });
      setValue("bonBaseValueEur", undefined, { shouldValidate: true });
      setBonNotFound(false);
    }
  }, [values.vehicleCondition, setValue]);

  const make = values.make;
  useEffect(() => {
    if (!make) {
      setModels([]);
      return;
    }
    setLoadingModels(true);
    listBoeModelsAction(make)
      .then((list) => {
        setModels(list);
        setLoadingModels(false);
      })
      .catch(() => {
        setModels([]);
        setLoadingModels(false);
      });
  }, [make]);

  function onPickModel(m: BoeModel) {
    setValue("model", m.label, { shouldValidate: true });
    setValue("cvf", m.cvf, { shouldValidate: true });
    setValue("powerKw", Math.round(m.cv * 0.7355), { shouldValidate: true });
    setValue("boeBaseValueEur", m.baseValueEur, { shouldValidate: true });
    // Cualquier cambio de modelo invalida la resolución BON previa.
    setValue("bonBaseValueEur", undefined, { shouldValidate: true });
    setBonNotFound(false);
  }

  function onPickBonModel(m: BoeModel) {
    // El usuario eligió manualmente el equivalente en la tabla BON cuando
    // el match automático falló. Sobreescribimos `bonBaseValueEur` y los
    // datos derivados (cvf, kW) por los del BON, que es la fuente que
    // Hacienda Foral aplicará al matricular en Navarra.
    setValue("bonBaseValueEur", m.baseValueEur, { shouldValidate: true });
    setValue("cvf", m.cvf, { shouldValidate: true });
    setValue("powerKw", Math.round(m.cv * 0.7355), { shouldValidate: true });
    setBonNotFound(false);
  }

  function onPickPlace(which: "origin" | "destination", p: RoutePlace | undefined) {
    if (!p) {
      if (which === "origin") setOriginCoords(null);
      else setDestCoords(null);
      return;
    }
    if (p.lat != null && p.lng != null) {
      const coords = { lat: p.lat, lng: p.lng };
      if (which === "origin") setOriginCoords(coords);
      else setDestCoords(coords);
    }
    let cp = p.postalCode ?? "";
    if (!/^\d{5}$/.test(cp) && p.lat != null && p.lng != null) {
      const prov = nearestProvince(p.lat, p.lng);
      if (prov) cp = `${prov.cp}000`;
    }
    if (which === "origin") {
      setValue("originCp", cp, { shouldValidate: true });
    } else {
      setValue("destinationCp", cp, { shouldValidate: true });
    }
  }

  function enterCustomMode() {
    setCustomMode(true);
    setValue("make", "", { shouldValidate: true });
    setValue("model", "", { shouldValidate: true });
    setValue("boeBaseValueEur", undefined, { shouldValidate: true });
  }

  function importFromAd() {
    if (!adUrl.trim()) return;
    setAdError(null);
    setAdSuccess(null);
    startAdTransition(async () => {
      const res = await extractAdAction(adUrl.trim());
      if (!res.ok) {
        setAdError(res.error);
        return;
      }
      const d = res.data;
      const match = res.boeMatch;
      const filled: string[] = [];

      // ─── Si el coche aparece en el BOE con confianza suficiente, modo BOE ───
      // Así el IEDMT se calcula con el valor venal oficial (Art. 5 regla 2ª
      // de la Orden HAC/1501/2025) y no con el precio del anuncio. El precio
      // del anuncio sigue sumando para el desembolso total.
      if (match && match.confidence !== "low") {
        setCustomMode(false);
        setValue("make", d.make ?? "", { shouldValidate: true });
        setValue("model", match.model, { shouldValidate: true });
        setValue("cvf", match.cvf, { shouldValidate: true });
        setValue("powerKw", Math.round(match.cv * 0.7355), { shouldValidate: true });
        setValue("boeBaseValueEur", match.baseValueEur, { shouldValidate: true });
        filled.push(`BOE (${match.model})`);
      } else {
        // Modo manual: el coche no aparece en el BOE → la fórmula
        // simplificada usa el precio neto del anuncio × tramo CO₂.
        setCustomMode(true);
        if (d.make) {
          setValue("make", d.make, { shouldValidate: true });
          filled.push("marca");
        }
        if (d.model) {
          setValue("model", d.model, { shouldValidate: true });
          filled.push("modelo");
        }
        if (d.cv != null) {
          setValue("powerKw", Math.round(d.cv * 0.7355), { shouldValidate: true });
          filled.push("potencia");
        }
      }

      // ─── Campos comunes a ambos modos ───
      // engineCc: el BOE no incluye esta columna, así que la guardamos
      // siempre del anuncio. Solo se usa en modo manual (fórmula sobre
      // factura) pero la dejamos visible en modo enlace para que el
      // usuario vea todos los datos extraídos.
      if (d.engineCc != null) {
        setValue("engineCc", d.engineCc, { shouldValidate: true });
        filled.push("cilindrada");
      }
      if (d.priceEur != null) {
        setValue("purchasePriceEur", d.priceEur, { shouldValidate: true });
        filled.push("precio");
      }
      // Régimen IVA y neto explícito (mobile.de los publica, AS24 los
      // deduce el extractor por texto/badge). Si es deducible activamos
      // el toggle; si es REBU, lo dejamos en false.
      if (d.invoiceRegime === "deductible_vat") {
        setValue("invoiceHasDeductibleVat", true, { shouldValidate: true });
        if (d.vatRate != null) {
          setValue("vatRateOverride", d.vatRate, { shouldValidate: true });
        }
        if (d.netPriceEur != null) {
          setValue("netPriceEur", d.netPriceEur, { shouldValidate: true });
        }
        filled.push("IVA deducible");
      } else if (d.invoiceRegime === "rebu") {
        setValue("invoiceHasDeductibleVat", false, { shouldValidate: true });
        setValue("vatRateOverride", undefined, { shouldValidate: true });
        setValue("netPriceEur", undefined, { shouldValidate: true });
        filled.push("REBU");
      }
      if (d.co2Bracket) {
        setValue("co2Bracket", d.co2Bracket, { shouldValidate: true });
        filled.push("CO₂");
      }
      if (d.firstRegDate) {
        setValue("firstRegDate", d.firstRegDate, { shouldValidate: true });
        filled.push("matriculación");
      }
      if (d.kilometers != null) {
        setValue("kilometers", d.kilometers, { shouldValidate: true });
        filled.push("km");
      }
      if (d.sellerType) {
        setValue("sellerType", d.sellerType, { shouldValidate: true });
        filled.push("tipo vendedor");
      }
      // El form solo admite turismos. Si el combustible es eléctrico/híbrido,
      // marcamos ev_or_hybrid (depreciación distinta en algunos años BOE).
      // Si el anuncio fuese de vehículo comercial, lo ignoramos y avisamos.
      if (d.fuelType === "electrico" || d.fuelType === "hibrido") {
        setValue("vehicleType", "ev_or_hybrid", { shouldValidate: true });
      } else if (d.vehicleType === "turismo" || !d.vehicleType) {
        setValue("vehicleType", "turismo", { shouldValidate: true });
      }

      // ─── Nuevo / Usado a partir de fecha y km extraídos ───
      // < 6 meses desde 1ª matriculación O < 6.000 km → coche nuevo. El
      // flujo "nuevo" está en standby; mostraremos el mensaje "Próximamente"
      // y el usuario podrá cambiar manualmente si discrepa.
      const isNewFromAd = (() => {
        if (d.firstRegDate) {
          const ageYears =
            (Date.now() - new Date(d.firstRegDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
          if (ageYears < 0.5) return true;
        }
        if (d.kilometers != null && d.kilometers < 6000) return true;
        return false;
      })();
      setValue("vehicleCondition", isNewFromAd ? "new" : "used", { shouldValidate: true });

      // El campo "Tu factura tiene IVA deducible" depende del régimen del
      // comprador y la operación: lo dejamos para que el usuario lo confirme.

      // ─── Banner: avisamos si faltan campos críticos para calcular ───
      // Los campos mínimos para calcular son marca, modelo, precio y fecha.
      // Si alguno falta tras la importación, avisamos al usuario para que
      // lo complete a mano antes de continuar.
      // El summary card hace de banner de éxito con headline + tag + datos.
      // adSuccess queda solo como fallback para el caso raro de "0 datos
      // extraídos" (página leída pero sin info útil).
      const portal = res.sourceHost;
      const fallback =
        filled.length === 0
          ? `Conectamos con ${portal} pero el anuncio no traía datos legibles. Rellena a mano.`
          : null;
      setAdSuccess(fallback);
      setAdImported({ data: d, sourceHost: portal, boeMatch: match });
      // El usuario está en el carril de enlace — lo dejamos fijado.
      setEntryMode("link");
    });
  }

  function exitCustomMode() {
    setCustomMode(false);
    setValue("make", "", { shouldValidate: true });
    setValue("model", "", { shouldValidate: true });
    setValue("boeBaseValueEur", undefined, { shouldValidate: true });
  }

  // ─── Condiciones de avance ───
  // El bloque 1 sólo pide identificar el vehículo (marca + modelo + precio).
  // El resto (provincia, datos fiscales, datos técnicos) se mueve al bloque 2.
  // Coche nuevo (<6m o <6000km) está en standby — no avanza.
  const isVehicleReady =
    entryMode != null &&
    !!(values.make && values.model && values.purchasePriceEur && values.purchasePriceEur > 0);

  // El bloque 2 necesita: provincia (siempre), datos fiscales (siempre),
  // y datos técnicos extra (cilindrada + cilindros + potencia) sólo cuando
  // el coche NO está en BOE (customMode).
  const isNewVehicleFlow = values.vehicleCondition === "new";
  const isRegistrationReady = !!(
    values.provinceIso &&
    values.co2Bracket &&
    values.firstRegDate &&
    (isNewVehicleFlow || (values.buyerType && values.sellerType)) &&
    (!customMode ||
      (values.engineCc &&
        values.engineCc > 0 &&
        values.cylinders &&
        values.cylinders > 0 &&
        values.powerKw &&
        values.powerKw > 0)) &&
    // En Navarra exigimos que el modelo esté resuelto en el BON antes de
    // avanzar — el cálculo en Navarra usa la tabla foral, no el BOE estatal.
    !(bonNotFound && (values.bonBaseValueEur ?? 0) <= 0)
  );

  const isTransportReady =
    !!(originCoords || (values.originCp && /^\d{5}$/.test(values.originCp))) &&
    !!(destCoords || (values.destinationCp && /^\d{5}$/.test(values.destinationCp)));

  // Lista de campos faltantes para que el ResultPanel pueda enseñar al
  // usuario QUÉ rellenar cuando no tenemos resultado. Agrupamos por bloque
  // (1 Vehículo · 2 Matriculación · 3 Transporte) y dentro listamos cada
  // campo con etiqueta legible.
  const missingFields = useMemo(() => {
    const groups: { block: string; items: string[] }[] = [];
    const veh: string[] = [];
    if (!entryMode) veh.push("Cómo introducir el coche (link o manual)");
    if (!values.make) veh.push("Marca");
    if (!values.model) veh.push("Modelo");
    if (!values.purchasePriceEur || values.purchasePriceEur <= 0) veh.push("Precio del coche");
    if (veh.length) groups.push({ block: "1 · Vehículo", items: veh });

    const reg: string[] = [];
    if (!values.provinceIso) reg.push("Comunidad autónoma de matriculación");
    if (!values.co2Bracket) reg.push("Tramo de emisiones CO₂ WLTP");
    if (!values.firstRegDate) reg.push("Fecha 1ª matriculación");
    if (!isNewVehicleFlow) {
      if (!values.buyerType) reg.push("Tipo de comprador");
      if (!values.sellerType) reg.push("Quién te vende el coche");
    }
    if (customMode) {
      if (!values.engineCc || values.engineCc <= 0) reg.push("Cilindrada (cc)");
      if (!values.cylinders || values.cylinders <= 0) reg.push("Nº de cilindros");
      if (!values.powerKw || values.powerKw <= 0) reg.push("Potencia (kW/CV)");
    }
    if (bonNotFound && (values.bonBaseValueEur ?? 0) <= 0) {
      reg.push("Selecciona modelo equivalente en el BON Navarra");
    }
    if (reg.length) groups.push({ block: "2 · Matriculación", items: reg });

    const tr: string[] = [];
    if (!originCoords && !(values.originCp && /^\d{5}$/.test(values.originCp))) {
      tr.push("Ciudad o código postal de recogida");
    }
    if (!destCoords && !(values.destinationCp && /^\d{5}$/.test(values.destinationCp))) {
      tr.push("Ciudad o código postal de entrega");
    }
    if (tr.length) groups.push({ block: "3 · Transporte", items: tr });

    return groups;
  }, [
    entryMode,
    values.make,
    values.model,
    values.purchasePriceEur,
    values.provinceIso,
    values.co2Bracket,
    values.firstRegDate,
    values.buyerType,
    values.sellerType,
    values.engineCc,
    values.cylinders,
    values.powerKw,
    values.originCp,
    values.destinationCp,
    values.bonBaseValueEur,
    isNewVehicleFlow,
    customMode,
    bonNotFound,
    originCoords,
    destCoords,
  ]);

  // Todos los avances entre bloques son manuales (botón "Continuar ↓").
  // El usuario controla cuándo abrir el siguiente bloque. Los avances
  // automáticos se eliminaron porque al pulsar "Continuar" en el 2,
  // el 3 quedaba listo en seguida (CPs default) y el efecto avanzaba
  // a 4 sin que el usuario tocase nada.

  function unlockTo(n: 1 | 2 | 3 | 4) {
    setUnlockedStep((s) => (n > s ? n : s));
    setTimeout(() => {
      refs[n]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function jumpTo(n: 1 | 2 | 3 | 4) {
    if (n > unlockedStep) return;
    refs[n]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function persist(formValues: CalculatorFormValues) {
    startTransition(async () => {
      const res = await saveCalculationAction(formValues);
      if ("needsAuth" in res && res.needsAuth) {
        setNeedsAuth(true);
        return;
      }
      if (!res.ok) {
        setPersistError("error" in res ? res.error : "Error inesperado");
        return;
      }
      setSavedId(res.requestId);
    });
  }

  const onSubmit = handleSubmit((vals) => {
    setPersistError(null);
    setNeedsAuth(false);
    if (!isAuthenticated) {
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(vals));
      } catch {
        /* no-op */
      }
      // En el repo standalone NO hay login. Si el formulario pide auth, no
      // hacemos nada (el botón "Guardar" queda inactivo por needsAuth).
      return;
    }
    persist(vals);
  });

  useEffect(() => {
    if (!isAuthenticated) return;
    if (searchParams.get("pending") !== "1") return;
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    try {
      const parsed = calculatorSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return;
      reset(parsed.data);
      persist(parsed.data);
      sessionStorage.removeItem(PENDING_KEY);
      router.replace("/calculator");
    } catch {
      sessionStorage.removeItem(PENDING_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  function goToPublish() {
    // En el repo standalone NO existe /publish. El callback queda
    // inactivo; el botón "Publicar" del ResultPanel no se mostrará
    // porque needsAuth siempre devuelve true.
  }

  // Ref del bloque de desglose para hacer scroll suave al pulsar "Calcular".
  const resultRef = useRef<HTMLDivElement>(null);
  function scrollToResult() {
    setShowResult(true);
    // Esperamos un tick para que el panel pinte antes de scrollear.
    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

  function resetAll() {
    if (!confirm("¿Borrar toda la información que has rellenado?")) return;
    reset(DEFAULT_VALUES);
    setUnlockedStep(1);
    setCustomMode(false);
    setEntryMode(null);
    setAdUrl("");
    setAdError(null);
    setAdSuccess(null);
    setAdImported(null);
    setOriginCoords(null);
    setDestCoords(null);
    setSavedId(null);
    setPersistError(null);
    setNeedsAuth(false);
    setShowResult(false);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* no-op */
    }
    refs[1]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      {/* Columna formulario */}
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {/* Stepper */}
        <Stepper unlocked={unlockedStep} onJump={jumpTo} />

        {/* ─── Bloque 1: Vehículo ─── */}
        <StepCard
          n={1}
          ref={ref1}
          title="Vehículo"
          intro="Identifica el coche: marca, modelo y precio de compra. Los datos fiscales y técnicos los pediremos en el siguiente paso."
          status={isVehicleReady ? "completed" : "current"}
          unlocked={true}
          continueDisabled={!isVehicleReady}
          continueLabel="Continuar"
          onContinue={() => unlockTo(2)}
          headerAction={
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex h-8 items-center rounded-full border border-border bg-white px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-text-soft hover:border-state-error hover:text-state-error"
            >
              Borrar todo
            </button>
          }
        >
          {/* ─── Selector Nuevo / Usado ─── */}
          {/* Nuevo = <6 meses desde 1ª matriculación O <6.000 km. La fórmula
              IEDMT cambia (no aplica depreciación). Hoy solo soportamos el
              flujo de coches usados; el de coches nuevos queda en standby. */}
          <Controller
            control={control}
            name="vehicleCondition"
            render={({ field }) => (
              <Field label="¿El coche es nuevo o usado?">
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => field.onChange("used")}
                    className={[
                      "rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                      field.value === "used"
                        ? "border-brand-accent bg-brand-surface text-brand-deep"
                        : "border-border bg-bg-subtle text-text-soft hover:bg-bg-subtle",
                    ].join(" ")}
                  >
                    <strong className="block">Usado</strong>
                    <span className="text-xs">Más de 6 meses o más de 6.000 km.</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => field.onChange("new")}
                    className={[
                      "rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                      field.value === "new"
                        ? "border-brand-accent bg-brand-surface text-brand-deep"
                        : "border-border bg-bg-subtle text-text-soft hover:bg-bg-subtle",
                    ].join(" ")}
                  >
                    <strong className="block">Nuevo</strong>
                    <span className="text-xs">Menos de 6 meses o menos de 6.000 km.</span>
                  </button>
                </div>
              </Field>
            )}
          />

          {values.vehicleCondition === "new" && (
            <div className="rounded-xl border border-brand-accent/30 bg-brand-surface px-4 py-3 text-sm text-brand-deep">
              <strong className="block">Coche nuevo · cálculo sobre el precio de factura</strong>
              <p className="mt-1 text-xs text-text-soft">
                Para coches nuevos (menos de 6 meses o menos de 6.000 km) Hacienda calcula el IEDMT
                sobre el precio de factura, sin pasar por las tablas del BOE. Te pediremos marca,
                modelo y los datos técnicos a mano.
              </p>
            </div>
          )}

          {(values.vehicleCondition === "used" || values.vehicleCondition === "new") && (
            <>
              {/* ─── Chooser inicial: enlace vs manual ─── */}
              {entryMode === null && (
                <div className="grid gap-3">
                  <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-brand-deep">
                    ¿Cómo prefieres empezar?
                  </span>
                  <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
                    {/* Tarjeta principal: destacada con fondo brand, sombra y CTA visible.
                    Es el camino "rápido" y queremos que el ojo vaya aquí primero. */}
                    <button
                      type="button"
                      onClick={() => setEntryMode("link")}
                      className="group relative flex flex-col items-start gap-2 rounded-2xl border border-brand-accent/40 bg-brand-surface p-5 text-left shadow-soft transition-all hover:border-brand-accent hover:shadow-elevated"
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-accent">
                        ✦ Recomendado · 10-15 s
                      </span>
                      <span className="font-display text-lg font-extrabold leading-tight text-brand-deep">
                        Pegar el enlace del anuncio
                      </span>
                      <span className="text-sm text-text-soft">
                        Funciona con coches.net, AutoScout24 y mobile.de. La IA y el BOE 2026
                        rellenan casi todo por ti.
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-brand-accent">
                        Empezar
                        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
                          <path
                            d="M5 12h14m-6-6 6 6-6 6"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </button>
                    {/* Tarjeta secundaria: gris, menos jerarquía, para el camino lento. */}
                    <button
                      type="button"
                      onClick={() => setEntryMode("manual")}
                      className="group flex flex-col items-start justify-center gap-1 rounded-2xl border border-border bg-bg-subtle p-5 text-left transition-colors hover:border-brand-accent hover:bg-white"
                    >
                      <span className="text-sm font-bold text-text-soft">Rellenar a mano</span>
                      <span className="text-xs text-text-muted">
                        Busca marca y modelo en el BOE 2026.
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* ─── Modo enlace: importar datos desde un anuncio ─── */}
              {entryMode === "link" && (
                <div className="rounded-xl border border-dashed border-border bg-bg-subtle p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-brand-deep">
                      Pega el enlace del anuncio
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEntryMode(null);
                        setAdUrl("");
                        setAdError(null);
                        setAdSuccess(null);
                        setAdImported(null);
                      }}
                      className="text-[11px] font-semibold text-text-soft underline-offset-2 hover:text-brand-accent hover:underline"
                    >
                      Cambiar
                    </button>
                  </div>
                  <span className="mt-1 block text-xs text-text-soft">
                    Funciona con coches.net, AutoScout24 y mobile.de. Lee los datos públicos del
                    anuncio, los completa con IA si falta CO₂ o tipo de vendedor, y los cruza con la
                    tabla del BOE 2026.
                  </span>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      type="url"
                      inputMode="url"
                      className={`${inputClass} min-w-0 flex-1`}
                      placeholder="https://www.coches.net/…"
                      value={adUrl}
                      onChange={(e) => setAdUrl(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={!adUrl.trim() || adPending}
                      onClick={importFromAd}
                      className="inline-flex h-11 items-center rounded-full bg-brand-deep px-5 text-sm font-bold text-white hover:bg-brand-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {adPending ? "Importando…" : "Importar"}
                    </button>
                  </div>
                  {adPending && <ImportProgressBar />}
                  {adError && (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-state-error/30 bg-state-error/5 px-3 py-2 text-xs text-state-error"
                    >
                      {adError}
                    </p>
                  )}
                  {/* Cuando hay datos importados, el summary card hace de banner
                  de éxito (con el tag "Encontrado en BOE / No en BOE").
                  El mensaje adSuccess solo se muestra si NO hay summary
                  — caso raro de "importado pero sin AdData". */}
                  {adImported ? (
                    <ImportSummary imported={adImported} />
                  ) : adSuccess ? (
                    <p className="mt-3 rounded-lg border border-state-success/30 bg-state-success/5 px-3 py-2 text-xs text-state-success">
                      {adSuccess}
                    </p>
                  ) : null}
                </div>
              )}

              {entryMode === "manual" && (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-brand-deep">
                    Rellenar a mano · busca en el BOE 2026
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEntryMode(null);
                      setCustomMode(false);
                    }}
                    className="text-[11px] font-semibold text-text-soft underline-offset-2 hover:text-brand-accent hover:underline"
                  >
                    Cambiar
                  </button>
                </div>
              )}

              {entryMode != null &&
                (entryMode === "link" || customMode ? (
                  <>
                    {/* Banner "modo manual" SOLO cuando el usuario eligió rellenar
                  a mano y el modelo no aparece en el BOE. En modo enlace
                  los datos vienen del anuncio — no es "manual" para el
                  usuario aunque internamente usemos texto libre. */}
                    {entryMode === "manual" && customMode && values.vehicleCondition !== "new" && (
                      <div className="rounded-xl border border-state-warning/40 bg-state-warning/5 p-4 text-sm text-text-soft">
                        <strong className="block text-brand-deep">
                          Modo manual · No aparece mi vehículo
                        </strong>
                        <p className="mt-2">
                          Cuando el vehículo no figura en la tabla del BOE, Hacienda calcula el
                          impuesto de matriculación sobre el{" "}
                          <strong className="text-brand-deep">valor de la factura</strong>. En el
                          paso 2 te pediremos cilindrada, nº de cilindros y potencia para derivar el
                          CVF.
                        </p>
                        <button
                          type="button"
                          onClick={exitCustomMode}
                          className="mt-3 text-xs font-bold text-brand-accent hover:underline"
                        >
                          ← Volver al buscador BOE
                        </button>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Marca (libre)" error={errors.make?.message}>
                        <input
                          type="text"
                          className={inputClass}
                          placeholder="p. ej. Lotus, Polestar…"
                          {...register("make")}
                        />
                      </Field>
                      <Field label="Modelo (libre)" error={errors.model?.message}>
                        <input
                          type="text"
                          className={inputClass}
                          placeholder="p. ej. Emira V6"
                          {...register("model")}
                        />
                      </Field>
                    </div>
                  </>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Controller
                      control={control}
                      name="make"
                      render={({ field }) => (
                        <Combobox
                          label="Marca"
                          placeholder="Buscar marca…"
                          error={errors.make?.message}
                          value={field.value}
                          options={makes.map((m) => ({ id: m, label: m }))}
                          onPick={(v) => {
                            field.onChange(v);
                            setValue("model", "", { shouldValidate: true });
                            setValue("boeBaseValueEur", undefined, { shouldValidate: true });
                          }}
                          emptyLabel="No encuentro mi marca"
                          onEmptyClick={enterCustomMode}
                        />
                      )}
                    />
                    <Combobox
                      label="Modelo"
                      placeholder={
                        !make
                          ? "Elige una marca primero"
                          : loadingModels
                            ? "Cargando modelos…"
                            : "Buscar modelo…"
                      }
                      error={errors.model?.message}
                      value={values.model ?? ""}
                      disabled={!make}
                      loading={loadingModels}
                      options={models.map((m) => ({
                        id: m.id,
                        label: m.label,
                        sub: formatModelSub(m),
                        right: formatCents(m.baseValueEur * 100),
                        payload: m,
                      }))}
                      onPick={(_, item) => {
                        if (item?.payload) onPickModel(item.payload as BoeModel);
                      }}
                      emptyLabel="No encuentro mi modelo"
                      onEmptyClick={enterCustomMode}
                    />
                  </div>
                ))}

              {entryMode === "manual" && !customMode && (
                <button
                  type="button"
                  onClick={enterCustomMode}
                  className="-mt-1 self-start text-sm font-bold text-brand-accent underline-offset-2 hover:underline"
                >
                  ¿Mi modelo no aparece? · Introducir manualmente →
                </button>
              )}

              {entryMode != null && (
                <Field label="Precio del coche (€)" error={errors.purchasePriceEur?.message}>
                  {values.vehicleCondition === "new" && (
                    <div className="-mt-1 mb-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPriceHelpOpen(true)}
                        aria-label="Ver ejemplos de IVA deducible y REBU"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-brand-accent bg-brand-accent text-xs font-bold leading-none text-white shadow-sm transition-colors hover:border-brand-deep hover:bg-brand-deep focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
                      >
                        i
                      </button>
                      <button
                        type="button"
                        onClick={() => setPriceHelpOpen(true)}
                        className="text-[11px] font-semibold text-brand-accent underline-offset-2 hover:underline"
                      >
                        Ver ejemplos con capturas reales
                      </button>
                    </div>
                  )}
                  <input
                    type="number"
                    step="100"
                    inputMode="numeric"
                    disabled={!customMode && (!values.make || !values.model)}
                    placeholder={
                      !customMode && (!values.make || !values.model)
                        ? "Elige marca y modelo primero"
                        : "Escribe una cifra"
                    }
                    className={inputClass}
                    value={
                      values.purchasePriceEur && values.purchasePriceEur > 0
                        ? values.purchasePriceEur
                        : ""
                    }
                    onChange={(e) => {
                      const v = e.target.valueAsNumber;
                      setValue("purchasePriceEur", Number.isFinite(v) ? v : 0, {
                        shouldValidate: true,
                      });
                    }}
                  />
                  {/* Disclaimer condicional: en modo BOE el precio NO entra al
                  IEDMT (la base es el valor BOE); en modo manual SÍ es la base
                  imponible directa (sin restar IVA — el valor que el usuario
                  mete ya es el neto, sea menor del anuncio o REBU). En coches
                  nuevos mostramos también la explicación IVA deducible/REBU. */}
                  {values.vehicleCondition === "new" ? (
                    <div className="mt-3 grid gap-2 rounded-xl border border-border bg-bg-subtle/60 p-4 text-xs text-text-soft">
                      <p>
                        Si tu vehículo se vende con{" "}
                        <strong className="text-brand-deep">IVA deducible</strong>, verás dos
                        precios en el anuncio de{" "}
                        <strong className="text-brand-deep">mobile.de</strong> — coge el{" "}
                        <strong>menor</strong> para rellenar este campo. En{" "}
                        <strong className="text-brand-deep">AutoScout</strong> verás un solo precio
                        con subíndice <strong>¹</strong> o la etiqueta{" "}
                        <strong>&quot;IVA deducible&quot;</strong>; en tal caso divide el precio
                        entre el IVA del país de venta (Alemania 1,19 · Bélgica 1,21 · Francia
                        1,20…) para obtener el valor neto y mete ese aquí.
                      </p>
                      <p>
                        Si es <strong className="text-brand-deep">REBU</strong> el IVA no es
                        deducible y verás un solo precio en el anuncio: cógelo tal cual y mételo
                        aquí.
                      </p>
                    </div>
                  ) : customMode ? (
                    <span className="mt-1 block text-xs text-text-muted">
                      Indica el precio sin IVA — en anuncios con dos precios, el menor; en REBU, el
                      único que aparece. Lo usamos como base imponible del IEDMT.
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs text-text-muted">
                      Este precio se usa para transporte y gestiones, no para el impuesto de
                      matriculación (lo calcula Hacienda con el valor oficial del BOE).
                    </span>
                  )}
                </Field>
              )}
            </>
          )}
        </StepCard>

        {/* ─── Bloque 2: Matriculación ─── */}
        <StepCard
          n={2}
          ref={ref2}
          title="Matriculación"
          intro="Datos de la operación — comunidad, fecha, kilómetros y perfil fiscal de la matriculación."
          status={unlockedStep < 2 ? "locked" : isRegistrationReady ? "completed" : "current"}
          unlocked={unlockedStep >= 2}
          continueDisabled={!isRegistrationReady}
          continueLabel="Continuar"
          onContinue={() => unlockTo(3)}
        >
          <Controller
            control={control}
            name="provinceIso"
            render={({ field }) => (
              <Field
                label="Comunidad autónoma donde se matriculará"
                error={errors.provinceIso?.message}
              >
                <select
                  className={`${inputClass} ${field.value ? "" : "!text-text-muted"}`}
                  {...field}
                >
                  <option value="" disabled>
                    Elige una opción
                  </option>
                  {CCAA_OPTIONS.map((c) => (
                    <option key={c.iso} value={c.iso}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          />

          {/* Aviso silencioso cuando hemos encontrado el equivalente BON. */}
          {values.provinceIso === "ES-NC" &&
            values.bonBaseValueEur != null &&
            values.bonBaseValueEur > 0 && (
              <div className="rounded-xl border border-brand-accent/30 bg-brand-surface px-4 py-3 text-xs text-brand-deep">
                <strong className="block">Aplicando valor del BON Navarra</strong>
                <span className="text-text-soft">
                  Tu coche se matricula en Navarra: usamos el precio medio del Boletín Oficial de
                  Navarra (Orden Foral 6/2026), no el BOE estatal.
                </span>
              </div>
            )}

          {/* Re-selector cuando el modelo BOE no tiene equivalente en el BON. */}
          {bonNotFound && (
            <div className="grid gap-3 rounded-xl border border-state-warning/40 bg-state-warning/5 p-4">
              <div>
                <strong className="block text-sm text-brand-deep">
                  Tu modelo no está en el BON Navarra
                </strong>
                <p className="mt-1 text-xs text-text-soft">
                  Hacienda Foral aplica la tabla del Boletín Oficial de Navarra al matricular en
                  Navarra. Tu modelo del BOE estatal (
                  <strong>
                    {values.make} · {values.model}
                  </strong>
                  ) no aparece tal cual en el BON. Selecciona el equivalente abajo o, si no figura
                  ninguno, cambia la CCAA o usa el cálculo por factura.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Combobox
                  label="Marca (BON Navarra)"
                  placeholder="Buscar marca…"
                  value={bonMakeChoice}
                  options={bonMakes.map((m) => ({ id: m, label: m }))}
                  onPick={(v) => setBonMakeChoice(v)}
                  emptyLabel="No encuentro mi marca"
                  onEmptyClick={() => undefined}
                />
                <Combobox
                  label="Modelo (BON Navarra)"
                  placeholder={
                    !bonMakeChoice
                      ? "Elige una marca primero"
                      : bonLoadingModels
                        ? "Cargando modelos…"
                        : "Buscar modelo…"
                  }
                  value=""
                  disabled={!bonMakeChoice}
                  loading={bonLoadingModels}
                  options={bonModels.map((m) => ({
                    id: m.id,
                    label: m.label,
                    sub: formatModelSub(m),
                    right: formatCents(m.baseValueEur * 100),
                    payload: m,
                  }))}
                  onPick={(_, item) => {
                    if (item?.payload) onPickBonModel(item.payload as BoeModel);
                  }}
                  emptyLabel="No encuentro mi modelo"
                  onEmptyClick={() => undefined}
                />
              </div>
            </div>
          )}

          {bonResolving && values.provinceIso === "ES-NC" && !bonNotFound && (
            <div className="text-xs text-text-soft">
              <span className="inline-flex items-center gap-2">
                <svg
                  className="h-3 w-3 animate-spin text-brand-accent"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    opacity="0.25"
                  />
                  <path
                    d="M21 12a9 9 0 0 0-9-9"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
                Buscando equivalente en BON Navarra…
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="co2Bracket"
              render={({ field }) => (
                <Field label="Tramo de emisiones CO₂ WLTP" error={errors.co2Bracket?.message}>
                  <select
                    className={`${inputClass} ${field.value ? "" : "!text-text-muted"}`}
                    {...field}
                  >
                    <option value="" disabled>
                      Elige una opción
                    </option>
                    {CO2_BRACKETS.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            />
            <Controller
              control={control}
              name="firstRegDate"
              render={({ field, fieldState }) => (
                <Field label="Fecha 1ª matriculación" error={fieldState.error?.message}>
                  <DatePicker
                    label=""
                    value={field.value || undefined}
                    onChange={(v) => field.onChange(v ?? "")}
                    error={fieldState.error}
                  />
                </Field>
              )}
            />
          </div>

          {values.vehicleCondition !== "new" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={control}
                name="buyerType"
                render={({ field }) => (
                  <Field label="Tipo de comprador">
                    <select
                      className={`${inputClass} ${field.value ? "" : "!text-text-muted"}`}
                      {...field}
                    >
                      <option value="" disabled>
                        Elige una opción
                      </option>
                      <option value="particular">Particular</option>
                      <option value="professional">
                        Profesional (concesionario / compraventa)
                      </option>
                    </select>
                  </Field>
                )}
              />
              <Controller
                control={control}
                name="sellerType"
                render={({ field }) => (
                  <Field label="Quién te vende el coche">
                    <select
                      className={`${inputClass} ${field.value ? "" : "!text-text-muted"}`}
                      {...field}
                    >
                      <option value="" disabled>
                        Elige una opción
                      </option>
                      <option value="particular">Particular</option>
                      <option value="professional">
                        Profesional (concesionario / compraventa)
                      </option>
                    </select>
                  </Field>
                )}
              />
            </div>
          )}

          <div className="grid gap-3">
            <Controller
              control={control}
              name="largeFamily"
              render={({ field }) => (
                <YesNoField
                  label="¿Familia numerosa?"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={control}
              name="disability33"
              render={({ field }) => (
                <YesNoField
                  label="¿Discapacidad ≥ 33%?"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>

          {/* ─── Sub-bloque 2-bis: datos técnicos (solo NO-BOE) ───
              Cuando el vehículo no aparece en el BOE necesitamos cilindrada,
              número de cilindros y potencia para que la calculadora pueda
              derivar el CVF con la fórmula oficial y aplicar el IEDMT sobre
              el precio de factura. También preguntamos por el régimen IVA
              (deducible vs REBU). En modo BOE estos datos vienen del BOE. */}
          {customMode && (
            <div className="grid gap-4 rounded-xl border border-state-warning/40 bg-state-warning/5 p-4">
              <div>
                <strong className="block text-sm text-brand-deep">
                  Datos técnicos ·{" "}
                  {values.vehicleCondition === "new"
                    ? "coche nuevo"
                    : "tu coche no aparece en el BOE"}
                </strong>
                <p className="mt-1 text-xs text-text-soft">
                  Hacienda calcula el IEDMT sobre el valor de factura. Necesitamos cilindrada,
                  cilindros y potencia para derivar el CVF.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Cilindrada (cc)" error={errors.engineCc?.message}>
                  <input
                    type="number"
                    step="1"
                    inputMode="numeric"
                    placeholder="p. ej. 1499"
                    className={inputClass}
                    {...register("engineCc", { valueAsNumber: true })}
                  />
                </Field>
                <Field label="Nº de cilindros" error={errors.cylinders?.message}>
                  <input
                    type="number"
                    step="1"
                    inputMode="numeric"
                    placeholder="p. ej. 4"
                    className={inputClass}
                    {...register("cylinders", { valueAsNumber: true })}
                  />
                </Field>
                <Field
                  label="Potencia (CV)"
                  error={errors.powerKw?.message}
                  hint={values.powerKw && values.powerKw > 0 ? `≈ ${values.powerKw} kW` : undefined}
                >
                  <input
                    type="number"
                    step="1"
                    inputMode="numeric"
                    placeholder="p. ej. 150"
                    className={inputClass}
                    value={
                      values.powerKw && values.powerKw > 0
                        ? Math.round(values.powerKw / 0.7355)
                        : ""
                    }
                    onChange={(e) => {
                      const cv = e.target.valueAsNumber;
                      const kw = Number.isFinite(cv) ? Math.round(cv * 0.7355) : 0;
                      setValue("powerKw", kw, { shouldValidate: true });
                    }}
                  />
                </Field>
              </div>
              <Field
                label="Caballos fiscales (CVF · calculado)"
                hint={
                  values.cvf && values.cvf > 0
                    ? `(${values.engineCc ?? "—"} / ${values.cylinders ?? "—"})^0,6 × 0,08 × ${values.cylinders ?? "—"}`
                    : "Rellena cilindrada y nº de cilindros para calcular."
                }
              >
                <input
                  type="text"
                  readOnly
                  className={`${inputClass} cursor-not-allowed bg-bg-subtle`}
                  value={values.cvf && values.cvf > 0 ? values.cvf.toFixed(2) : ""}
                />
              </Field>
              {values.vehicleCondition !== "new" && (
                <InvoiceVatToggle iedmtBaseVal={values.iedmtBaseEur} setValue={setValue} />
              )}
            </div>
          )}
        </StepCard>

        {/* ─── Bloque 3: Transporte ─── */}
        <StepCard
          n={3}
          ref={ref3}
          title="Transporte"
          intro="Indica la ciudad de recogida y la de entrega. Calculamos la distancia automáticamente."
          status={unlockedStep < 3 ? "locked" : isTransportReady ? "completed" : "current"}
          unlocked={unlockedStep >= 3}
          continueDisabled={!isTransportReady}
          continueLabel="Continuar"
          onContinue={() => unlockTo(4)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ciudad o código postal de recogida" error={errors.originCp?.message}>
              <PlacesAutocomplete
                kind="cities"
                countries={[]}
                placeholder="Múnich, 28001, Londres SW1A…"
                inputClassName={inputClass}
                onChange={(p) => onPickPlace("origin", p)}
              />
              <input type="hidden" {...register("originCp")} />
            </Field>
            <Field label="Ciudad o código postal de entrega" error={errors.destinationCp?.message}>
              <PlacesAutocomplete
                kind="cities"
                countries={[]}
                placeholder="Madrid, 08001, Sevilla 41001…"
                inputClassName={inputClass}
                onChange={(p) => onPickPlace("destination", p)}
              />
              <input type="hidden" {...register("destinationCp")} />
            </Field>
          </div>

          <Controller
            control={control}
            name="truckType"
            render={({ field }) => (
              <Field label="Modalidad de transporte">
                <select className={inputClass} {...field}>
                  {TRUCK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TRUCK_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          />

          {values.distanceKm != null && (
            <p className="text-xs text-text-muted">
              Distancia estimada:{" "}
              <strong className="text-brand-deep">{values.distanceKm} km</strong>.
            </p>
          )}
        </StepCard>

        {/* ─── Bloque 4: Servicios adicionales + CTA ─── */}
        <StepCard
          n={4}
          ref={ref4}
          title="Servicios adicionales"
          intro="Servicios opcionales que puedes activar para que profesionales verificados te coticen junto al transporte."
          status={unlockedStep < 4 ? "locked" : "current"}
          unlocked={unlockedStep >= 4}
          continueDisabled={false}
          continueLabel={null}
          onContinue={undefined}
        >
          <Controller
            control={control}
            name="preInspection"
            render={({ field }) => (
              <ServiceToggle
                label="Quiero revisión pre-compra"
                price="desde 350 €"
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="fichaReducida"
            render={({ field }) => (
              <ServiceToggle
                label="Necesito ficha reducida"
                price="70 €"
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="fullManagement"
            render={({ field }) => (
              <ServiceToggle
                label="Quiero que un profesional gestione todo por mí"
                price="desde 1.500 €"
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex h-11 items-center rounded-full border border-border bg-white px-5 text-sm font-semibold text-text-soft hover:border-state-error hover:text-state-error"
            >
              Borrar toda la información
            </button>
            <button
              type="button"
              onClick={scrollToResult}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-brand-accent px-6 text-sm font-bold text-white shadow-soft hover:bg-brand-primary"
            >
              Calcular mis gastos
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                <path
                  d="M12 5v14m-6-6 6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </StepCard>
      </form>

      {/* Desglose centrado, abajo del todo. Solo se renderiza cuando el
          usuario pulsa "Calcular mis gastos" en el bloque 4 (showResult). */}
      <div ref={resultRef}>
        {showResult && (
          <ResultPanel
            result={liveResult}
            isAuthenticated={isAuthenticated}
            pending={pending}
            savedId={savedId}
            persistError={persistError}
            needsAuth={needsAuth}
            onSave={onSubmit}
            onPublish={goToPublish}
            missingFields={missingFields}
          />
        )}
      </div>
      {/* Modal de ejemplos IVA deducible / REBU. Compartido entre el
          bloque InvoiceVatToggle (usados no-BOE) y el campo "Precio del
          coche" cuando es coche NUEVO. */}
      {priceHelpOpen && <InvoiceHelpModal onClose={() => setPriceHelpOpen(false)} />}
    </div>
  );
}

// ─── Stepper ───────────────────────────────────────────────────────────────

function Stepper({
  unlocked,
  onJump,
}: {
  unlocked: 1 | 2 | 3 | 4;
  onJump: (n: 1 | 2 | 3 | 4) => void;
}) {
  return (
    <ol className="flex items-center justify-center gap-2 overflow-x-auto pb-8 md:pb-12">
      {STEP_TITLES.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3 | 4;
        const isUnlocked = n <= unlocked;
        const isCurrent = n === unlocked;
        const isCompleted = isUnlocked && n < unlocked;
        return (
          <li key={n} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!isUnlocked}
              onClick={() => onJump(n)}
              className={[
                "inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-bold transition-colors",
                isCurrent
                  ? "bg-brand-deep text-white shadow-soft"
                  : isCompleted
                    ? "bg-brand-surface text-brand-deep hover:bg-brand-soft/30"
                    : isUnlocked
                      ? "bg-bg-subtle text-text-soft hover:text-brand-deep"
                      : "bg-bg-subtle text-text-muted opacity-60",
                !isUnlocked ? "cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold",
                  isCurrent
                    ? "bg-white/20 text-white"
                    : isCompleted
                      ? "bg-brand-accent text-white"
                      : "bg-white text-text-muted ring-1 ring-border",
                ].join(" ")}
              >
                {isCompleted ? (
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" aria-hidden>
                    <path
                      d="m5 12 4 4 10-10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  n
                )}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {n < 4 && (
              <span
                aria-hidden
                className={`h-px w-4 sm:w-8 ${isCompleted ? "bg-brand-accent" : "bg-border"}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── StepCard ──────────────────────────────────────────────────────────────

type StepStatus = "locked" | "current" | "completed";

type StepCardProps = {
  n: 1 | 2 | 3 | 4;
  title: string;
  intro: string;
  status: StepStatus;
  unlocked: boolean;
  continueDisabled: boolean;
  continueLabel: string | null;
  onContinue: (() => void) | undefined;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
};

const StepCard = forwardRef<HTMLDivElement, StepCardProps>(function StepCard(
  {
    n,
    title,
    intro,
    status,
    unlocked,
    continueDisabled,
    continueLabel,
    onContinue,
    headerAction,
    children,
  },
  ref,
) {
  // Bloque aún no alcanzado: solo título atenuado en gris.
  if (!unlocked) {
    return (
      <div
        ref={ref}
        aria-hidden
        className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-bg-subtle/40 px-5 py-4"
      >
        <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white text-xs font-extrabold text-text-muted ring-1 ring-border">
          {n}
        </span>
        <span className="font-display text-lg font-bold text-text-muted">{title}</span>
      </div>
    );
  }

  // Bloque desbloqueado: siempre abierto, con todo el contenido visible.
  // El borde resalta el bloque "actual" (el que aún no está completado).
  const isActive = status === "current";
  return (
    <div
      ref={ref}
      className={[
        "scroll-mt-24 rounded-2xl border bg-white shadow-elevated",
        isActive
          ? "border-brand-accent/60 ring-2 ring-brand-accent/15"
          : "border-border ring-1 ring-border/40",
      ].join(" ")}
    >
      <div className="flex items-center gap-3 px-5 py-4">
        <span
          className={[
            "inline-flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-extrabold",
            status === "completed" ? "bg-brand-accent text-white" : "bg-brand-deep text-white",
          ].join(" ")}
        >
          {status === "completed" ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
              <path
                d="m5 12 4 4 10-10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            n
          )}
        </span>
        <h3 className="font-display text-lg font-extrabold tracking-tight text-brand-deep">
          {title}
        </h3>
        {headerAction && <div className="ml-auto">{headerAction}</div>}
      </div>
      <div className="grid gap-5 px-5 pb-6">
        {intro && <p className="-mt-1 text-sm text-text-soft">{intro}</p>}
        {children}
        {continueLabel && onContinue && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              disabled={continueDisabled}
              onClick={onContinue}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-brand-deep px-6 text-sm font-bold text-white hover:bg-brand-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {continueLabel}
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                <path
                  d="M12 5v14m-6-6 6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── ResultPanel ───────────────────────────────────────────────────────────

/** Texto explicativo bajo la línea de IEDMT. Muestra qué fórmula se aplicó
 *  para que el usuario entienda el origen del importe. */
function iedmtSubLabel(iedmt: CalculatorResult["breakdown"]["iedmt"]): string {
  if (iedmt.exemptionReason) return iedmt.exemptionReason;
  const baseTxt = formatCents(iedmt.baseCents);
  const vmTxt = formatCents(iedmt.vmCents);
  const srcLabel = iedmt.valueSource === "BON" ? "BON Navarra" : "BOE estatal";
  const bonif = iedmt.bonificationReason ? ` · ${iedmt.bonificationReason}` : "";
  switch (iedmt.formula) {
    case "boe":
      return iedmt.vatRate > 0
        ? `Valor ${srcLabel} ${vmTxt} (aplicada depreciación ${(iedmt.depreciationFactor * 100).toFixed(0)}% - ${iedmt.ageYears.toFixed(1)} años) - base imponible ${baseTxt} (tras aplicar minorización correspondiente)${bonif}`
        : `Valor ${srcLabel} ${vmTxt} (aplicada depreciación ${(iedmt.depreciationFactor * 100).toFixed(0)}% - ${iedmt.ageYears.toFixed(1)} años) - base imponible ${baseTxt} (régimen foral País Vasco - sin minorización por IVA)${bonif}`;
    case "manual":
      return `Base ${baseTxt} (precio neto factura) · ${iedmt.bracketLabel}${bonif}`;
    case "canarias":
      return iedmt.vatRate > 0
        ? `Valor ${srcLabel} ${vmTxt} (aplicada depreciación ${(iedmt.depreciationFactor * 100).toFixed(0)}% - ${iedmt.ageYears.toFixed(1)} años) - base imponible ${baseTxt} (tras aplicar minorización correspondiente)${bonif}`
        : `Valor venal ${vmTxt} · régimen canario (precio neto factura)${bonif}`;
    case "foral":
      return "Régimen foral — el cálculo lo hace la Hacienda Foral correspondiente";
    case "exempt":
      return iedmt.exemptionReason ?? "Exento";
  }
}

function ResultPanel({
  result,
  isAuthenticated,
  pending,
  savedId,
  persistError,
  needsAuth,
  onSave,
  onPublish,
  missingFields,
}: {
  result: CalculatorResult | null;
  isAuthenticated: boolean;
  pending: boolean;
  savedId: string | null;
  persistError: string | null;
  needsAuth: boolean;
  onSave: (e?: React.BaseSyntheticEvent) => void;
  onPublish: () => void;
  missingFields: { block: string; items: string[] }[];
}) {
  if (!result) {
    // El formulario no parsea contra el schema. Mostramos un placeholder
    // con la lista exacta de campos pendientes agrupados por bloque para
    // que el usuario sepa qué rellenar sin tener que scroll-buscar.
    return (
      <div className="mt-4 grid place-items-center rounded-2xl border border-dashed border-border bg-bg-subtle p-8 text-center">
        <div className="rounded-full bg-brand-surface p-4 text-brand-accent">
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden>
            <path
              d="M3 12h4l3-9 4 18 3-9h4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-bold text-brand-deep">Faltan algunos datos</h3>
        {missingFields.length > 0 ? (
          <div className="mt-4 grid w-full max-w-sm gap-3 text-left">
            {missingFields.map((g) => (
              <div key={g.block} className="rounded-xl border border-border bg-white p-3 text-sm">
                <strong className="block text-xs font-extrabold uppercase tracking-wider text-brand-deep">
                  Bloque {g.block}
                </strong>
                <ul className="mt-2 grid gap-1 text-text-soft">
                  {g.items.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-state-warning"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 max-w-xs text-sm text-text-soft">
            Revisa que todos los bloques estén completos para que podamos calcular el desglose.
          </p>
        )}
      </div>
    );
  }
  const b = result.breakdown;
  return (
    <div className="mt-4 grid gap-4">
      <div className="rounded-2xl bg-brand-deep p-6 text-white shadow-elevated">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-soft">
          Coste total estimado
        </p>
        <p className="mt-2 font-display text-4xl font-extrabold tracking-tight md:text-5xl">
          {formatCents(result.totals.upfrontCents)}
        </p>
        {/* Desglose visual del total: precio del coche + gastos asociados. Ayuda
            al usuario a separar el desembolso del vehículo de los costes
            derivados de importar/matricular/transportar. */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-sm tabular-nums text-white/85">
          <span>{formatCents(result.totals.upfrontCents - b.purchaseCents)}</span>
          <span className="text-[11px] uppercase tracking-wider text-white/55">gastos</span>
          <span className="text-white/45">+</span>
          <span>{formatCents(b.purchaseCents)}</span>
          <span className="text-[11px] uppercase tracking-wider text-white/55">precio coche</span>
          <span className="text-white/45">=</span>
          <strong className="font-display tracking-tight">
            {formatCents(result.totals.upfrontCents)}
          </strong>
        </div>
        <p className="mt-3 text-xs text-white/70">
          Incluye precio del coche, impuesto de matriculación (576), IVTM (impuesto de circulación,
          1ª anualidad), transporte, placas, ITV, tasas DGT y servicios opcionales seleccionados.
        </p>
      </div>

      {result.warnings.map((w) => (
        <div
          key={w}
          className="rounded-2xl border border-state-warning/40 bg-state-warning/5 p-4 text-sm text-state-warning"
        >
          <strong className="block text-brand-deep">⚠ Atención</strong>
          <span className="text-text-soft">{w}</span>
        </div>
      ))}

      <div className="rounded-2xl border border-border bg-white p-5 shadow-soft">
        <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted">Desglose</h3>
        <ul className="mt-3 grid gap-1 text-sm">
          <Row label="Precio del coche" value={b.purchaseCents} />
          {b.invoiceVatCents > 0 && (
            <Row
              label="IVA 21%"
              value={b.invoiceVatCents}
              sub="Calculado sobre el precio neto que has introducido (precio × 0,21)"
            />
          )}
          <Row
            label={`Transporte · ${b.transport.modeLabel}`}
            value={b.transport.cents}
            sub={b.transport.distanceKm > 0 ? `≈ ${b.transport.distanceKm} km` : "Misma provincia"}
          />
          <Row
            label={`Impuesto de matriculación (modelo 576) · ${formatRate(b.iedmt.rate)}`}
            value={b.iedmt.amountCents}
            sub={iedmtSubLabel(b.iedmt)}
          />
          {b.itp.applies && (
            <Row
              label={`ITP · ${formatRate(b.itp.rate)} (${b.itp.ccaaLabel})`}
              value={b.itp.amountCents}
              sub={
                b.itp.reason
                  ? b.itp.reason
                  : b.itp.amountCents > 0
                    ? `Base ${formatCents(b.itp.baseCents)} · compra entre particulares`
                    : "Compra entre particulares · sin tipo aplicable"
              }
            />
          )}
          <Row
            label="IVTM · Impuesto de circulación (1ª anualidad)"
            value={b.ivtmAnnualCents}
            sub="Cuota mínima estatal · cada ayuntamiento aplica coeficiente hasta 2x"
          />
          <Row label="Tasa matrículas verdes provisionales" value={b.greenPlatesFeeCents} />
          <Row
            label="Placas verdes provisionales"
            value={b.greenPlatesPhysicalCents}
            sub="Estimación · varía según el lugar de compra"
          />
          <Row label="Tasa DGT" value={b.dgtFeesCents} />
          <Row
            label="Placas definitivas"
            value={b.finalPlatesCents}
            sub="Estimación · varía según el lugar de compra"
          />
          <Row
            label="ITV de matriculación"
            value={b.regItvCents}
            sub="Estimación · varía según estación y localidad"
          />
          {b.inspectionCents > 0 && (
            <Row
              label="Revisión pre-compra"
              value={b.inspectionCents}
              sub="Estimación · varía según el profesional contratado"
            />
          )}
          {b.fichaReducidaCents > 0 && <Row label="Ficha reducida" value={b.fichaReducidaCents} />}
          {b.fullManagementCents > 0 && (
            <Row
              label="Gestión profesional llave en mano"
              value={b.fullManagementCents}
              sub="Estimación · varía según el profesional contratado"
            />
          )}
        </ul>
      </div>

      {/* CTAs principales: guardar el cálculo y/o pedir presupuesto.
          Encima de las notas legales para que el usuario vea primero
          la acción y luego el aviso normativo. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={pending}
          onClick={(e) => onSave(e)}
          className="inline-flex h-12 items-center justify-center rounded-full border border-border bg-white px-6 text-sm font-bold text-brand-deep hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Guardando…" : savedId ? "Guardado ✓" : "Guardar cálculo"}
        </button>
        <button
          type="button"
          onClick={onPublish}
          className="inline-flex h-12 items-center justify-center rounded-full bg-brand-accent px-6 text-sm font-extrabold text-white shadow-soft hover:bg-brand-primary"
        >
          Pedir presupuesto a importadores →
        </button>
      </div>

      {result.notes.length > 0 && (
        <div className="rounded-2xl border border-brand-soft/40 bg-brand-surface p-5 text-sm">
          <h4 className="text-xs font-bold uppercase tracking-widest text-brand-accent">
            Notas legales
          </h4>
          <ul className="mt-2 grid gap-2 text-xs text-text-soft">
            {result.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="text-brand-accent">(*)</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="rounded-lg border border-border bg-bg-subtle px-4 py-3 text-xs text-text-muted">
        Cifras orientativas basadas en la normativa estatal y rangos de precio de mercado a 2026. La
        calculadora no presta asesoramiento fiscal. Para más detalles, consulta con tu gestoría.
      </p>

      {persistError && (
        <div
          role="alert"
          className="rounded-lg border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
        >
          {persistError}
        </div>
      )}

      {needsAuth && (
        <div
          role="alert"
          className="rounded-lg border border-state-warning/30 bg-state-warning/5 px-4 py-3 text-sm text-text"
        >
          <strong className="block text-brand-deep">Inicia sesión para guardar tu cálculo</strong>
          <p className="mt-1 text-text-soft">
            No te preocupes — el cálculo queda guardado en este navegador y se persistirá
            automáticamente al iniciar sesión.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/login?next=${encodeURIComponent("/calculator?pending=1")}`}
              className="inline-flex h-10 items-center rounded-full bg-brand-deep px-4 text-xs font-bold text-white hover:bg-brand-primary"
            >
              Iniciar sesión
            </Link>
            <Link
              href={`/signup?next=${encodeURIComponent("/calculator?pending=1")}`}
              className="inline-flex h-10 items-center rounded-full border border-border bg-white px-4 text-xs font-bold text-brand-deep hover:bg-bg-subtle"
            >
              Crear cuenta gratis
            </Link>
          </div>
        </div>
      )}

      {savedId && isAuthenticated && (
        <Link
          href="/account/calculos"
          className="text-center text-sm font-semibold text-brand-accent hover:underline"
        >
          Ver en Mis cálculos →
        </Link>
      )}
    </div>
  );
}

// ─── ImportSummary ──────────────────────────────────────────────────────
// Resumen tipo "ficha" de los datos extraídos del anuncio. Aparece bajo
// el botón Importar para que el usuario vea de un golpe qué se rellenó
// (y qué no) antes de continuar con el resto del formulario.

// ─── ImportProgressBar ─────────────────────────────────────────────────
// Barra con 3 fases que da feedback durante la importación.
// El backend tarda 5-15 s típicos (ScrapingBee + parser + match BOE + IA).
// La barra es estimación temporal del cliente — no progreso real — pero
// los 3 mensajes calzan con las etapas reales: descarga → match → completo.

const PROGRESS_PHASES = [
  { atSec: 0, pct: 10, label: "Recopilando datos del anuncio…" },
  { atSec: 4, pct: 55, label: "En breves tendrás tus datos cargados…" },
  { atSec: 10, pct: 92, label: "Tus datos totalmente cargados, ya casi…" },
] as const;

// ─── InvoiceVatToggle ───────────────────────────────────────────────────
// Bloque para coches usados que no están en el BOE: input "Base para el
// impuesto de matriculación" con explicación inline sobre cuándo aplica
// IVA deducible (mobile.de/AutoScout) vs REBU. Las tarjetas anteriores
// se reemplazaron por texto narrativo más directo. El botón "i" abre el
// modal con capturas reales de cada caso.
function InvoiceVatToggle({
  iedmtBaseVal,
  setValue,
}: {
  iedmtBaseVal: number | undefined;
  setValue: ReturnType<typeof useForm<CalculatorFormValues>>["setValue"];
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  // El precio que el usuario mete aquí YA es la base imponible final;
  // forzamos el flag a false para que el engine no vuelva a restar IVA.
  useEffect(() => {
    setValue("invoiceHasDeductibleVat", false, { shouldValidate: true });
  }, [setValue]);
  return (
    <>
      <div>
        <Field label="Base para el impuesto de matriculación (€)">
          <div className="-mt-1 mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="Ver ejemplos de IVA deducible y REBU"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-brand-accent bg-brand-accent text-xs font-bold leading-none text-white shadow-sm transition-colors hover:border-brand-deep hover:bg-brand-deep focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
            >
              i
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="text-[11px] font-semibold text-brand-accent underline-offset-2 hover:underline"
            >
              Ver ejemplos con capturas reales
            </button>
          </div>
          <input
            type="number"
            step="100"
            inputMode="numeric"
            placeholder="Mete la cifra que aplica según tu caso"
            className={inputClass}
            value={iedmtBaseVal && iedmtBaseVal > 0 ? iedmtBaseVal : ""}
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              setValue("iedmtBaseEur", Number.isFinite(v) ? v : undefined, {
                shouldValidate: true,
              });
            }}
          />
          <div className="mt-3 grid gap-2 rounded-xl border border-border bg-bg-subtle/60 p-4 text-xs text-text-soft">
            <p>
              Si tu vehículo se vende con <strong className="text-brand-deep">IVA deducible</strong>
              , verás dos precios en el anuncio de{" "}
              <strong className="text-brand-deep">mobile.de</strong> — coge el{" "}
              <strong>menor</strong> para rellenar este campo. En{" "}
              <strong className="text-brand-deep">AutoScout</strong> verás un solo precio con
              subíndice <strong>¹</strong> o la etiqueta <strong>&quot;IVA deducible&quot;</strong>;
              en tal caso divide el precio entre el IVA del país de venta (Alemania 1,19 · Bélgica
              1,21 · Francia 1,20…) para obtener el valor neto y mete ese aquí.
            </p>
            <p>
              Si es <strong className="text-brand-deep">REBU</strong> el IVA no es deducible y verás
              un solo precio en el anuncio: cógelo tal cual y mételo aquí.
            </p>
          </div>
        </Field>
      </div>
      {helpOpen && <InvoiceHelpModal onClose={() => setHelpOpen(false)} />}
    </>
  );
}

// ─── InvoiceHelpModal ─────────────────────────────────────────────────
// Modal explicativo con capturas reales de mobile.de mostrando los dos
// formatos en los que un anuncio publica el IVA deducible (precio con
// superíndice ¹ o desglose Netto/MwSt.) y el caso REBU (precio único).
function InvoiceHelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-brand-deep/40 p-4 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-help-title"
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:bg-bg-subtle hover:text-brand-deep"
        >
          ✕
        </button>
        <h3
          id="invoice-help-title"
          className="pr-10 font-display text-xl font-extrabold tracking-tight text-brand-deep"
        >
          ¿IVA deducible o REBU? Cómo distinguirlos
        </h3>
        <p className="mt-2 text-sm text-text-soft">
          Mira el bloque de precio del anuncio. Según cómo aparezca, tu factura será de un tipo u
          otro:
        </p>

        <div className="mt-6 grid gap-6">
          {/* REBU — un solo precio (mobile.de + AutoScout24) */}
          <section className="rounded-xl border border-state-warning/30 bg-state-warning/5 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-state-warning/15 px-3 py-1 text-sm font-extrabold uppercase tracking-wider text-state-warning">
                REBU
              </span>
              <h4 className="font-display text-base font-bold text-brand-deep">
                Un único precio, sin desglose de IVA
              </h4>
            </div>
            <p className="mt-2 text-sm text-text-soft">
              <strong>Régimen Especial de Bienes Usados</strong> (Art. 135-139 Ley 37/1992). El
              vendedor es un comerciante profesional que ha comprado el coche a un particular, lo
              revende y tributa <strong>sólo por el margen</strong>. Por eso la factura{" "}
              <strong>no lleva IVA visible</strong> y, para el comprador,{" "}
              <strong>no es deducible</strong>.
            </p>
            <p className="mt-2 text-sm text-text-soft">
              <strong>Cómo identificarlo:</strong> el anuncio muestra{" "}
              <strong>un único precio</strong>, sin &quot;Netto/Brutto&quot;, sin superíndice ¹, sin
              &quot;MwSt./TVA&quot;. Ese precio es directamente la base imponible —{" "}
              <strong>mételo tal cual</strong> en el campo &quot;Precio del coche&quot;.
            </p>

            <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
              {/* mobile.de — BMW M2 (single price con "Guter Preis") */}
              <div className="rounded-lg border border-border bg-white p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Image
                    src="/calculator/logo-mobile-de.png"
                    alt="mobile.de"
                    width={120}
                    height={28}
                    className="h-5 w-auto"
                  />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    Alemania
                  </span>
                </div>
                <Image
                  src="/calculator/factura-rebu.png"
                  alt="mobile.de · BMW M2 a 62.990 € — precio único, sin desglose de IVA"
                  width={400}
                  height={240}
                  className="w-full rounded border border-border bg-white"
                />
                <p className="mt-2 text-xs text-text-soft">
                  Sólo aparece <strong>62.990 €</strong>. No hay &quot;Netto&quot;, no hay
                  &quot;MwSt.&quot; — REBU.
                </p>
              </div>

              {/* AutoScout24 — VW Polo (precio único sin superíndice) */}
              <div className="rounded-lg border border-border bg-white p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex items-baseline rounded font-display text-sm font-extrabold leading-none tracking-tight">
                    <span className="bg-[#f5f200] px-1 text-[#1f1f1f]">Auto</span>
                    <span className="px-0.5 text-[#1f1f1f]">Scout24</span>
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    España
                  </span>
                </div>
                <Image
                  src="/calculator/factura-rebu-autoscout.png"
                  alt="AutoScout24 · VW Polo a 17.990 € — precio único, sin superíndice ¹"
                  width={400}
                  height={240}
                  className="w-full rounded border border-border bg-white"
                />
                <p className="mt-2 text-xs text-text-soft">
                  Sólo aparece <strong>17.990 €</strong>, sin <strong>¹</strong> ni
                  &quot;+IVA&quot;. REBU.
                </p>
              </div>
            </div>
          </section>

          {/* IVA deducible — variante mobile.de (desglose Netto) */}
          {/* Usamos la captura anotada (círculo rojo + flecha) directamente,
              en vez de overlay SVG: queda pixel-perfect porque las marcas
              están grabadas en el PNG. El callout va a la derecha en md+. */}
          <section className="rounded-xl border border-brand-accent/30 bg-brand-surface/40 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Image
                src="/calculator/logo-mobile-de.png"
                alt="mobile.de"
                width={120}
                height={28}
                className="h-6 w-auto"
              />
              <span className="rounded-full bg-brand-accent/15 px-3 py-1 text-sm font-extrabold uppercase tracking-wider text-brand-accent">
                IVA deducible
              </span>
              <h4 className="font-display text-base font-bold text-brand-deep">
                Dos precios visibles (Netto + bruto)
              </h4>
            </div>
            <p className="mt-2 text-sm text-text-soft">
              Bajo el precio grande aparece el desglose: <em>201.597 € (Netto), 19% MwSt.</em> — el
              grande es con IVA, el menor es la base sin IVA (&quot;Netto&quot;). Da igual el % del
              país (19% en Alemania, 21% en España…): siempre se mete el{" "}
              <strong>precio menor</strong>.
            </p>
            <div className="mt-3 grid items-center gap-4 md:grid-cols-[1.4fr_1fr]">
              <Image
                src="/calculator/factura-iva-netto-anotada.png"
                alt="mobile.de · 239.900 € con base 201.597 € (Netto) — círculo rojo sobre el precio menor"
                width={520}
                height={361}
                className="w-full rounded-lg border border-border bg-white"
              />
              <div className="md:pl-2">
                {/* Precio destacado en grande para que el usuario vea de un
                    golpe qué importe es el que tiene que meter en el campo. */}
                <span className="block font-display text-3xl font-extrabold tabular-nums text-state-error md:text-4xl">
                  201.597 €
                </span>
                <strong className="mt-2 block text-base text-state-error">PRECIO NETO</strong>
                <span className="text-sm text-text-soft">(Precio a usar en este campo)</span>
              </div>
            </div>
          </section>

          {/* IVA deducible — variante AutoScout24 (superíndice ¹) */}
          <section className="rounded-xl border border-brand-accent/30 bg-brand-surface/40 p-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Wordmark "Auto Scout 24" (Auto en amarillo + Scout24 en
                  negro), fiel al branding sin depender del SVG inverse. */}
              <span className="inline-flex items-baseline rounded font-display text-base font-extrabold leading-none tracking-tight">
                <span className="bg-[#f5f200] px-1 text-[#1f1f1f]">Auto</span>
                <span className="px-0.5 text-[#1f1f1f]">Scout24</span>
              </span>
              <span className="rounded-full bg-brand-accent/15 px-3 py-1 text-sm font-extrabold uppercase tracking-wider text-brand-accent">
                IVA deducible
              </span>
              <h4 className="font-display text-base font-bold text-brand-deep">
                Precio con superíndice ¹
              </h4>
            </div>
            <p className="mt-2 text-sm text-text-soft">
              El precio principal lleva un pequeño <strong>¹</strong> al lado (a veces un{" "}
              <strong>1</strong> en superíndice). Eso indica que es <strong>con IVA</strong> y que
              existe una base sin IVA detrás. Hay que <strong>dividir el precio bruto</strong> entre
              el IVA del país del vendedor para obtener la base.
            </p>
            <div className="mt-3 grid items-center gap-4 md:grid-cols-[1.4fr_1fr]">
              <Image
                src="/calculator/factura-iva-superindice-anotada.png"
                alt="AutoScout24 · 179.000 € con superíndice ¹ — flecha apuntando al cálculo"
                width={520}
                height={361}
                className="w-full rounded-lg border border-border bg-white"
              />
              <div className="md:pl-2">
                <p className="text-sm text-brand-deep">
                  Selecciona el precio <strong>BRUTO</strong> y divídelo entre el IVA del país del
                  vendedor.
                </p>
                <p className="mt-3 text-sm">
                  <strong className="text-brand-deep">Ej · Alemania (19%)</strong>
                </p>
                <p className="mt-1 font-mono text-sm tabular-nums text-brand-deep">
                  179.000 € ÷ 1,19 =
                </p>
                {/* Resultado destacado en tamaño grande, mismo tratamiento
                    que el "201.597 €" de la card de mobile.de. */}
                <span className="mt-1 block font-display text-2xl font-extrabold tabular-nums text-state-error md:text-3xl">
                  150.420,17 €
                </span>
                <strong className="mt-3 block text-base text-state-error">PRECIO NETO</strong>
                <span className="text-sm text-text-soft">(Precio a usar en este campo)</span>
                <p className="mt-3 text-xs text-text-muted">
                  Italia /1,22 · Francia /1,20 · España /1,21 · Portugal /1,23 · Bélgica /1,21 ·
                  Holanda /1,21 · Polonia /1,23 · Dinamarca /1,25 · Suecia /1,25
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-full bg-brand-deep px-5 text-sm font-bold text-white hover:bg-brand-primary"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportProgressBar() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const iv = setInterval(() => {
      setElapsed((Date.now() - start) / 1000);
    }, 100);
    return () => clearInterval(iv);
  }, []);
  // Crecimiento continuo (no escalonado): pct interpolado entre las fases
  // para que la barra avance siempre, no a saltos cada 4 s.
  const targetPct = (() => {
    if (elapsed <= 0) return 5;
    const phases = PROGRESS_PHASES;
    for (let i = 0; i < phases.length - 1; i++) {
      const a = phases[i];
      const b = phases[i + 1];
      if (a && b && elapsed >= a.atSec && elapsed < b.atSec) {
        const t = (elapsed - a.atSec) / (b.atSec - a.atSec);
        return a.pct + (b.pct - a.pct) * t;
      }
    }
    return phases[phases.length - 1]?.pct ?? 95;
  })();
  const label =
    [...PROGRESS_PHASES].reverse().find((p) => elapsed >= p.atSec)?.label ??
    PROGRESS_PHASES[0].label;
  return (
    <div className="mt-3" role="status" aria-live="polite">
      <div className="relative h-2 overflow-hidden rounded-full bg-bg-subtle">
        <div
          className="h-full rounded-full bg-brand-accent transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.min(95, targetPct)}%` }}
        />
        {/* shimmer: barra blanca translúcida cruzando la zona ya cubierta
            para que el ojo perciba movimiento continuo aunque el width
            apenas crezca entre actualizaciones. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -translate-x-full animate-[loading-bar_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent"
          style={{ animationName: "loading-bar" }}
        />
      </div>
      <p className="mt-2 text-xs text-text-soft">{label}</p>
    </div>
  );
}

const FUEL_LABELS_ES: Record<NonNullable<AdData["fuelType"]>, string> = {
  gasolina: "Gasolina",
  diesel: "Diésel",
  electrico: "Eléctrico",
  hibrido: "Híbrido",
  gas: "Gas / GLP / CNG",
};

const SELLER_LABELS_ES: Record<NonNullable<AdData["sellerType"]>, string> = {
  professional: "Profesional",
  particular: "Particular",
};

function ImportSummary({
  imported,
}: {
  imported: { data: AdData; sourceHost: string; boeMatch: BoeMatch | null };
}) {
  const { data: d, boeMatch: m } = imported;

  // Título grande: si hay match BOE, el modelo oficial. Si no, lo del anuncio.
  const headline = m
    ? `${m.model}${m.variant ? ` · ${m.variant}` : ""}`
    : d.make && d.model
      ? `${d.make} ${d.model}${d.variant ? ` · ${d.variant}` : ""}`
      : "Coche importado";

  // Solo filas con valor — ocultamos los "—" para no llenar de huecos.
  const rawRows: Array<{ label: string; value: string | null; numeric?: boolean }> = [
    {
      label: "Precio anuncio",
      value: d.priceEur != null ? formatCents(d.priceEur * 100) : null,
      numeric: true,
    },
    {
      label: "Valor venal BOE",
      value: m && m.confidence !== "low" ? formatCents(m.baseValueEur * 100) : null,
      numeric: true,
    },
    {
      label: "Potencia",
      value: m ? `${m.cv} CV` : d.cv != null ? `${d.cv} CV` : null,
      numeric: true,
    },
    { label: "CVF", value: m ? `${m.cvf}` : null, numeric: true },
    {
      label: "Cilindrada",
      value: d.engineCc != null ? `${d.engineCc} cc` : null,
      numeric: true,
    },
    {
      label: "CO₂",
      value: d.co2Gkm != null ? `${Math.round(d.co2Gkm)} g/km` : null,
      numeric: true,
    },
    { label: "Matriculación", value: d.firstRegDate ?? null },
    {
      label: "Kilómetros",
      value: d.kilometers != null ? `${d.kilometers.toLocaleString("es-ES")} km` : null,
      numeric: true,
    },
    { label: "Combustible", value: d.fuelType ? FUEL_LABELS_ES[d.fuelType] : null },
    { label: "Vendedor", value: d.sellerType ? SELLER_LABELS_ES[d.sellerType] : null },
    {
      label: "Factura",
      value:
        d.invoiceRegime === "deductible_vat"
          ? `IVA deducible${d.vatRate != null ? ` · ${Math.round(d.vatRate * 100)}%` : ""}`
          : d.invoiceRegime === "rebu"
            ? "REBU"
            : null,
    },
  ];
  const rows = rawRows.filter((r) => r.value != null);

  const matchTag =
    m && m.confidence !== "low"
      ? { label: "Encontrado en BOE", tone: "good" as const }
      : m
        ? { label: "Match BOE incierto", tone: "warn" as const }
        : { label: "No en BOE — fórmula sobre factura", tone: "neutral" as const };

  const tagClass =
    matchTag.tone === "good"
      ? "bg-state-success/10 text-state-success"
      : matchTag.tone === "warn"
        ? "bg-state-warning/15 text-state-warning"
        : "bg-bg-subtle text-text-soft";

  return (
    <div className="mt-3 rounded-xl border border-state-success/30 bg-state-success/5 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-4 w-4 flex-none text-state-success"
          aria-hidden
        >
          <path
            d="m5 12 4 4 10-10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h4 className="font-display text-base font-extrabold leading-tight text-brand-deep">
          {headline}
        </h4>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tagClass}`}
        >
          {matchTag.label}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2 py-0.5">
            <dt className="text-[11px] text-text-soft">{r.label}</dt>
            <dd
              className={`text-xs font-semibold text-brand-deep ${r.numeric ? "tabular-nums" : ""}`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <div className="mt-2">{children}</div>
      {error ? (
        <span className="mt-1 block text-xs text-state-error">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

function YesNoField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-bg-subtle px-4 py-3">
      <span className="text-sm font-semibold text-brand-deep">{label}</span>
      <div className="inline-flex rounded-full bg-white p-0.5 ring-1 ring-border">
        <button
          type="button"
          onClick={() => onChange(false)}
          className={[
            "h-8 rounded-full px-4 text-xs font-bold transition-colors",
            !value ? "bg-brand-deep text-white" : "text-text-soft hover:text-text",
          ].join(" ")}
        >
          No
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          className={[
            "h-8 rounded-full px-4 text-xs font-bold transition-colors",
            value ? "bg-brand-accent text-white" : "text-text-soft hover:text-text",
          ].join(" ")}
        >
          Sí
        </button>
      </div>
    </div>
  );
}

function ServiceToggle({
  label,
  price,
  checked,
  onChange,
}: {
  label: string;
  price: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-bg-subtle px-4 py-3 hover:bg-brand-surface">
      <div className="flex min-w-0 items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-5 w-5 flex-none rounded border-border text-brand-accent focus:ring-brand-accent/40"
        />
        <span className="min-w-0 text-sm font-semibold text-brand-deep">{label}</span>
      </div>
      <span className="flex-none text-xs font-bold text-brand-accent">{price}</span>
    </label>
  );
}

/** Subtítulo minimal del modelo en el dropdown: año(s) + CV. */
function formatModelSub(m: BoeModel): string {
  const parts: string[] = [];
  if (m.variant) {
    const years = m.variant.split("/")[0];
    if (years) parts.push(years);
  }
  if (m.cv) parts.push(`${m.cv} CV`);
  return parts.join(" · ");
}

function formatRate(rate: number): string {
  const pct = rate * 100;
  return `${pct.toLocaleString("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

/**
 * Matching de modelos. Tratamos toda la query como una sola cadena
 * concatenada (sin espacios, guiones, puntos…) y la buscamos como
 * substring en el `label` igualmente normalizado. Esto evita que
 * tokens cortos como "40i" matcheen "740i"/"840i" cuando el usuario
 * en realidad estaba escribiendo "m4 40i" o "m440i".
 *
 * Tolerancia BMW: el BOE lista algunas versiones M-Performance sin
 * la "M" inicial (p. ej. "340iA xDrive" en lugar de "M340iA xDrive").
 * Si la query empieza por "m" + dígito, probamos también la query sin
 * la M, pero solo cuando lo que queda tiene al menos 3 caracteres,
 * para que "m4" no se degrade a "4" y matchee cualquier 7/8/X40i.
 */
function fuzzyMatch(query: string, label: string): boolean {
  const concat = normalize(query);
  if (!concat) return true;
  if (concat.length < 2) return false;
  const haystack = normalize(label);
  if (haystack.includes(concat)) return true;
  if (/^m\d/.test(concat)) {
    const stripped = concat.slice(1);
    if (stripped.length >= 3 && haystack.includes(stripped)) return true;
  }
  return false;
}

function matchScore(query: string, label: string): number {
  const q = normalize(query);
  const l = normalize(label);
  if (!q) return 0;
  if (l.startsWith(q)) return 0;
  const idx = l.indexOf(q);
  if (idx >= 0) return idx + 1;
  if (/^m\d/.test(q)) {
    const stripped = q.slice(1);
    if (stripped.length >= 3) {
      if (l.startsWith(stripped)) return 100;
      const idx2 = l.indexOf(stripped);
      if (idx2 >= 0) return idx2 + 101;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-./_]+/g, "");
}

type ComboboxItem<T = unknown> = {
  id: string;
  label: string;
  sub?: string;
  right?: string;
  payload?: T;
};

function Combobox<T = unknown>({
  label,
  placeholder,
  value,
  options,
  onPick,
  error,
  disabled,
  loading,
  emptyLabel,
  onEmptyClick,
}: {
  label: string;
  placeholder: string;
  value: string | undefined;
  options: ComboboxItem<T>[];
  onPick: (id: string, item?: ComboboxItem<T>) => void;
  error?: string;
  disabled?: boolean;
  loading?: boolean;
  emptyLabel: string;
  onEmptyClick: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setQuery(value ?? "");
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return options.slice(0, 200);
    const matches = options.filter((o) => fuzzyMatch(q, o.label));
    return matches.sort((a, b) => matchScore(q, a.label) - matchScore(q, b.label));
  }, [query, options]);

  return (
    <div ref={wrapRef} className="relative">
      <span className={labelClass}>{label}</span>
      <div className="relative mt-2">
        <span
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="m20 20-3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <input
          type="text"
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = filtered[0];
              if (first) {
                onPick(first.id, first);
                setQuery(first.label);
                setOpen(false);
              }
            }
          }}
          className={`${inputClass} pl-10 ${loading ? "pr-10" : ""} disabled:cursor-not-allowed disabled:opacity-60`}
        />
        {loading && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
          >
            <svg className="h-4 w-4 animate-spin text-brand-accent" viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="2.5"
                opacity="0.25"
              />
              <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
        )}
      </div>
      {open && !disabled && loading && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-border bg-white p-3 shadow-elevated">
          <li className="flex items-center gap-2 px-1 py-1 text-sm text-text-soft">
            <svg className="h-4 w-4 animate-spin text-brand-accent" viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="2.5"
                opacity="0.25"
              />
              <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <span>Cargando modelos…</span>
          </li>
        </ul>
      )}
      {open && !disabled && !loading && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-elevated">
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(item.id, item);
                  setQuery(item.label);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-bg-subtle"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-brand-deep">{item.label}</span>
                  {item.sub && (
                    <span className="block truncate text-[11px] text-text-muted">{item.sub}</span>
                  )}
                </div>
                {item.right && (
                  <span className="flex-none whitespace-nowrap pt-0.5 text-xs font-bold text-brand-accent">
                    {item.right}
                  </span>
                )}
              </button>
            </li>
          ))}
          <li className="border-t border-border">
            <button
              type="button"
              onClick={() => {
                onEmptyClick();
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-bg-subtle"
            >
              <span className="font-semibold text-brand-accent">{emptyLabel} →</span>
              <span className="text-[11px] text-text-muted">Introducir manualmente</span>
            </button>
          </li>
        </ul>
      )}
      {error && <span className="mt-1 block text-xs text-state-error">{error}</span>}
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg px-1 py-2 hover:bg-bg-subtle">
      <div className="min-w-0">
        <span className="block truncate font-semibold text-brand-deep">{label}</span>
        {sub && <span className="mt-0.5 block text-[11px] text-text-muted">{sub}</span>}
      </div>
      <span
        className={`flex-none font-mono tabular-nums ${value === 0 ? "text-text-muted" : "text-brand-deep"}`}
      >
        {value === 0 ? "—" : formatCents(value)}
      </span>
    </li>
  );
}
