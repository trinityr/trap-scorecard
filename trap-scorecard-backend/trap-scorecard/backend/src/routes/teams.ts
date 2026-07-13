import { Router, Request, Response } from "express";
import { pool } from "../db";

const router = Router();

// GET /api/teams - list all teams
router.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT id, name FROM teams ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load teams." });
  }
});

// POST /api/teams - create a team, or return the existing one with that name
router.post("/", async (req: Request, res: Response) => {
  const name = (req.body?.name as string || "").trim();
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
