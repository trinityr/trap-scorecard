import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

// GET /api/stats/leaderboard - the Team Leaderboard. Unlike /trends below,
// this one rolls a substitute's score into the line of the team member
// they subbed for (scores.sub_for_shooter_id), via COALESCE against the
// actual shooter. A shooter's own non-sub rounds still count under their
// own name/id as usual — only the specific rows where they were subbing
// for someone get redirected.
router.get("/leaderboard", async (req: Request, res: Response) => {
  const teamId = req.session.user!.teamId;
  if (!teamId) return res.json([]);
  try {
    const result = await pool.query(
      `
      SELECT
        COALESCE(sub.id, sh.id) AS shooter_id,
        COALESCE(sub.name, sh.name) AS name,
        COUNT(*)::int AS rounds,
        COUNT(*) FILTER (WHERE s.sub_for_shooter_id IS NOT NULL)::int AS subbed_rounds,
        ROUND(AVG(s.total)::numeric, 1)::float AS avg_total,
        MAX(s.total)::int AS best_total,
        ROUND(AVG(s.station_1)::numeric, 2)::float AS avg_station_1,
        ROUND(AVG(s.station_2)::numeric, 2)::float AS avg_station_2,
        ROUND(AVG(s.station_3)::numeric, 2)::float AS avg_station_3,
        ROUND(AVG(s.station_4)::numeric, 2)::float AS avg_station_4,
        ROUND(AVG(s.station_5)::numeric, 2)::float AS avg_station_5
      FROM scores s
      JOIN shooters sh ON sh.id = s.shooter_id
      LEFT JOIN shooters sub ON sub.id = s.sub_for_shooter_id
      JOIN rounds r ON r.id = s.round_id
      WHERE r.team_id = $1
      GROUP BY COALESCE(sub.id, sh.id), COALESCE(sub.name, sh.name)
      ORDER BY avg_total DESC
      `,
      [teamId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load leaderboard." });
  }
});

// GET /api/stats/trends - per-shooter score history over time. Deliberately
// NOT rolled up by sub_for_shooter_id — individual/statistical views always
// reflect who actually shot, even on rounds where they were subbing for
// someone else. Only /leaderboard above does the roll-up.
router.get("/trends", async (req: Request, res: Response) => {
  const teamId = req.session.user!.teamId;
  if (!teamId) return res.json([]);
  try {
    const result = await pool.query(
      `
      SELECT sh.name, to_char(r.round_date, 'YYYY-MM-DD') AS round_date, s.total
      FROM scores s
      JOIN shooters sh ON sh.id = s.shooter_id
      JOIN rounds r ON r.id = s.round_id
      WHERE r.team_id = $1
      ORDER BY sh.name, r.round_date ASC
      `,
      [teamId]
    );

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
