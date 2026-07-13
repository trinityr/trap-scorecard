import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";
import { ShooterScore } from "../types";

const router = Router();
router.use(requireAuth);

function autoTotal(stations: (number | null)[] | undefined): number | null {
  if (!stations) return null;
  const nums = stations.filter((n): n is number => typeof n === "number");
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0);
}

// POST /api/rounds - save a week's scoresheet for the signed-in user's team
router.post("/", async (req: Request, res: Response) => {
  const teamId = req.session.user!.teamId;
  const body = req.body as { date?: string; shooters?: ShooterScore[] };

  if (!teamId) {
    return res.status(400).json({ error: "Your account isn't attached to a team." });
  }
  if (!body?.date || !Array.isArray(body.shooters) || body.shooters.length === 0) {
    return res.status(400).json({ error: "Request needs a date and at least one shooter." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const roundResult = await client.query(
      "INSERT INTO rounds (team_id, round_date) VALUES ($1, $2) RETURNING id",
      [teamId, body.date]
    );
    const roundId = roundResult.rows[0].id;

    for (const shooter of body.shooters) {
      const name = shooter.name?.trim();
      if (!name) continue;

      const total = shooter.total ?? autoTotal(shooter.stations);
      if (total == null) continue;

      const shooterResult = await client.query(
        `INSERT INTO shooters (team_id, name) VALUES ($1, $2)
         ON CONFLICT (team_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [teamId, name]
      );
      const shooterId = shooterResult.rows[0].id;

      const stations = shooter.stations ?? [null, null, null, null, null];
      await client.query(
        `INSERT INTO scores (round_id, shooter_id, station_1, station_2, station_3, station_4, station_5, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [roundId, shooterId, stations[0], stations[1], stations[2], stations[3], stations[4], total]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ id: roundId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Could not save round." });
  } finally {
    client.release();
  }
});

// GET /api/rounds - every saved round with scores, for the signed-in user's team
router.get("/", async (req: Request, res: Response) => {
  const teamId = req.session.user!.teamId;
  if (!teamId) return res.json([]);

  try {
    const rounds = await pool.query(
      "SELECT id, round_date FROM rounds WHERE team_id = $1 ORDER BY round_date DESC",
      [teamId]
    );

    const scores = await pool.query(
      `SELECT s.round_id, sh.name, s.station_1, s.station_2, s.station_3, s.station_4, s.station_5, s.total
       FROM scores s
       JOIN shooters sh ON sh.id = s.shooter_id
       JOIN rounds r ON r.id = s.round_id
       WHERE r.team_id = $1`,
      [teamId]
    );

    const byRound: Record<number, any[]> = {};
    for (const row of scores.rows) {
      if (!byRound[row.round_id]) byRound[row.round_id] = [];
      byRound[row.round_id].push({
        name: row.name,
        stations: [row.station_1, row.station_2, row.station_3, row.station_4, row.station_5],
        total: row.total,
      });
    }

    res.json(
      rounds.rows.map((r) => ({
        id: r.id,
        date: r.round_date,
        shooters: byRound[r.id] || [],
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load rounds." });
  }
});

// DELETE /api/rounds/:id - scoped to the signed-in user's own team
router.delete("/:id", async (req: Request, res: Response) => {
  const teamId = req.session.user!.teamId;
  try {
    await pool.query("DELETE FROM rounds WHERE id = $1 AND team_id = $2", [req.params.id, teamId]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete round." });
  }
});

export default router;
