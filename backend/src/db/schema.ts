// Mirrors schema.sql table-for-table. If you change one, change the other
// — this file has no independent authority over the shape of the DB;
// schema.sql (run directly against Supabase) is still what actually
// creates the tables. This is Drizzle's typed view of that same shape.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  jsonb,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const callStatus = pgEnum("call_status", [
  "authorized",
  "rejected",
  "held",
  "settled",
  "refunded",
]);

export const disputeStatus = pgEnum("dispute_status", [
  "open",
  "resolved_refund",
  "resolved_rejected",
]);

export const payoutStatus = pgEnum("payout_status", [
  "pending",
  "completed",
  "failed",
]);

export const providerStatus = pgEnum("provider_status", [
  "pending_review",
  "active",
  "suspended",
]);

export const mcpDescriptionStatus = pgEnum("mcp_description_status", [
  "draft",
  "approved",
]);

export const developers = pgTable("developers", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: uuid("auth_user_id").notNull().unique(),
  email: text("email").notNull().unique(),
  depositReference: text("deposit_reference").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providers = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: uuid("auth_user_id").notNull().unique(),
  name: text("name").notNull(),
  shortDescription: text("short_description").notNull(),
  category: text("category").notNull(),
  endpointUrl: text("endpoint_url").notNull(),
  priceUsdc: numeric("price_usdc", { precision: 18, scale: 6 }).notNull(),
  inputSchema: jsonb("input_schema").notNull(),
  outputSchema: jsonb("output_schema").notNull(),
  mcpDescription: text("mcp_description"),
  mcpDescriptionStatus: mcpDescriptionStatus("mcp_description_status")
    .notNull()
    .default("draft"),
  payoutWalletAddress: text("payout_wallet_address"),
  status: providerStatus("status").notNull().default("pending_review"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deposits = pgTable("deposits", {
  id: uuid("id").primaryKey().defaultRandom(),
  developerId: uuid("developer_id").notNull().references(() => developers.id),
  amountUsdc: numeric("amount_usdc", { precision: 18, scale: 6 }).notNull(),
  solanaTxSignature: text("solana_tx_signature").notNull().unique(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  developerId: uuid("developer_id").notNull().references(() => developers.id),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  requestPayload: jsonb("request_payload").notNull(),
  responsePayload: jsonb("response_payload"),
  structuralCheckPassed: boolean("structural_check_passed"),
  priceUsdc: numeric("price_usdc", { precision: 18, scale: 6 }).notNull(),
  responseLatencyMs: integer("response_latency_ms"),
  status: callStatus("status").notNull().default("authorized"),
  holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

export const disputes = pgTable("disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").notNull().unique().references(() => calls.id),
  developerId: uuid("developer_id").notNull().references(() => developers.id),
  reason: text("reason").notNull(),
  status: disputeStatus("status").notNull().default("open"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providerPayouts = pgTable("provider_payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  amountUsdc: numeric("amount_usdc", { precision: 18, scale: 6 }).notNull(),
  destinationWalletAddress: text("destination_wallet_address").notNull(),
  solanaTxSignature: text("solana_tx_signature").unique(),
  status: payoutStatus("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// developer_balances and provider_balances are Postgres VIEWS (see
// schema.sql), not tables — Drizzle doesn't manage their DDL. Repositories
// query them with a raw `sql` tag rather than a pgTable definition, since
// they're read-only derived data, not something this ORM layer writes to.
