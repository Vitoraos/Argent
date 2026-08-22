import { describe, it, expect, vi } from "vitest";
import { proxyCall, type CallCreator, type ProviderRecord } from "../proxy/handler.js";
import { SettlementService, type CallRecord, type CallRepository } from "../settlement/service.js";
const SCHEMA = {
  type: "object",
  properties: { lat: { type: "number" }, lng: { type: "number" } },
  required: ["lat", "lng"],
};

const PROVIDER: ProviderRecord = {
  id: "prov-1",
  endpointUrl: "https://example.com/geocode",
  priceUsdc: 0.002,
  outputSchema: SCHEMA,
};

// Fake settlement repo (same as settlement service tests)
class FakeCallRepository implements CallRepository {
  calls = new Map<string, CallRecord>();
  disputes: unknown[] = [];
  async getById(id: string) { return this.calls.get(id) ?? null; }
  async save(call: CallRecord) { this.calls.set(call.id, call); }
  async createDispute(input: any) { this.disputes.push(input); }
}

// Fake call creator — simulates the DB insert that happens before we know pass/fail
class FakeCallCreator implements CallCreator {
  nextId = 1;
  savedResponses = new Map<string, unknown>();
  constructor(private repo: FakeCallRepository) {}

  async createCall(input: {
    developerId: string;
    providerId: string;
    requestPayload: Record<string, unknown>;
    priceUsdc: number;
  }) {
    const id = `call-${this.nextId++}`;
    this.repo.calls.set(id, {
      id,
      developerId: input.developerId,
      providerId: input.providerId,
      priceUsdc: input.priceUsdc,
      status: "authorized",
      holdExpiresAt: null,
    });
    return { id };
  }

  async saveResponsePayload(callId: string, responsePayload: unknown) {
    this.savedResponses.set(callId, responsePayload);
  }
}

function fakeFetch(response: { status: number; body: string; delayMs?: number; networkError?: boolean }) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (response.networkError) throw new Error("network error");
    if (response.delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, response.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    return {
      status: response.status,
      text: async () => response.body,
    } as Response;
  });
}

describe("proxyCall", () => {
  it("passes structural check, holds the call, and returns the response body", async () => {
    const repo = new FakeCallRepository();
    const settlement = new SettlementService(repo);
    const callCreator = new FakeCallCreator(repo);
    const fetchFn = fakeFetch({ status: 200, body: JSON.stringify({ lat: 6.34, lng: 5.63 }) });

    const result = await proxyCall(
      { developerId: "dev-1", provider: PROVIDER, requestPayload: { address: "123 Main St" } },
      { callCreator, settlement, fetchFn },
    );

    expect(result.call.status).toBe("held");
    expect(result.call.holdExpiresAt).not.toBeNull();
    expect(result.responseBody).toEqual({ lat: 6.34, lng: 5.63 });
  });

  it("rejects the call on 5xx and returns no response body", async () => {
    const repo = new FakeCallRepository();
    const settlement = new SettlementService(repo);
    const callCreator = new FakeCallCreator(repo);
    const fetchFn = fakeFetch({ status: 503, body: "" });

    const result = await proxyCall(
      { developerId: "dev-1", provider: PROVIDER, requestPayload: {} },
      { callCreator, settlement, fetchFn },
    );

    expect(result.call.status).toBe("rejected");
    expect(result.call.holdExpiresAt).toBeNull();
    expect(result.responseBody).toBeNull();
  });

  it("rejects on schema mismatch even with a 200 status", async () => {
    const repo = new FakeCallRepository();
    const settlement = new SettlementService(repo);
    const callCreator = new FakeCallCreator(repo);
    const fetchFn = fakeFetch({ status: 200, body: JSON.stringify({ lat: "oops" }) });

    const result = await proxyCall(
      { developerId: "dev-1", provider: PROVIDER, requestPayload: {} },
      { callCreator, settlement, fetchFn },
    );

    expect(result.call.status).toBe("rejected");
  });

  it("rejects when the provider exceeds the timeout", async () => {
    vi.useFakeTimers(); // must be enabled BEFORE proxyCall schedules its abort timer

    const repo = new FakeCallRepository();
    const settlement = new SettlementService(repo);
    const callCreator = new FakeCallCreator(repo);
    // fetch hangs forever until the AbortController fires
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }) as Promise<Response>;
    });

    const proxyPromise = proxyCall(
      { developerId: "dev-1", provider: PROVIDER, requestPayload: {} },
      { callCreator, settlement, fetchFn },
    );

    await vi.advanceTimersByTimeAsync(30_001);
    const result = await proxyPromise;
    vi.useRealTimers();

    expect(result.call.status).toBe("rejected");
    expect(result.responseBody).toBeNull();
  });

  it("saves the response payload via callCreator on success", async () => {
    const repo = new FakeCallRepository();
    const settlement = new SettlementService(repo);
    const callCreator = new FakeCallCreator(repo);
    const fetchFn = fakeFetch({ status: 200, body: JSON.stringify({ lat: 1, lng: 2 }) });

    const result = await proxyCall(
      { developerId: "dev-1", provider: PROVIDER, requestPayload: {} },
      { callCreator, settlement, fetchFn },
    );

    expect(callCreator.savedResponses.get(result.call.id)).toEqual({ lat: 1, lng: 2 });
  });
});
