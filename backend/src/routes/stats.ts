import { Router, Request, Response } from "express";
import { pool } from "../db";

const router = Router();

// GET /api/stats/leaderboard
router.get("/leaderboard", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        sh.name,
        COUNT(*)::int AS rounds,
        ROUND(AVG(s.total)::numeric, 1)::float AS avg_total,
        MAX(s.total)::int AS best_total,
        ROUND(AVG(s.station_1)::numeric, 2)::float AS avg_station_1,
        ROUND(AVG(s.station_2)::numeric, 2)::float AS avg_station_2,
        ROUND(AVG(s.station_3)::numeric, 2)::float AS avg_station_3,
        ROUND(AVG(s.station_4)::numeric, 2)::float AS avg_station_4,
        ROUND(AVG(s.station_5)::numeric, 2)::float AS avg_station_5
      FROM scores s
      JOIN shooters sh ON sh.id = s.shooter_id
      GROUP BY sh.name
      ORDER BY avg_total DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load leaderboard." });
  }
});

// GET /api/stats/trends - per-shooter score history over time
router.get("/trends", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT sh.name, r.round_date, s.total
      FROM scores s
      JOIN shooters sh ON sh.id = s.shooter_id
      JOIN rounds r ON r.id = s.round_id
      ORDER BY sh.name, r.round_date ASC
    `);

    const byName: Record<string, { date: string; total: number }[]> = {};
    for (const row of result.rows) {
      if (!byName[row.name]) byName[row.name] = [];
      byName[row.name].push({ date: row.round_date, total: row.total });
    }

    res.json(
      Object.entries(byName).map(([name, history]) => ({ name, history }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load trends." });
  }
});

export default router;
