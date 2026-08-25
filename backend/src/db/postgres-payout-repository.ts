// Real implementation of PayoutRepository, backing PayoutService (already
// fully unit tested against a fake — see payout-service.test.ts).
// NOT UNIT TESTED here — needs a live DB.

import { sql, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { providerPayouts } from "./schema.js";
import type { PayoutRepository, PendingPayout } from "../solana/payout-service.js";

export class PostgresPayoutRepository implements PayoutRepository {
  constructor(private readonly db: Database) {}

  async getAvailableBalanceUsdc(providerId: string): Promise<number> {
    // provider_balances is a VIEW (see schema.sql) — queried with raw sql
    // since it isn't a pgTable Drizzle manages directly.
    const result = await this.db.execute<{ available_balance: string }>(
      sql`select available_balance from provider_balances where provider_id = ${providerId}`,
    );
    const row = result.rows[0];
    return row ? Number(row.available_balance) : 0;
  }

  async createPendingPayout(input: {
    providerId: string;
    amountUsdc: number;
    destinationWalletAddress: string;
  }): Promise<PendingPayout> {
    const [row] = await this.db
      .insert(providerPayouts)
      .values({
        providerId: input.providerId,
        amountUsdc: input.amountUsdc.toString(),
        destinationWalletAddress: input.destinationWalletAddress,
        status: "pending",
      })
      .returning({ id: providerPayouts.id });
    return { id: row.id };
  }

  async markPayoutCompleted(payoutId: string, signature: string): Promise<void> {
    await this.db
      .update(providerPayouts)
      .set({ status: "completed", solanaTxSignature: signature, completedAt: new Date() })
      .where(eq(providerPayouts.id, payoutId));
  }

  async markPayoutFailed(payoutId: string, reason: string): Promise<void> {
    // schema.sql's provider_payouts table has no `failure_reason` column
    // today — logged by the caller (job.ts-style JobLogger) rather than
    // persisted. Worth adding a text column here if failed-payout
    // investigation becomes a frequent enough need to want it queryable.
    await this.db
      .update(providerPayouts)
      .set({ status: "failed" })
      .where(eq(providerPayouts.id, payoutId));
  }
}
