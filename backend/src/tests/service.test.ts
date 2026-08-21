import { describe, it, expect, beforeEach } from "vitest";
import {
  SettlementService,
  CallNotFoundError,
  type CallRecord,
  type CallRepository,
} from "../settlement/service.js";
import { InvalidTransitionError } from "../settlement/state-machine.js";
// In-memory fake repo — no Postgres needed to test the orchestration logic.
class FakeCallRepository implements CallRepository {
  calls = new Map<string, CallRecord>();
  disputes: { callId: string; developerId: string; reason: string }[] = [];

  async getById(callId: string) {
    return this.calls.get(callId) ?? null;
  }
  async save(call: CallRecord) {
    this.calls.set(call.id, call);
  }
  async createDispute(input: { callId: string; developerId: string; reason: string }) {
    this.disputes.push(input);
  }
}

function makeCall(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    id: "call-1",
    developerId: "dev-1",
    providerId: "prov-1",
    priceUsdc: 0.002,
    status: "authorized",
    holdExpiresAt: null,
    ...overrides,
  };
}

describe("SettlementService", () => {
  let repo: FakeCallRepository;
  let service: SettlementService;

  beforeEach(() => {
    repo = new FakeCallRepository();
    service = new SettlementService(repo);
  });

  describe("recordStructuralCheck", () => {
    it("moves to held and sets a 1hr hold window on pass", async () => {
      repo.calls.set("call-1", makeCall());
      const before = Date.now();

      const result = await service.recordStructuralCheck("call-1", true);

      expect(result.status).toBe("held");
      expect(result.holdExpiresAt).not.toBeNull();
      const deltaMs = result.holdExpiresAt!.getTime() - before;
      expect(deltaMs).toBeGreaterThan(59 * 60 * 1000);
      expect(deltaMs).toBeLessThan(61 * 60 * 1000);
    });

    it("moves to rejected with no hold window on fail", async () => {
      repo.calls.set("call-1", makeCall());
      const result = await service.recordStructuralCheck("call-1", false);

      expect(result.status).toBe("rejected");
      expect(result.holdExpiresAt).toBeNull();
    });

    it("throws CallNotFoundError for unknown call id", async () => {
      await expect(service.recordStructuralCheck("missing", true)).rejects.toThrow(
        CallNotFoundError,
      );
    });
  });

  describe("settleExpiredHold", () => {
    it("moves held -> settled", async () => {
      repo.calls.set("call-1", makeCall({ status: "held", holdExpiresAt: new Date() }));
      const result = await service.settleExpiredHold("call-1");
      expect(result.status).toBe("settled");
    });

    it("throws if the call was already flagged/refunded before the job ran", async () => {
      // simulates the race: developer flagged the call moments before the
      // pg-boss job fired for the same call
      repo.calls.set("call-1", makeCall({ status: "refunded" }));
      await expect(service.settleExpiredHold("call-1")).rejects.toThrow(
        InvalidTransitionError,
      );
    });
  });

  describe("flagCall", () => {
    it("moves held -> refunded and records a dispute", async () => {
      repo.calls.set("call-1", makeCall({ status: "held", holdExpiresAt: new Date() }));

      const result = await service.flagCall({
        callId: "call-1",
        developerId: "dev-1",
        reason: "Wrong coordinates returned",
      });

      expect(result.status).toBe("refunded");
      expect(repo.disputes).toHaveLength(1);
      expect(repo.disputes[0]).toMatchObject({
        callId: "call-1",
        reason: "Wrong coordinates returned",
      });
    });

    it("throws if the call already settled (window closed)", async () => {
      repo.calls.set("call-1", makeCall({ status: "settled" }));

      await expect(
        service.flagCall({ callId: "call-1", developerId: "dev-1", reason: "too late" }),
      ).rejects.toThrow(InvalidTransitionError);

      expect(repo.disputes).toHaveLength(0); // no dispute created on a failed transition
    });

    it("throws CallNotFoundError (not a leaky 403) if another developer tries to flag it", async () => {
      repo.calls.set("call-1", makeCall({ status: "held", developerId: "dev-1" }));

      await expect(
        service.flagCall({ callId: "call-1", developerId: "dev-2", reason: "not mine" }),
      ).rejects.toThrow(CallNotFoundError);
    });
  });
});
