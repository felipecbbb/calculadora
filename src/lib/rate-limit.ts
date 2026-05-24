import "server-only";

// Stub minimalista: en este repo de testing no usamos rate limiting.
// Las server actions devuelven `allowed: true` siempre.
export type RateLimitPreset =
  | "auth.login"
  | "auth.signup"
  | "auth.forgot"
  | "calc.extractAd"
  | "calc.transport"
  | "ai.generic";

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number; reason: string };

export async function rateLimit(
  _preset: RateLimitPreset,
  _identifier?: string,
): Promise<RateLimitResult> {
  return { allowed: true };
}
