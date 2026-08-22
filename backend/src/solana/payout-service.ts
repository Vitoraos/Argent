// Orchestrates a provider payout request: checks the ledger balance,
// records a pending payout, executes the real transfer via an injected
// SolanaExecutor port, and records the outcome. The actual Solana
// transaction building/signing lives in solana-executor.ts (glue, not
// tested here) — this service only sequences the steps correctly.

export const MIN_PAYOUT_USDC = 3;

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly availableUsdc: number,
  ) {
    super(
      `Provider ${providerId} has $${availableUsdc.toFixed(2)}, below the $${MIN_PAYOUT_USDC} minimum payout`,
    );
    this.name = "InsufficientBalanceError";
  }
}

export interface PendingPayout {
  id: string;
}

export interface PayoutRepository {
  // Reads the same provider_balances view already defined in schema.sql —
  // this service never computes balance itself, only consumes it.
  getAvailableBalanceUsdc(providerId: string): Promise<number>;

  createPendingPayout(input: {
    providerId: string;
    amountUsdc: number;
    destinationWalletAddress: string;
  }): Promise<PendingPayout>;

  markPayoutCompleted(payoutId: string, signature: string): Promise<void>;
  markPayoutFailed(payoutId: string, reason: string): Promise<void>;
}

// The only Solana-touching dependency this service knows about. The real
// implementation (solana-executor.ts) builds and signs an actual SPL
// token transfer; tests use a fake that just returns/throws.
export interface SolanaExecutor {
  sendUsdc(destinationWalletAddress: string, amountUsdc: number): Promise<string>; // returns tx signature
}

export interface PayoutResult {
  payoutId: string;
  status: "completed" | "failed";
  amountUsdc: number;
  signature?: string;
}

export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    private readonly solana: SolanaExecutor,
  ) {}

  async requestPayout(input: {
    providerId: string;
    destinationWalletAddress: string;
  }): Promise<PayoutResult> {
    const availableUsdc = await this.repo.getAvailableBalanceUsdc(input.providerId);

    if (availableUsdc < MIN_PAYOUT_USDC) {
      // Thrown before any payout row is created — an insufficient-balance
      // attempt shouldn't leave a phantom pending record behind.
      throw new InsufficientBalanceError(input.providerId, availableUsdc);
    }

    const pending = await this.repo.createPendingPayout({
      providerId: input.providerId,
      amountUsdc: availableUsdc,
      destinationWalletAddress: input.destinationWalletAddress,
    });

    try {
      const signature = await this.solana.sendUsdc(
        input.destinationWalletAddress,
        availableUsdc,
      );
      await this.repo.markPayoutCompleted(pending.id, signature);
      return {
        payoutId: pending.id,
        status: "completed",
        amountUsdc: availableUsdc,
        signature,
      };
    } catch (err) {
      // The pending row is never left dangling — a failed transfer is
      // recorded as failed, not silently lost, so it's visible for
      // manual retry/investigation rather than disappearing.
      const reason = err instanceof Error ? err.message : "unknown error";
      await this.repo.markPayoutFailed(pending.id, reason);
      throw err;
    }
  }
}
