// Decides what to do with a batch of candidate incoming transfers to the
// pooled wallet. No Solana RPC calls here — the deposit-watcher-job.ts
// glue is responsible for fetching and parsing real transactions into
// CandidateTransfer objects; this only decides which ones to credit.

export interface CandidateTransfer {
  signature: string; // Solana tx signature — the natural idempotency key
  amountUsdc: number;
  reference: string; // parsed from the transaction memo
}

export interface JobLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface DepositRepository {
  isSignatureRecorded(signature: string): Promise<boolean>;
  findDeveloperIdByReference(reference: string): Promise<string | null>;
  recordDeposit(input: {
    developerId: string;
    amountUsdc: number;
    signature: string;
  }): Promise<void>;
}

export interface ProcessDepositsResult {
  credited: number;
  skippedAlreadyRecorded: number;
  skippedUnknownReference: number;
}

export class DepositCreditingService {
  constructor(
    private readonly repo: DepositRepository,
    private readonly logger: JobLogger,
  ) {}

  /**
   * Processes a batch of candidate transfers fetched from the pooled
   * wallet's transaction history. Idempotent by design — re-running this
   * with the same candidates (e.g. after a job retry) never double-credits,
   * since already-recorded signatures are skipped.
   */
  async processCandidates(
    candidates: CandidateTransfer[],
  ): Promise<ProcessDepositsResult> {
    const result: ProcessDepositsResult = {
      credited: 0,
      skippedAlreadyRecorded: 0,
      skippedUnknownReference: 0,
    };

    for (const candidate of candidates) {
      if (await this.repo.isSignatureRecorded(candidate.signature)) {
        result.skippedAlreadyRecorded++;
        continue;
      }

      const developerId = await this.repo.findDeveloperIdByReference(
        candidate.reference,
      );

      if (!developerId) {
        // A transfer landed with a reference that doesn't match any known
        // developer — could be a typo'd memo, or someone sending funds
        // without following the deposit instructions. Logged loudly since
        // this is money that isn't yet attributed to anyone.
        this.logger.warn("deposit with unmatched reference — not credited", {
          signature: candidate.signature,
          reference: candidate.reference,
          amountUsdc: candidate.amountUsdc,
        });
        result.skippedUnknownReference++;
        continue;
      }

      await this.repo.recordDeposit({
        developerId,
        amountUsdc: candidate.amountUsdc,
        signature: candidate.signature,
      });
      result.credited++;
    }

    return result;
  }
}
