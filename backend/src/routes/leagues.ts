import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

// GET /api/leagues - every league's full info (location, contact, schedule,
// costs). Deliberately requireAuth only, not requireApprovedTeam — a
// signed-in user with no team yet (or a pending join) can still browse
// league info, since this isn't scoring/stat data.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, name, location, contact_name, contact_email, contact_phone, schedule_text, costs_text, description
      FROM leagues
      ORDER BY name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load leagues." });
  }
});

export default router;
