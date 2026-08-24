// Real implementation of the two ports the settlement and proxy modules
// were built and tested against fakes for: CallRepository (settlement)
// and CallCreator (proxy). One class implements both since they both
// operate on the same `calls` table — no reason to split them into two
// DB-touching classes when the interfaces don't conflict.
//
// NOT UNIT TESTED — this needs a live Postgres connection to mean
// anything, same treatment as every other real-I/O module. The logic
// this wraps (transition rules, structural checks) is already fully
// tested against fakes; this class only has to correctly persist/read
// what those already-correct decisions produce.

import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { calls, disputes } from "../db/schema.js";
import type { CallRecord, CallRepository } from "../settlement/service.js";
import type { CallCreator } from "../proxy/handler.js";

export class PostgresCallStore implements CallRepository, CallCreator {
  constructor(private readonly db: Database) {}

  // ---- CallRepository (settlement) ----

  async getById(callId: string): Promise<CallRecord | null> {
    const [row] = await this.db.select().from(calls).where(eq(calls.id, callId));
    if (!row) return null;
    return {
      id: row.id,
      developerId: row.developerId,
      providerId: row.providerId,
      priceUsdc: Number(row.priceUsdc),
      status: row.status,
      holdExpiresAt: row.holdExpiresAt,
    };
  }

  async save(call: CallRecord): Promise<void> {
    // Only status and holdExpiresAt actually change after a call is
    // created — id/developerId/providerId/priceUsdc are immutable
    // history, so this intentionally only ever updates those two columns.
    await this.db
      .update(calls)
      .set({ status: call.status, holdExpiresAt: call.holdExpiresAt })
      .where(eq(calls.id, call.id));
  }

  async createDispute(input: {
    callId: string;
    developerId: string;
    reason: string;
  }): Promise<void> {
    await this.db.insert(disputes).values({
      callId: input.callId,
      developerId: input.developerId,
      reason: input.reason,
    });
  }

  // ---- CallCreator (proxy) ----

  async createCall(input: {
    developerId: string;
    providerId: string;
    requestPayload: Record<string, unknown>;
    priceUsdc: number;
  }): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(calls)
      .values({
        developerId: input.developerId,
        providerId: input.providerId,
        requestPayload: input.requestPayload,
        priceUsdc: input.priceUsdc.toString(), // numeric columns take string input in Drizzle
        status: "authorized",
      })
      .returning({ id: calls.id });
    return { id: row.id };
  }

  async saveResponsePayload(callId: string, responsePayload: unknown): Promise<void> {
    await this.db
      .update(calls)
      .set({ responsePayload: responsePayload as object })
      .where(eq(calls.id, callId));
  }

  /**
   * Not part of either fake-tested interface — added directly against the
   * real schema now that response_latency_ms exists as a column. Call
   * this from the proxy handler once it's updated to measure elapsed
   * time; until that wiring happens this column stays null for every row.
   */
  async recordLatency(callId: string, latencyMs: number): Promise<void> {
    await this.db
      .update(calls)
      .set({ responseLatencyMs: latencyMs })
      .where(eq(calls.id, callId));
  }
}
