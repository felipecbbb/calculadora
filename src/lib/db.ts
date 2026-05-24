import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
}

// Singleton vía globalThis: en dev Next hace HMR del módulo pero
// globalThis persiste, así que reutilizamos la misma conexión a Postgres
// en cada reload en vez de abrir una nueva (Supabase tiene un pool limitado).
export const db =
  global.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = db;
}
