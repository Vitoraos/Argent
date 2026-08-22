// The delayed job that fires at hold_expires_at and settles a call, unless
// it was already flagged (refunded) in the meantime. Split deliberately:
// handleSettlementJob is pure decision logic, testable with a fake repo.
// registerSettlementWorker/scheduleSettlement are thin pg-boss glue, not
// unit-tested here — that's an integration concern against real Postgres.

import type PgBoss from "pg-boss";
import { SettlementService, CallNotFoundError } from "./service.js";
import { InvalidTransitionError } from "./state-machine.js";

export const SETTLEMENT_QUEUE = "settle-hold";

export interface SettlementJobPayload {
  callId: string;
}

export interface JobLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Pure decision logic for one settlement job firing. Attempts to settle
 * the call. If the call already moved out of 'held' (developer flagged it,
 * or — shouldn't happen, but defensively — it was already settled), that's
 * an expected race, not a failure: log it and complete the job normally.
 * A missing call row is logged as an error (shouldn't happen) but still
 * completes rather than retrying forever, since retrying won't make a
 * genuinely missing row appear.
 */
export async function handleSettlementJob(
  payload: SettlementJobPayload,
  settlement: SettlementService,
  logger: JobLogger,
): Promise<void> {
  try {
    const result = await settlement.settleExpiredHold(payload.callId);
    logger.info("call settled", { callId: payload.callId, status: result.status });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      // expected race: developer flagged it before the window closed
      logger.info("settlement skipped, call already left 'held' state", {
        callId: payload.callId,
        currentStatus: err.currentStatus,
      });
      return;
    }
    if (err instanceof CallNotFoundError) {
      logger.error("settlement job fired for a call that doesn't exist", {
        callId: payload.callId,
      });
      return;
    }
    // anything else (DB connection error, etc.) is unexpected — rethrow so
    // pg-boss's retry policy handles it, rather than silently swallowing it
    throw err;
  }
}

export function registerSettlementWorker(
  boss: PgBoss,
  settlement: SettlementService,
  logger: JobLogger,
): Promise<string> {
  return boss.work<SettlementJobPayload>(SETTLEMENT_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await handleSettlementJob(job.data, settlement, logger);
    }
  });
}

/**
 * Called right after a call moves to 'held' (i.e. right after
 * SettlementService.recordStructuralCheck passes). Schedules the job to
 * fire at holdExpiresAt, not immediately.
 */
export function scheduleSettlement(
  boss: PgBoss,
  callId: string,
  holdExpiresAt: Date,
): Promise<string | null> {
  const startAfterSeconds = Math.max(
    0,
    Math.ceil((holdExpiresAt.getTime() - Date.now()) / 1000),
  );
  return boss.send(
    SETTLEMENT_QUEUE,
    { callId } satisfies SettlementJobPayload,
    { startAfter: startAfterSeconds },
  );
}
