import { describe, it, expect, vi } from "vitest";
import { handleSettlementJob, type JobLogger } from "../settlement/job.js";
import { SettlementService, type CallRecord, type CallRepository } from "../settlement/service.js";

class FakeCallRepository implements CallRepository {
  calls = new Map<string, CallRecord>();
  disputes: unknown[] = [];
  async getById(id: string) { return this.calls.get(id) ?? null; }
  async save(call: CallRecord) { this.calls.set(call.id, call); }
  async createDispute(input: any) { this.disputes.push(input); }
}

function makeLogger(): JobLogger & { calls: { level: string; msg: string }[] } {
  const calls: { level: string; msg: string }[] = [];
  return {
    calls,
    info: (msg) => calls.push({ level: "info", msg }),
    warn: (msg) => calls.push({ level: "warn", msg }),
    error: (msg) => calls.push({ level: "error", msg }),
  };
}

function makeCall(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    id: "call-1",
    developerId: "dev-1",
    providerId: "prov-1",
    priceUsdc: 0.002,
    status: "held",
    holdExpiresAt: new Date(),
    ...overrides,
  };
}

describe("handleSettlementJob", () => {
  it("settles a call still in 'held' status", async () => {
    const repo = new FakeCallRepository();
    repo.calls.set("call-1", makeCall());
    const settlement = new SettlementService(repo);
    const logger = makeLogger();

    await handleSettlementJob({ callId: "call-1" }, settlement, logger);

    expect(repo.calls.get("call-1")!.status).toBe("settled");
    expect(logger.calls.some((c) => c.level === "info" && c.msg.includes("settled"))).toBe(true);
  });

  it("skips quietly (no throw) when the call was already flagged/refunded", async () => {
    const repo = new FakeCallRepository();
    repo.calls.set("call-1", makeCall({ status: "refunded" }));
    const settlement = new SettlementService(repo);
    const logger = makeLogger();

    await expect(
      handleSettlementJob({ callId: "call-1" }, settlement, logger),
    ).resolves.not.toThrow();

    expect(repo.calls.get("call-1")!.status).toBe("refunded"); // unchanged
    expect(logger.calls.some((c) => c.msg.includes("already left"))).toBe(true);
  });

  it("logs an error but does not throw when the call doesn't exist", async () => {
    const repo = new FakeCallRepository();
    const settlement = new SettlementService(repo);
    const logger = makeLogger();

    await expect(
      handleSettlementJob({ callId: "ghost-call" }, settlement, logger),
    ).resolves.not.toThrow();

    expect(logger.calls.some((c) => c.level === "error")).toBe(true);
  });

  it("rethrows unexpected errors so pg-boss can retry", async () => {
    const repo = new FakeCallRepository();
    repo.calls.set("call-1", makeCall());
    const settlement = new SettlementService(repo);
    // simulate a DB blip on save
    vi.spyOn(repo, "save").mockRejectedValueOnce(new Error("connection reset"));
    const logger = makeLogger();

    await expect(
      handleSettlementJob({ callId: "call-1" }, settlement, logger),
    ).rejects.toThrow("connection reset");
  });
});
