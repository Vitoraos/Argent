// pg-boss recurring job: every 30s, checks the pooled wallet's recent
// transactions and hands new ones to DepositCreditingService. Fetching
// and parsing real Solana transactions is glue (not unit tested) —
// DepositCreditingService.processCandidates, which this calls into, IS
// fully unit tested (see deposit-service.ts).

import type PgBoss from "pg-boss";
import { createSolanaRpc, address, type Address } from "@solana/kit";
import {
  DepositCreditingService,
  type CandidateTransfer,
  type DepositRepository,
  type JobLogger,
} from "./deposit-service.js";

export const DEPOSIT_WATCH_QUEUE = "watch-deposits";
export const DEPOSIT_WATCH_INTERVAL_SECONDS = 30;

export interface DepositWatcherConfig {
  rpcUrl: string;
  poolWalletAddress: string;
  poolTokenAccountAddress: string; // pool wallet's USDC associated token account
}

/**
 * Fetches recent transactions to the pool's token account and extracts
 * the memo (used as the developer's deposit_reference) and transferred
 * amount from each. Returns candidates for DepositCreditingService to
 * decide what to do with — this function only parses, never decides.
 *
 * HONESTY FLAG: the exact RPC call shape for fetching + decoding parsed
 * transaction memos varies by RPC provider and needs to be validated
 * against whichever RPC you actually use (public devnet RPC vs a paid
 * provider). Treat this function body as a starting sketch, not a
 * verified implementation.
 */
async function fetchCandidateTransfers(
  config: DepositWatcherConfig,
  logger: JobLogger,
): Promise<CandidateTransfer[]> {
  const rpc = createSolanaRpc(config.rpcUrl);
  const tokenAccount: Address = address(config.poolTokenAccountAddress);

  const signatures = await rpc
    .getSignaturesForAddress(tokenAccount, { limit: 50 })
    .send();

  const candidates: CandidateTransfer[] = [];

  for (const sigInfo of signatures) {
    if (sigInfo.err) continue; // skip failed transactions

    try {
      const tx = await rpc
        .getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
          encoding: "jsonParsed",
        })
        .send();

      if (!tx) continue;

      const memo = extractMemo(tx);
      const amountUsdc = extractTransferAmount(tx, config.poolTokenAccountAddress);

      if (memo && amountUsdc !== null) {
        candidates.push({ signature: sigInfo.signature, amountUsdc, reference: memo });
      }
    } catch (err) {
      logger.error("failed to fetch/parse transaction during deposit watch", {
        signature: sigInfo.signature,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return candidates;
}

// Placeholder extraction helpers — real implementation depends on the
// exact jsonParsed transaction shape returned by your RPC provider.
// Left explicit rather than hand-waved so it's obvious what's unfinished.
function extractMemo(tx: unknown): string | null {
  // TODO: parse the SPL Memo program instruction from tx.transaction.message.instructions
  return null;
}
function extractTransferAmount(tx: unknown, poolTokenAccount: string): number | null {
  // TODO: parse the token balance delta for poolTokenAccount from
  // tx.meta.preTokenBalances / postTokenBalances
  return null;
}

export function registerDepositWatcher(
  boss: PgBoss,
  config: DepositWatcherConfig,
  repo: DepositRepository,
  logger: JobLogger,
): Promise<string> {
  const service = new DepositCreditingService(repo, logger);

  return boss.work(DEPOSIT_WATCH_QUEUE, async () => {
    const candidates = await fetchCandidateTransfers(config, logger);
    const result = await service.processCandidates(candidates);
    logger.info("deposit watch cycle complete", result as unknown as Record<string, unknown>);

    // Standard cron (what pg-boss's schedule() uses) doesn't support
    // sub-minute intervals, so a true 30s cadence is done by having each
    // run schedule the next one, rather than a fixed cron expression.
    await boss.send(DEPOSIT_WATCH_QUEUE, {}, { startAfter: DEPOSIT_WATCH_INTERVAL_SECONDS });
  });
}

/**
 * Call once at startup to kick off the self-rescheduling chain above.
 * After this first send, the job perpetuates itself every 30s from
 * inside registerDepositWatcher's handler — this function is only the
 * initial kickoff, not a recurring scheduler itself.
 */
export function startDepositWatcher(boss: PgBoss): Promise<string | null> {
  return boss.send(DEPOSIT_WATCH_QUEUE, {});
}
