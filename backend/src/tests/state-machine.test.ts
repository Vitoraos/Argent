import { describe, it, expect } from "vitest";
import { transition, isTerminal, InvalidTransitionError } from "../settlement/state-machine.js";

describe("state machine transitions", () => {
  it("authorized -> held on structural check passed", () => {
    expect(transition("authorized", { type: "STRUCTURAL_CHECK_PASSED" })).toBe("held");
  });

  it("authorized -> rejected on structural check failed", () => {
    expect(transition("authorized", { type: "STRUCTURAL_CHECK_FAILED" })).toBe("rejected");
  });

  it("held -> settled on hold expired", () => {
    expect(transition("held", { type: "HOLD_EXPIRED" })).toBe("settled");
  });

  it("held -> refunded on developer flagged", () => {
    expect(transition("held", { type: "DEVELOPER_FLAGGED" })).toBe("refunded");
  });

  it("throws when flagging a call that already settled", () => {
    expect(() => transition("settled", { type: "DEVELOPER_FLAGGED" })).toThrow(
      InvalidTransitionError,
    );
  });

  it("throws when flagging a call that was already refunded", () => {
    expect(() => transition("refunded", { type: "DEVELOPER_FLAGGED" })).toThrow(
      InvalidTransitionError,
    );
  });

  it("throws on double structural check (authorized event replayed on held)", () => {
    expect(() =>
      transition("held", { type: "STRUCTURAL_CHECK_PASSED" }),
    ).toThrow(InvalidTransitionError);
  });

  it("throws firing HOLD_EXPIRED on a rejected call", () => {
    expect(() => transition("rejected", { type: "HOLD_EXPIRED" })).toThrow(
      InvalidTransitionError,
    );
  });

  it("rejected, settled, refunded are all terminal", () => {
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("settled")).toBe(true);
    expect(isTerminal("refunded")).toBe(true);
  });

  it("authorized and held are not terminal", () => {
    expect(isTerminal("authorized")).toBe(false);
    expect(isTerminal("held")).toBe(false);
  });

  it("error carries the current status and event for logging", () => {
    try {
      transition("settled", { type: "HOLD_EXPIRED" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const e = err as InvalidTransitionError;
      expect(e.currentStatus).toBe("settled");
      expect(e.event).toBe("HOLD_EXPIRED");
    }
  });
});
