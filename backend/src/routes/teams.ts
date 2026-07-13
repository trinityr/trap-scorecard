import { Router, Request, Response } from "express";
import { pool } from "../db";

const router = Router();

// GET /api/teams - list all teams. Intentionally public (no auth) since
// the registration form needs to show existing teams before anyone is
// signed in. Team creation now happens either inline during registration
// or via /api/admin/teams (admin-only) — not here.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT id, name FROM teams ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load teams." });
  }
});

export default router;
