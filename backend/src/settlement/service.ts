// Orchestrates the pure state machine against persisted call records.
// Depends only on the CallRepository port below — no direct Postgres/pg-boss
// import here, so this whole module runs under vitest with an in-memory fake.

import { transition, type CallStatus } from "./state-machine.js";

export const HOLD_WINDOW_MS = 60 * 60 * 1000; // 1 hour, flat, v0

export interface CallRecord {
  id: string;
  developerId: string;
  providerId: string;
  priceUsdc: number;
  status: CallStatus;
  holdExpiresAt: Date | null;
}

// The persistence boundary. Implemented for real against Postgres/Drizzle
// elsewhere; implemented as an in-memory Map in tests.
export interface CallRepository {
  getById(callId: string): Promise<CallRecord | null>;
  save(call: CallRecord): Promise<void>;
  createDispute(input: { callId: string; developerId: string; reason: string }): Promise<void>;
}

export class CallNotFoundError extends Error {
  constructor(callId: string) {
    super(`Call ${callId} not found`);
    this.name = "CallNotFoundError";
  }
}

export class SettlementService {
  constructor(private readonly repo: CallRepository) {}

  /**
   * Called by the proxy handler right after forwarding a request to a
   * provider and running the structural check (timeout/5xx/schema match).
   */
  async recordStructuralCheck(callId: string, passed: boolean): Promise<CallRecord> {
    const call = await this.requireCall(callId);

    const nextStatus = transition(call.status, {
      type: passed ? "STRUCTURAL_CHECK_PASSED" : "STRUCTURAL_CHECK_FAILED",
    });

    const updated: CallRecord = {
      ...call,
      status: nextStatus,
      // only a passed check starts the 1hr clock; a rejected call never holds funds
      holdExpiresAt: passed ? new Date(Date.now() + HOLD_WINDOW_MS) : null,
    };

    await this.repo.save(updated);
    return updated;
  }

  /**
   * Called by the pg-boss delayed job scheduled at hold_expires_at.
   * If the call was already flagged (moved to 'refunded') before the job
   * fires, this is a no-op — the job should check status first and skip
   * calling this at all if status !== 'held'. Calling it on a non-held
   * call throws InvalidTransitionError by design, so a scheduling bug
   * surfaces loudly instead of silently double-processing.
   */
  async settleExpiredHold(callId: string): Promise<CallRecord> {
    const call = await this.requireCall(callId);
    const nextStatus = transition(call.status, { type: "HOLD_EXPIRED" });

    const updated: CallRecord = { ...call, status: nextStatus };
    await this.repo.save(updated);
    return updated;
  }

  /**
   * Called by POST /developer/calls/:id/flag. Only legal while status is
   * 'held' — the state machine itself enforces this and throws
   * InvalidTransitionError (surfaced by the route as a 409) if the window
   * already closed or the call was already flagged/settled.
   */
  async flagCall(input: {
    callId: string;
    developerId: string;
    reason: string;
  }): Promise<CallRecord> {
    const call = await this.requireCall(input.callId);

    if (call.developerId !== input.developerId) {
      // ownership check lives here, not just at the route layer, so this
      // service is safe to call from anywhere without re-deriving auth
      throw new CallNotFoundError(input.callId); // deliberately not "403" — don't leak existence
    }

    const nextStatus = transition(call.status, { type: "DEVELOPER_FLAGGED" });
    const updated: CallRecord = { ...call, status: nextStatus };

    await this.repo.save(updated);
    await this.repo.createDispute({
      callId: input.callId,
      developerId: input.developerId,
      reason: input.reason,
    });

    return updated;
  }

  private async requireCall(callId: string): Promise<CallRecord> {
    const call = await this.repo.getById(callId);
    if (!call) throw new CallNotFoundError(callId);
    return call;
  }
}
