// The proxy handler: receives an agent's call, forwards it to the
// provider's real endpoint, judges the response structurally, and hands
// the outcome to SettlementService. This is the only module that does the
// actual network fetch — structural-check.ts stays pure and untestable-free
// of I/O on purpose.

import { checkStructuralValidity } from "./structural-check.js";
import type { SettlementService, CallRecord } from "../settlement/service.js";

export const PROVIDER_TIMEOUT_MS = 30_000; // flat 30s, v0

export interface ProviderRecord {
  id: string;
  endpointUrl: string;
  priceUsdc: number;
  outputSchema: Record<string, unknown>;
}

// Minimal persistence port needed here — creating the initial call row
// happens before we know pass/fail, since we need a callId to hand to
// SettlementService.recordStructuralCheck.
export interface CallCreator {
  createCall(input: {
    developerId: string;
    providerId: string;
    requestPayload: Record<string, unknown>;
    priceUsdc: number;
  }): Promise<{ id: string }>;

  saveResponsePayload(callId: string, responsePayload: unknown): Promise<void>;
}

export interface ProxyCallInput {
  developerId: string;
  provider: ProviderRecord;
  requestPayload: Record<string, unknown>;
}

export interface ProxyCallResult {
  call: CallRecord;
  responseBody: unknown | null; // null if structural check failed — nothing to hand back
}

/**
 * Forwards a request to a provider's real endpoint with a hard timeout,
 * then judges the result structurally and drives the settlement state
 * machine. Returns immediately after the structural verdict — the 1hr
 * hold window and eventual settle/refund happen asynchronously elsewhere.
 */
export async function proxyCall(
  input: ProxyCallInput,
  deps: { callCreator: CallCreator; settlement: SettlementService; fetchFn?: typeof fetch },
): Promise<ProxyCallResult> {
  const fetchFn = deps.fetchFn ?? fetch;

  const call = await deps.callCreator.createCall({
    developerId: input.developerId,
    providerId: input.provider.id,
    requestPayload: input.requestPayload,
    priceUsdc: input.provider.priceUsdc,
  });

  const { httpStatus, rawBody, timedOut } = await forwardRequest(
    fetchFn,
    input.provider.endpointUrl,
    input.requestPayload,
  );

  const checkResult = checkStructuralValidity({
    timedOut,
    httpStatus,
    rawBody,
    outputSchema: input.provider.outputSchema,
  });

  const updatedCall = await deps.settlement.recordStructuralCheck(
    call.id,
    checkResult.passed,
  );

  let responseBody: unknown | null = null;
  if (checkResult.passed) {
    responseBody = JSON.parse(rawBody as string); // safe: checkStructuralValidity already validated it parses
    await deps.callCreator.saveResponsePayload(call.id, responseBody);
  }

  return { call: updatedCall, responseBody };
}

async function forwardRequest(
  fetchFn: typeof fetch,
  endpointUrl: string,
  payload: Record<string, unknown>,
): Promise<{ httpStatus: number | null; rawBody: string | null; timedOut: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const res = await fetchFn(endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const rawBody = await res.text();
    return { httpStatus: res.status, rawBody, timedOut: false };
  } catch (err) {
    if (controller.signal.aborted) {
      return { httpStatus: null, rawBody: null, timedOut: true };
    }
    // network error, DNS failure, connection refused, etc. — treated the
    // same as a server error, not a timeout, since it wasn't our clock
    return { httpStatus: null, rawBody: null, timedOut: false };
  } finally {
    clearTimeout(timer);
  }
}
