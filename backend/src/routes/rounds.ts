import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth, requireApprovedTeam } from "../auth";
import { ShooterScore } from "../types";

const router = Router();
router.use(requireAuth);
router.use(requireApprovedTeam);

function autoTotal(stations: (number | null)[] | undefined): number | null {
  if (!stations) return null;
  const nums = stations.filter((n): n is number => typeof n === "number");
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0);
}

// POST /api/rounds - save a week's scoresheet for the signed-in user's team.
// Admins may pass a teamId to log a round for a different team than their
// own (e.g. entering a scoresheet on behalf of another squad) — that
// override is ignored for non-admins, who are always locked to their own
// session team regardless of what's in the request body.
router.post("/", async (req: Request, res: Response) => {
  const isAdmin = req.session.user!.isAdmin;
  const body = req.body as {
    date?: string;
    yardage?: number | string | null;
    roundNumber?: number | string | null;
    teamId?: number | string | null;
    shooters?: ShooterScore[];
  };
  const teamId = isAdmin && body.teamId ? Number(body.teamId) : req.session.user!.teamId;

  if (!teamId) {
    return res.status(400).json({ error: "Your account isn't attached to a team." });
  }
  if (!body?.date || !Array.isArray(body.shooters) || body.shooters.length === 0) {
    return res.status(400).json({ error: "Request needs a date and at least one shooter." });
  }
  const yardage = body.yardage != null && body.yardage !== "" ? Number(body.yardage) : null;
  const roundNumber = body.roundNumber != null && body.roundNumber !== "" ? Number(body.roundNumber) : 1;

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const roundResult = await client.query(
      "INSERT INTO rounds (team_id, round_date, yardage, round_number) VALUES ($1, $2, $3, $4) RETURNING id",
      [teamId, body.date, yardage, roundNumber]
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

      // If this shooter subbed for a team member, resolve (or create) that
      // member's own roster row so the substitution can be rolled into
      // their Team Leaderboard line later. A shooter can't sub for themself.
      let subForShooterId: number | null = null;
      const subForName = shooter.subFor?.trim();
      if (subForName && subForName.toLowerCase() !== name.toLowerCase()) {
        const subResult = await client.query(
          `INSERT INTO shooters (team_id, name) VALUES ($1, $2)
           ON CONFLICT (team_id, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [teamId, subForName]
        );
        subForShooterId = subResult.rows[0].id;
      }

      const stations = shooter.stations ?? [null, null, null, null, null];
      await client.query(
        `INSERT INTO scores (round_id, shooter_id, sub_for_shooter_id, station_1, station_2, station_3, station_4, station_5, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [roundId, shooterId, subForShooterId, stations[0], stations[1], stations[2], stations[3], stations[4], total]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ id: roundId });
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Rollback also failed:", rollbackErr);
      }
    }
    console.error(err);
    res.status(500).json({ error: "Could not save round." });
  } finally {
    if (client) client.release();
  }
});

// GET /api/rounds - every saved round with scores, for the signed-in user's team
router.get("/", async (req: Request, res: Response) => {
  const teamId = req.session.user!.teamId;
  if (!teamId) return res.json([]);

  try {
    const rounds = await pool.query(
      "SELECT id, to_char(round_date, 'YYYY-MM-DD') AS round_date, yardage, round_number FROM rounds WHERE team_id = $1 ORDER BY round_date DESC, round_number DESC",
      [teamId]
    );

    const scores = await pool.query(
      `SELECT s.round_id, sh.name, s.station_1, s.station_2, s.station_3, s.station_4, s.station_5, s.total, subsh.name AS sub_for_name
       FROM scores s
       JOIN shooters sh ON sh.id = s.shooter_id
       LEFT JOIN shooters subsh ON subsh.id = s.sub_for_shooter_id
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
        subFor: row.sub_for_name || null,
      });
    }

    res.json(
      rounds.rows.map((r) => ({
        id: r.id,
        date: r.round_date,
        yardage: r.yardage,
        roundNumber: r.round_number,
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
