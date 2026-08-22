import { describe, it, expect, vi } from "vitest";
import {
  PayoutService,
  InsufficientBalanceError,
  type PayoutRepository,
  type SolanaExecutor,
  type PendingPayout,
} from "../solana/payout-service.js";

class FakePayoutRepository implements PayoutRepository {
  balance = 0;
  pendingPayouts: { id: string; providerId: string; amountUsdc: number }[] = [];
  completed: { id: string; signature: string }[] = [];
  failed: { id: string; reason: string }[] = [];
  private nextId = 1;

  async getAvailableBalanceUsdc() {
    return this.balance;
  }
  async createPendingPayout(input: {
    providerId: string;
    amountUsdc: number;
    destinationWalletAddress: string;
  }): Promise<PendingPayout> {
    const id = `payout-${this.nextId++}`;
    this.pendingPayouts.push({ id, providerId: input.providerId, amountUsdc: input.amountUsdc });
    return { id };
  }
  async markPayoutCompleted(payoutId: string, signature: string) {
    this.completed.push({ id: payoutId, signature });
  }
  async markPayoutFailed(payoutId: string, reason: string) {
    this.failed.push({ id: payoutId, reason });
  }
}

describe("PayoutService", () => {
  it("executes a payout when balance meets the minimum", async () => {
    const repo = new FakePayoutRepository();
    repo.balance = 5.5;
    const solana: SolanaExecutor = { sendUsdc: vi.fn().mockResolvedValue("sig-abc") };
    const service = new PayoutService(repo, solana);

    const result = await service.requestPayout({
      providerId: "prov-1",
      destinationWalletAddress: "wallet-xyz",
    });

    expect(result).toEqual({
      payoutId: "payout-1",
      status: "completed",
      amountUsdc: 5.5,
      signature: "sig-abc",
    });
    expect(repo.completed).toEqual([{ id: "payout-1", signature: "sig-abc" }]);
    expect(solana.sendUsdc).toHaveBeenCalledWith("wallet-xyz", 5.5);
  });

  it("throws InsufficientBalanceError below the $3 minimum, without creating a payout row", async () => {
    const repo = new FakePayoutRepository();
    repo.balance = 2.99;
    const solana: SolanaExecutor = { sendUsdc: vi.fn() };
    const service = new PayoutService(repo, solana);

    await expect(
      service.requestPayout({ providerId: "prov-1", destinationWalletAddress: "wallet-xyz" }),
    ).rejects.toThrow(InsufficientBalanceError);

    expect(repo.pendingPayouts).toHaveLength(0);
    expect(solana.sendUsdc).not.toHaveBeenCalled();
  });

  it("marks the payout failed and rethrows if the Solana transfer fails", async () => {
    const repo = new FakePayoutRepository();
    repo.balance = 10;
    const solana: SolanaExecutor = {
      sendUsdc: vi.fn().mockRejectedValue(new Error("RPC timeout")),
    };
    const service = new PayoutService(repo, solana);

    await expect(
      service.requestPayout({ providerId: "prov-1", destinationWalletAddress: "wallet-xyz" }),
    ).rejects.toThrow("RPC timeout");

    expect(repo.failed).toEqual([{ id: "payout-1", reason: "RPC timeout" }]);
    expect(repo.completed).toHaveLength(0);
  });

  it("pays out the full available balance, not a fixed amount", async () => {
    const repo = new FakePayoutRepository();
    repo.balance = 42.17;
    const solana: SolanaExecutor = { sendUsdc: vi.fn().mockResolvedValue("sig-1") };
    const service = new PayoutService(repo, solana);

    await service.requestPayout({ providerId: "prov-1", destinationWalletAddress: "w" });

    expect(solana.sendUsdc).toHaveBeenCalledWith("w", 42.17);
  });
});
