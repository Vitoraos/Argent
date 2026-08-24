// Real implementation of DepositRepository, backing DepositCreditingService
// (already fully unit tested against a fake — see deposit-service.test.ts).
// NOT UNIT TESTED here — needs a live DB.

import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { deposits, developers } from "../db/schema.js";
import type { DepositRepository } from "./deposit-service.js";

export class PostgresDepositRepository implements DepositRepository {
  constructor(private readonly db: Database) {}

  async isSignatureRecorded(signature: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: deposits.id })
      .from(deposits)
      .where(eq(deposits.solanaTxSignature, signature));
    return !!row;
  }

  async findDeveloperIdByReference(reference: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: developers.id })
      .from(developers)
      .where(eq(developers.depositReference, reference));
    return row?.id ?? null;
  }

  async recordDeposit(input: {
    developerId: string;
    amountUsdc: number;
    signature: string;
  }): Promise<void> {
    await this.db.insert(deposits).values({
      developerId: input.developerId,
      amountUsdc: input.amountUsdc.toString(),
      solanaTxSignature: input.signature,
      confirmedAt: new Date(), // v0: credited the moment it's matched, no
      // separate confirmation-count wait — acceptable at current volume,
      // worth revisiting if double-spend/reorg risk becomes real later
    });
  }
}
