import "dotenv/config";
import { pool } from "./db";
import { hashPassword } from "./auth";

// Usage: node dist/create-admin.js <email> <password> <teamName>
// Idempotent: if a user with that email already exists, does nothing and
// exits cleanly (safe to run again on every deploy).
async function main() {
  const [, , email, password, teamName] = process.argv;
  if (!email || !password || !teamName) {
    console.error("Usage: node dist/create-admin.js <email> <password> <teamName>");
    process.exit(1);
  }

  const cleanEmail = email.trim().toLowerCase();

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [cleanEmail]);
  if (existing.rows.length > 0) {
    console.log(`Admin account ${cleanEmail} already exists — leaving it as is.`);
    await pool.end();
    return;
  }

  const teamResult = await pool.query(
    `INSERT INTO teams (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [teamName.trim()]
  );
  const teamId = teamResult.rows[0].id;

  const passwordHash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (email, password_hash, is_admin, team_id)
     VALUES ($1, $2, true, $3)`,
    [cleanEmail, passwordHash, teamId]
  );

  console.log(`Admin account created: ${cleanEmail} (team: ${teamName.trim()})`);
  await pool.end();
}

main().catch((err) => {
  console.error("Could not create admin account:", err);
  process.exit(1);
});
