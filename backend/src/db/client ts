// Real DB connection. Uses the DIRECT (non-pooled) connection string for
// migrations and for pg-boss (which needs LISTEN/NOTIFY-style behavior
// that PgBouncer's transaction pooling mode breaks) — see the earlier
// note about Supabase's pooler needing the direct connection specifically
// for migrations. For ordinary app queries, Supabase's pooled connection
// string is fine and preferred to avoid exhausting direct connections.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDb>;
