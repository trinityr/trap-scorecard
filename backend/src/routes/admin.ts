import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requireAdmin } from "../auth";
import { getAllSettingsRaw, setSetting } from "../settings";

const router = Router();
router.use(requireAdmin);

// GET /api/admin/settings
router.get("/settings", async (_req: Request, res: Response) => {
  try {
    const settings = await getAllSettingsRaw();
    res.json({
      anthropic_api_key_set: Boolean(settings.anthropic_api_key || process.env.ANTHROPIC_API_KEY),
      cors_origin: settings.cors_origin || process.env.CORS_ORIGIN || "*",
      allow_registration: settings.allow_registration ?? "true",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load settings." });
  }
});

// PUT /api/admin/settings
router.put("/settings", async (req: Request, res: Response) => {
  const { anthropic_api_key, cors_origin, allow_registration } = req.body || {};
  try {
    if (typeof anthropic_api_key === "string" && anthropic_api_key.trim()) {
      await setSetting("anthropic_api_key", anthropic_api_key.trim());
    }
    if (typeof cors_origin === "string") {
      await setSetting("cors_origin", cors_origin.trim() || "*");
    }
    if (typeof allow_registration === "boolean") {
      await setSetting("allow_registration", String(allow_registration));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save settings." });
  }
});

// GET /api/admin/users
router.get("/users", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.is_admin, u.team_id, t.name AS team_name, u.created_at
      FROM users u
      LEFT JOIN teams t ON t.id = u.team_id
      ORDER BY u.created_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load users." });
  }
});

// PUT /api/admin/users/:id
router.put("/users/:id", async (req: Request, res: Response) => {
  const { isAdmin, teamId } = req.body || {};
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (typeof isAdmin === "boolean") {
    fields.push(`is_admin = $${i++}`);
    values.push(isAdmin);
  }
  if (teamId !== undefined) {
    fields.push(`team_id = $${i++}`);
    values.push(teamId || null);
  }
  if (fields.length === 0) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  try {
    values.push(req.params.id);
    await pool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${i}`, values);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update user." });
  }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async (req: Request, res: Response) => {
  if (req.session.user && String(req.session.user.id) === req.params.id) {
    return res.status(400).json({ error: "You can't remove your own account while signed in as it." });
  }
  try {
    await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove user." });
  }
});

// POST /api/admin/teams - team creation is admin-only after initial setup
// (new users can still create a team for themselves during registration)
router.post("/teams", async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "Team name is required." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO teams (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name`,
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create team." });
  }
});

export default router;
