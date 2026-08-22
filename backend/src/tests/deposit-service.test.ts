import { describe, it, expect } from "vitest";
import {
  DepositCreditingService,
  type CandidateTransfer,
  type DepositRepository,
  type JobLogger,
} from "../solana/deposit-service.js";

class FakeDepositRepository implements DepositRepository {
  recordedSignatures = new Set<string>();
  referenceToDeveloperId = new Map<string, string>();
  credited: { developerId: string; amountUsdc: number; signature: string }[] = [];

  async isSignatureRecorded(signature: string) {
    return this.recordedSignatures.has(signature);
  }
  async findDeveloperIdByReference(reference: string) {
    return this.referenceToDeveloperId.get(reference) ?? null;
  }
  async recordDeposit(input: { developerId: string; amountUsdc: number; signature: string }) {
    this.recordedSignatures.add(input.signature);
    this.credited.push(input);
  }
}

function makeLogger(): JobLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    info: () => {},
    warn: (msg) => warnings.push(msg),
    error: () => {},
  };
}

function candidate(overrides: Partial<CandidateTransfer> = {}): CandidateTransfer {
  return {
    signature: "sig-1",
    amountUsdc: 10,
    reference: "dev-ref-abc",
    ...overrides,
  };
}

describe("DepositCreditingService", () => {
  it("credits a new deposit with a known reference", async () => {
    const repo = new FakeDepositRepository();
    repo.referenceToDeveloperId.set("dev-ref-abc", "dev-1");
    const service = new DepositCreditingService(repo, makeLogger());

    const result = await service.processCandidates([candidate()]);

    expect(result).toEqual({
      credited: 1,
      skippedAlreadyRecorded: 0,
      skippedUnknownReference: 0,
    });
    expect(repo.credited).toEqual([
      { developerId: "dev-1", amountUsdc: 10, signature: "sig-1" },
    ]);
  });

  it("skips a signature that was already recorded (idempotent on retry)", async () => {
    const repo = new FakeDepositRepository();
    repo.referenceToDeveloperId.set("dev-ref-abc", "dev-1");
    repo.recordedSignatures.add("sig-1");
    const service = new DepositCreditingService(repo, makeLogger());

    const result = await service.processCandidates([candidate()]);

    expect(result.skippedAlreadyRecorded).toBe(1);
    expect(result.credited).toBe(0);
    expect(repo.credited).toHaveLength(0);
  });

  it("skips and warns on an unmatched reference, without throwing", async () => {
    const repo = new FakeDepositRepository();
    const logger = makeLogger();
    const service = new DepositCreditingService(repo, logger);

    const result = await service.processCandidates([
      candidate({ reference: "no-such-developer" }),
    ]);

    expect(result.skippedUnknownReference).toBe(1);
    expect(repo.credited).toHaveLength(0);
    expect(logger.warnings.some((w) => w.includes("unmatched"))).toBe(true);
  });

  it("processes a mixed batch correctly, independent per candidate", async () => {
    const repo = new FakeDepositRepository();
    repo.referenceToDeveloperId.set("ref-a", "dev-a");
    repo.recordedSignatures.add("sig-already-done");
    const service = new DepositCreditingService(repo, makeLogger());

    const result = await service.processCandidates([
      candidate({ signature: "sig-new", reference: "ref-a", amountUsdc: 5 }),
      candidate({ signature: "sig-already-done", reference: "ref-a" }),
      candidate({ signature: "sig-orphan", reference: "ref-unknown" }),
    ]);

    expect(result).toEqual({
      credited: 1,
      skippedAlreadyRecorded: 1,
      skippedUnknownReference: 1,
    });
  });
});
