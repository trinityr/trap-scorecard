import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

// GET /api/site/leaderboard - cross-team scoreboard, ranked by total
// combined score across all rounds ever logged. Intentionally not
// team-scoped — any signed-in user can see how every team/shooter stacks
// up site-wide, that's the point of this endpoint.
router.get("/leaderboard", async (_req: Request, res: Response) => {
  try {
    const individuals = await pool.query(`
      SELECT
        sh.id,
        sh.name,
        t.id AS team_id,
        t.name AS team_name,
        SUM(s.total)::int AS total_points,
        COUNT(*)::int AS rounds
      FROM scores s
      JOIN shooters sh ON sh.id = s.shooter_id
      JOIN teams t ON t.id = sh.team_id
      GROUP BY sh.id, sh.name, t.id, t.name
      ORDER BY total_points DESC
      LIMIT 10
    `);

    const teams = await pool.query(`
      SELECT
        t.id,
        t.name,
        SUM(s.total)::int AS total_points,
        COUNT(DISTINCT r.id)::int AS rounds
      FROM scores s
      JOIN rounds r ON r.id = s.round_id
      JOIN teams t ON t.id = r.team_id
      GROUP BY t.id, t.name
      ORDER BY total_points DESC
      LIMIT 10
    `);

    res.json({
      individuals: individuals.rows,
      teams: teams.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the site-wide scoreboard." });
  }
});

export default router;
