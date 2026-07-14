import { Pool } from "pg";

const commonOptions = {
  // Without these, a stuck/exhausted pool (e.g. leftover zombie
  // connections from a prior crash) makes pool.query() hang forever with
  // no error at all — which is exactly what a hung login/register looks
  // like from the outside. Fail fast and loud instead.
  connectionTimeoutMillis: 5000, // max time to wait for a free connection
  idleTimeoutMillis: 30000,      // close idle clients after 30s
  max: 10,                        // max clients in the pool
};

// Prefer individual connection parameters over a single connection-string
// URL. A password containing characters like "/" or "@" (entirely
// possible from something like `openssl rand -base64`) breaks URL
// parsing when embedded in a "postgres://user:pass@host/db" string,
// causing every single query to fail with a cryptic "Invalid URL" error.
// Individual fields sidestep that whole problem — the password is never
// parsed as part of a URL at all.
export const pool = process.env.POSTGRES_HOST
  ? new Pool({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT) || 5432,
      database: process.env.POSTGRES_DB || "trapscores",
      user: process.env.POSTGRES_USER || "trapadmin",
      password: process.env.POSTGRES_PASSWORD,
      ...commonOptions,
    })
  : new Pool({
      // Fallback for local development against a DATABASE_URL-style setup
      // (e.g. a cloud Postgres instance) where individual fields aren't set.
      connectionString: process.env.DATABASE_URL,
      ...commonOptions,
    });

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});
