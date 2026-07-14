import { Router, Request, Response } from "express";
import { pool } from "../db";
import { hashPassword, verifyPassword, requireAuth } from "../auth";
import { getSetting } from "../settings";

const router = Router();

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  const { email, password, name, teamId, newTeamName } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanName = String(name || "").trim() || null;

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const countResult = await client.query("SELECT COUNT(*)::int AS c FROM users");
    const isFirstUser = countResult.rows[0].c === 0;

    if (!isFirstUser) {
      const allowRegistration = await getSetting("allow_registration", "true");
      if (allowRegistration === "false") {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Registration is currently closed. Ask an admin to add you." });
      }
    }

    const existing = await client.query("SELECT id FROM users WHERE email = $1", [cleanEmail]);
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    let teamIdToUse: number | null = null;
    const trimmedNewTeamName = String(newTeamName || "").trim();
    if (trimmedNewTeamName) {
      const teamResult = await client.query(
        `INSERT INTO teams (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [trimmedNewTeamName]
      );
      teamIdToUse = teamResult.rows[0].id;
    } else if (teamId) {
      teamIdToUse = Number(teamId);
    }

    if (!teamIdToUse) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Pick an existing team or create a new one." });
    }

    const passwordHash = await hashPassword(String(password));
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, name, is_admin, team_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, phone, address, is_admin, team_id`,
      [cleanEmail, passwordHash, cleanName, isFirstUser, teamIdToUse]
    );

    await client.query("COMMIT");

    const user = userResult.rows[0];
    const teamRow = await pool.query("SELECT name FROM teams WHERE id = $1", [user.team_id]);

    req.session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      address: user.address,
      isAdmin: user.is_admin,
      teamId: user.team_id,
      teamName: teamRow.rows[0]?.name,
    };
    res.status(201).json(req.session.user);
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Rollback also failed:", rollbackErr);
      }
    }
    console.error(err);
    res.status(500).json({ error: "Could not register." });
  } finally {
    if (client) client.release();
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await pool.query(
      "SELECT id, email, password_hash, name, phone, address, is_admin, team_id FROM users WHERE email = $1",
      [cleanEmail]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    const ok = await verifyPassword(String(password), row.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    let teamName: string | undefined;
    if (row.team_id) {
      const t = await pool.query("SELECT name FROM teams WHERE id = $1", [row.team_id]);
      teamName = t.rows[0]?.name;
    }

    req.session.user = {
      id: row.id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      address: row.address,
      isAdmin: row.is_admin,
      teamId: row.team_id,
      teamName,
    };
    res.json(req.session.user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not sign in." });
  }
});

// POST /api/auth/logout
router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

// GET /api/auth/me
router.get("/me", (req: Request, res: Response) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not signed in." });
  }
  res.json(req.session.user);
});

// PUT /api/auth/me — lets a signed-in user set/change their own display
// name and basic contact info (phone, address). This is the "User Profile"
// tab in the frontend. Scoped to the current session's user only — there's
// no :id param, so there's no way to edit anyone else's profile through
// this route.
router.put("/me", requireAuth, async (req: Request, res: Response) => {
  const { name, phone, address } = req.body || {};
  const cleanName = String(name ?? "").trim();
  const cleanPhone = String(phone ?? "").trim();
  const cleanAddress = String(address ?? "").trim();

  try {
    const result = await pool.query(
      "UPDATE users SET name = $1, phone = $2, address = $3 WHERE id = $4 RETURNING id, email, name, phone, address, is_admin, team_id",
      [cleanName || null, cleanPhone || null, cleanAddress || null, req.session.user!.id]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Account not found." });
    }

    req.session.user!.name = row.name;
    req.session.user!.phone = row.phone;
    req.session.user!.address = row.address;
    res.json(req.session.user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update your profile." });
  }
});

export default router;
