// The only file in this codebase that actually moves real money on-chain.
// Implements the SolanaExecutor port that payout-service.ts depends on.
//
// NOT UNIT TESTED — same reasoning as build-server.ts and the pg-boss
// wiring: this needs a live RPC connection to mean anything. Test this
// against devnet with real (test) USDC before ever pointing it at
// mainnet-beta.
//
// HONESTY FLAG: the @solana/kit transaction-building pattern below (pipe,
// createTransactionMessage, sign, send) is verified against current docs.
// The exact @solana-program/token instruction helper names
// (getTransferCheckedInstruction, findAssociatedTokenPda,
// getCreateAssociatedTokenAccountIdempotentInstruction) are written from
// the package's documented conventions but were NOT executed in this
// environment (no network access). If these names have shifted, the fix
// is almost always a mechanical rename — check @solana-program/token's
// own type exports first.

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  createKeyPairSignerFromBytes,
  address,
  type Address,
} from "@solana/kit";
import {
  getTransferCheckedInstruction,
  findAssociatedTokenPda,
  getCreateAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { SolanaExecutor } from "./payout-service.js";

export interface SolanaExecutorConfig {
  rpcUrl: string; // devnet or mainnet-beta endpoint, from env
  rpcSubscriptionsUrl: string; // wss:// endpoint for confirmation
  usdcMintAddress: string; // devnet test-USDC mint, or real USDC on mainnet
  usdcDecimals: number; // 6 for real USDC
  poolWalletSecretKeyBase64: string; // NEVER logged, NEVER committed —
  // loaded from an environment variable at startup only. Compromise of
  // this value means compromise of every dollar in the pool.
}

export async function createSolanaExecutor(
  config: SolanaExecutorConfig,
): Promise<SolanaExecutor> {
  const rpc = createSolanaRpc(config.rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(config.rpcSubscriptionsUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  const secretKeyBytes = Uint8Array.from(
    Buffer.from(config.poolWalletSecretKeyBase64, "base64"),
  );
  const poolSigner = await createKeyPairSignerFromBytes(secretKeyBytes);
  const usdcMint = address(config.usdcMintAddress);

  return {
    async sendUsdc(destinationWalletAddress: string, amountUsdc: number): Promise<string> {
      const destination: Address = address(destinationWalletAddress);

      const [sourceAta] = await findAssociatedTokenPda({
        mint: usdcMint,
        owner: poolSigner.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const [destinationAta] = await findAssociatedTokenPda({
        mint: usdcMint,
        owner: destination,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      // Idempotent: creates the recipient's associated token account only
      // if it doesn't already exist — most providers won't have one yet
      // on their first payout.
      const createAtaIx = getCreateAssociatedTokenAccountIdempotentInstruction({
        payer: poolSigner,
        mint: usdcMint,
        owner: destination,
        ata: destinationAta,
      });

      const amountBaseUnits = BigInt(
        Math.round(amountUsdc * 10 ** config.usdcDecimals),
      );

      const transferIx = getTransferCheckedInstruction({
        source: sourceAta,
        mint: usdcMint,
        destination: destinationAta,
        authority: poolSigner,
        amount: amountBaseUnits,
        decimals: config.usdcDecimals,
      });

      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(poolSigner, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => appendTransactionMessageInstructions([createAtaIx, transferIx], tx),
      );

      const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);

await sendAndConfirm(
  signedTransaction as Parameters<typeof sendAndConfirm>[0],
  { commitment: "confirmed" },
);
      return getSignatureFromTransaction(signedTransaction);
    },
  };
}
