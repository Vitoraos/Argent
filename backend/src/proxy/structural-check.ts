// Pure structural validation of a provider's response. No fetch, no
// timers here — this just judges a response that's already been received
// (or a timeout that's already happened). The proxy handler is responsible
// for the actual network call; this module only judges the outcome.

import Ajv, { type ValidateFunction } from "ajv";

const ajv = new Ajv({ allErrors: true, strict: false });

export type StructuralCheckReason =
  | "timeout"
  | "server_error"
  | "empty_response"
  | "invalid_json"
  | "schema_mismatch";

export type StructuralCheckResult =
  | { passed: true }
  | { passed: false; reason: StructuralCheckReason; details?: unknown };

export interface StructuralCheckInput {
  timedOut: boolean;
  httpStatus: number | null; // null if the request never completed (e.g. network error)
  rawBody: string | null;
  outputSchema: Record<string, unknown>;
}

/**
 * Judges whether a provider's response counts as a structurally valid call
 * worth paying for. Deliberately narrow scope: this catches obvious,
 * mechanical failures (timeout, 5xx, malformed/empty body, schema
 * mismatch) — it does NOT and cannot judge semantic correctness. That's
 * handled by the settlement hold window + developer dispute flag, not here.
 */
export function checkStructuralValidity(
  input: StructuralCheckInput,
): StructuralCheckResult {
  if (input.timedOut) {
    return { passed: false, reason: "timeout" };
  }

  if (input.httpStatus === null || input.httpStatus >= 500) {
    return { passed: false, reason: "server_error", details: { httpStatus: input.httpStatus } };
  }

  if (!input.rawBody || input.rawBody.trim().length === 0) {
    return { passed: false, reason: "empty_response" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { passed: false, reason: "invalid_json" };
  }

  const validate: ValidateFunction = ajv.compile(input.outputSchema);
  const isValid = validate(parsed);

  if (!isValid) {
    return { passed: false, reason: "schema_mismatch", details: validate.errors };
  }

  return { passed: true };
}
