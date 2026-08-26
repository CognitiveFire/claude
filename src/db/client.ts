import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ConfigError, loadEnv } from '../config/env.ts';
import { registerSecret } from '../observability/redact.ts';
import * as schema from './schema.ts';

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let database: Database | null = null;

export function getDatabase(): Database {
  if (database) return database;

  const env = loadEnv();
  if (!env.DATABASE_URL) {
    throw new ConfigError(
      'DATABASE_URL is not set. This command needs the database — see .env.example.',
    );
  }
  registerSecret(env.DATABASE_URL);

  pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 });
  database = drizzle(pool, { schema });
  return database;
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = null;
  database = null;
}

export { schema };
