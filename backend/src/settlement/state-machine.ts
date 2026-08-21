// Pure transition logic for a call's lifecycle. No I/O, no DB, no Solana.
// This is the module that gets unit-tested exhaustively and never touched
// carelessly — every other module only calls into this, never reimplements
// a transition inline.

export type CallStatus =
  | "authorized"
  | "rejected"
  | "held"
  | "settled"
  | "refunded";

export type CallEvent =
  | { type: "STRUCTURAL_CHECK_PASSED" }
  | { type: "STRUCTURAL_CHECK_FAILED" }
  | { type: "HOLD_EXPIRED" } // fired by the pg-boss job at hold_expires_at
  | { type: "DEVELOPER_FLAGGED" }; // fired by POST /developer/calls/:id/flag

export class InvalidTransitionError extends Error {
  constructor(
    public readonly currentStatus: CallStatus,
    public readonly event: CallEvent["type"],
  ) {
    super(`Cannot apply event "${event}" to a call in status "${currentStatus}"`);
    this.name = "InvalidTransitionError";
  }
}

// Explicit allow-list. Anything not listed here is illegal and throws —
// there is no default/fallthrough case, on purpose.
const TRANSITIONS: Record<
  CallStatus,
  Partial<Record<CallEvent["type"], CallStatus>>
> = {
  authorized: {
    STRUCTURAL_CHECK_PASSED: "held",
    STRUCTURAL_CHECK_FAILED: "rejected",
  },
  held: {
    HOLD_EXPIRED: "settled",
    DEVELOPER_FLAGGED: "refunded",
  },
  // terminal states — no events accepted
  rejected: {},
  settled: {},
  refunded: {},
};

export function isTerminal(status: CallStatus): boolean {
  return Object.keys(TRANSITIONS[status]).length === 0;
}

/**
 * Computes the next status for a call given its current status and an
 * event. Throws InvalidTransitionError if the event isn't legal from the
 * current status (e.g. flagging a call that's already settled).
 */
export function transition(
  currentStatus: CallStatus,
  event: CallEvent,
): CallStatus {
  const nextStatus = TRANSITIONS[currentStatus]?.[event.type];
  if (!nextStatus) {
    throw new InvalidTransitionError(currentStatus, event.type);
  }
  return nextStatus;
}
