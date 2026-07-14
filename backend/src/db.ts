import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Without these, a stuck/exhausted pool (e.g. leftover zombie
  // connections from a prior crash) makes pool.query() hang forever with
  // no error at all — which is exactly what a hung login/register looks
  // like from the outside. Fail fast and loud instead.
  connectionTimeoutMillis: 5000, // max time to wait for a free connection
  idleTimeoutMillis: 30000,      // close idle clients after 30s
  max: 10,                        // max clients in the pool
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});
