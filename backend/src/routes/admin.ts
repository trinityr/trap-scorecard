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
      // Not secret (it's meant to be embedded in the frontend), so this is
      // returned as-is rather than masked like the Anthropic key above.
      google_client_id: settings.google_client_id || process.env.GOOGLE_CLIENT_ID || "",
      // SMTP, used to email Squad Leaders/admins about pending team-join
      // requests. Host/port/user/from aren't secret; the password is
      // masked the same way the Anthropic key is.
      smtp_host: settings.smtp_host || process.env.SMTP_HOST || "",
      smtp_port: settings.smtp_port || process.env.SMTP_PORT || "",
      smtp_user: settings.smtp_user || process.env.SMTP_USER || "",
      smtp_from: settings.smtp_from || process.env.SMTP_FROM || "",
      smtp_pass_set: Boolean(settings.smtp_pass || process.env.SMTP_PASS),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load settings." });
  }
});

// PUT /api/admin/settings
router.put("/settings", async (req: Request, res: Response) => {
  const {
    anthropic_api_key, cors_origin, allow_registration, google_client_id,
    smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from,
  } = req.body || {};
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
    if (typeof google_client_id === "string") {
      await setSetting("google_client_id", google_client_id.trim());
    }
    if (typeof smtp_host === "string") {
      await setSetting("smtp_host", smtp_host.trim());
    }
    if (typeof smtp_port === "string") {
      await setSetting("smtp_port", smtp_port.trim());
    }
    if (typeof smtp_user === "string") {
      await setSetting("smtp_user", smtp_user.trim());
    }
    if (typeof smtp_pass === "string" && smtp_pass.trim()) {
      await setSetting("smtp_pass", smtp_pass.trim());
    }
    if (typeof smtp_from === "string") {
      await setSetting("smtp_from", smtp_from.trim());
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
      SELECT u.id, u.email, u.name, u.phone, u.is_admin, u.is_squad_leader, u.team_approved, u.team_id, t.name AS team_name, u.created_at
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
  const { isAdmin, isSquadLeader, teamApproved, teamId } = req.body || {};
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (typeof isAdmin === "boolean") {
    fields.push(`is_admin = $${i++}`);
    values.push(isAdmin);
  }
  if (typeof isSquadLeader === "boolean") {
    fields.push(`is_squad_leader = $${i++}`);
    values.push(isSquadLeader);
  }
  if (typeof teamApproved === "boolean") {
    fields.push(`team_approved = $${i++}`);
    values.push(teamApproved);
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

// PUT /api/admin/teams/:id - rename a team and/or assign/clear its League.
// leagueId is optional: omit it entirely to leave the league untouched,
// pass a number to assign, or pass null to clear it.
router.put("/teams/:id", async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "Team name is required." });
  }
  const { leagueId } = req.body || {};
  const fields = ["name = $1"];
  const values: any[] = [name];
  let i = 2;
  if (leagueId !== undefined) {
    fields.push(`league_id = $${i++}`);
    values.push(leagueId || null);
  }
  try {
    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE teams SET ${fields.join(", ")} WHERE id = $${i} RETURNING id, name, league_id`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Team not found." });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A team with that name already exists." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not rename team." });
  }
});

// DELETE /api/admin/teams/:id - deletes the team and (via ON DELETE CASCADE)
// every shooter, round, and score that belongs to it. Blocked while any
// user account is still assigned to the team, so an admin can't accidentally
// orphan someone's login mid-season — reassign or remove those users first.
router.delete("/teams/:id", async (req: Request, res: Response) => {
  try {
    const memberCheck = await pool.query("SELECT COUNT(*)::int AS c FROM users WHERE team_id = $1", [req.params.id]);
    if (memberCheck.rows[0].c > 0) {
      return res.status(400).json({ error: "This team still has users assigned to it. Reassign or remove them first." });
    }
    const result = await pool.query("DELETE FROM teams WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Team not found." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete team. Make sure no rounds or shooters reference it." });
  }
});

// ---------- Admin: Leagues ----------
// A League is an optional grouping teams can belong to (many teams per
// league, one league per team) — info, location, contact, schedule, and
// cost breakdown, shown in the app's League tab. Built for scalability:
// this deployment might only ever have one league, but the model supports
// several from day one.

// POST /api/admin/leagues
router.post("/leagues", async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "League name is required." });
  }
  const { location, contactName, contactEmail, contactPhone, scheduleText, costsText, description } = req.body || {};
  try {
    const result = await pool.query(
      `INSERT INTO leagues (name, location, contact_name, contact_email, contact_phone, schedule_text, costs_text, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, location, contact_name, contact_email, contact_phone, schedule_text, costs_text, description`,
      [
        name,
        String(location || "").trim() || null,
        String(contactName || "").trim() || null,
        String(contactEmail || "").trim() || null,
        String(contactPhone || "").trim() || null,
        String(scheduleText || "").trim() || null,
        String(costsText || "").trim() || null,
        String(description || "").trim() || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A league with that name already exists." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not create league." });
  }
});

// PUT /api/admin/leagues/:id - full replace of a league's info fields
router.put("/leagues/:id", async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "League name is required." });
  }
  const { location, contactName, contactEmail, contactPhone, scheduleText, costsText, description } = req.body || {};
  try {
    const result = await pool.query(
      `UPDATE leagues SET name = $1, location = $2, contact_name = $3, contact_email = $4,
         contact_phone = $5, schedule_text = $6, costs_text = $7, description = $8
       WHERE id = $9
       RETURNING id, name, location, contact_name, contact_email, contact_phone, schedule_text, costs_text, description`,
      [
        name,
        String(location || "").trim() || null,
        String(contactName || "").trim() || null,
        String(contactEmail || "").trim() || null,
        String(contactPhone || "").trim() || null,
        String(scheduleText || "").trim() || null,
        String(costsText || "").trim() || null,
        String(description || "").trim() || null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "League not found." });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "A league with that name already exists." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not update league." });
  }
});

// DELETE /api/admin/leagues/:id - teams pointing at this league just have
// their league_id cleared (ON DELETE SET NULL), so deleting a league never
// touches any team, shooter, round, or score data.
router.delete("/leagues/:id", async (req: Request, res: Response) => {
  try {
    const result = await pool.query("DELETE FROM leagues WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "League not found." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete league." });
  }
});

// GET /api/admin/shooters - every shooter across every team, with a round count
router.get("/shooters", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT sh.id, sh.name, sh.team_id, t.name AS team_name, COUNT(s.id)::int AS rounds
      FROM shooters sh
      JOIN teams t ON t.id = sh.team_id
      LEFT JOIN scores s ON s.shooter_id = sh.id
      GROUP BY sh.id, sh.name, sh.team_id, t.name
      ORDER BY t.name ASC, sh.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load shooters." });
  }
});

// POST /api/admin/shooters - add a shooter to the roster ahead of their first round
router.post("/shooters", async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const teamId = req.body?.teamId;
  if (!name || !teamId) {
    return res.status(400).json({ error: "A name and team are required." });
  }
  try {
    const result = await pool.query(
      "INSERT INTO shooters (team_id, name) VALUES ($1, $2) RETURNING id, name, team_id",
      [Number(teamId), name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "That team already has a shooter with this name." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not add shooter." });
  }
});

// PUT /api/admin/shooters/:id - rename a shooter and/or move them to a
// different team. Renaming (or reassigning) updates the shooters row in
// place, so all of that shooter's historical scores follow along, since
// they're linked by shooter_id, not by name.
router.put("/shooters/:id", async (req: Request, res: Response) => {
  const { name, teamId } = req.body || {};
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (typeof name === "string" && name.trim()) {
    fields.push(`name = $${i++}`);
    values.push(name.trim());
  }
  if (teamId !== undefined && teamId !== null) {
    fields.push(`team_id = $${i++}`);
    values.push(Number(teamId));
  }
  if (fields.length === 0) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  try {
    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE shooters SET ${fields.join(", ")} WHERE id = $${i} RETURNING id, name, team_id`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Shooter not found." });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "That team already has a shooter with this name." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not update shooter." });
  }
});

// DELETE /api/admin/shooters/:id - also deletes every score row tied to
// this shooter (ON DELETE CASCADE on scores.shooter_id), i.e. their whole
// history. The frontend confirms this explicitly before calling it.
router.delete("/shooters/:id", async (req: Request, res: Response) => {
  try {
    const result = await pool.query("DELETE FROM shooters WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Shooter not found." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete shooter." });
  }
});

// GET /api/admin/rounds - every round across every team, newest first
router.get("/rounds", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.team_id, t.name AS team_name, to_char(r.round_date, 'YYYY-MM-DD') AS round_date, r.round_number, r.yardage, COUNT(s.id)::int AS shooter_count
      FROM rounds r
      JOIN teams t ON t.id = r.team_id
      LEFT JOIN scores s ON s.round_id = r.id
      GROUP BY r.id, r.team_id, t.name, r.round_date, r.round_number, r.yardage
      ORDER BY r.round_date DESC, r.round_number DESC, r.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load rounds." });
  }
});

// GET /api/admin/rounds/:id - one round's full shooter/score detail, for editing
router.get("/rounds/:id", async (req: Request, res: Response) => {
  try {
    const roundResult = await pool.query(
      `SELECT r.id, r.team_id, t.name AS team_name, to_char(r.round_date, 'YYYY-MM-DD') AS round_date, r.round_number, r.yardage
       FROM rounds r JOIN teams t ON t.id = r.team_id WHERE r.id = $1`,
      [req.params.id]
    );
    const round = roundResult.rows[0];
    if (!round) {
      return res.status(404).json({ error: "Round not found." });
    }
    const scores = await pool.query(
      `SELECT sh.id AS shooter_id, sh.name, s.station_1, s.station_2, s.station_3, s.station_4, s.station_5, s.total, subsh.name AS sub_for_name
       FROM scores s
       JOIN shooters sh ON sh.id = s.shooter_id
       LEFT JOIN shooters subsh ON subsh.id = s.sub_for_shooter_id
       WHERE s.round_id = $1 ORDER BY sh.name ASC`,
      [req.params.id]
    );
    res.json({
      id: round.id,
      teamId: round.team_id,
      teamName: round.team_name,
      date: round.round_date,
      roundNumber: round.round_number,
      yardage: round.yardage,
      shooters: scores.rows.map((row) => ({
        shooterId: row.shooter_id,
        name: row.name,
        stations: [row.station_1, row.station_2, row.station_3, row.station_4, row.station_5],
        total: row.total,
        subFor: row.sub_for_name || null,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load round." });
  }
});

// Shared by PUT /rounds/:id below: upserts each shooter (and their
// "subbing for" target, if any) against teamId's roster, then inserts
// their score row for roundId. Pulled out so the same logic can run once
// per round when an edit splits one saved round into several.
async function insertScoresForShooters(client: any, roundId: number, teamId: number, shooters: any[]) {
  for (const shooter of shooters) {
    const name = String(shooter?.name || "").trim();
    if (!name) continue;
    const stations = Array.isArray(shooter.stations) ? shooter.stations : [null, null, null, null, null];
    const nums = stations.filter((n: any) => typeof n === "number");
    const total = shooter.total ?? (nums.length ? nums.reduce((a: number, b: number) => a + b, 0) : null);
    if (total == null) continue;

    const shooterResult = await client.query(
      `INSERT INTO shooters (team_id, name) VALUES ($1, $2)
       ON CONFLICT (team_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [teamId, name]
    );
    const shooterId = shooterResult.rows[0].id;

    let subForShooterId: number | null = null;
    const subForName = String(shooter?.subFor || "").trim();
    if (subForName && subForName.toLowerCase() !== name.toLowerCase()) {
      const subResult = await client.query(
        `INSERT INTO shooters (team_id, name) VALUES ($1, $2)
         ON CONFLICT (team_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [teamId, subForName]
      );
      subForShooterId = subResult.rows[0].id;
    }

    await client.query(
      `INSERT INTO scores (round_id, shooter_id, sub_for_shooter_id, station_1, station_2, station_3, station_4, station_5, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [roundId, shooterId, subForShooterId, stations[0], stations[1], stations[2], stations[3], stations[4], total]
    );
  }
}

// PUT /api/admin/rounds/:id - replace a round's date, round number, yardage,
// team, and full set of shooter scores (including who subbed for whom).
// If teamId is provided and differs from the round's current team, the
// round is moved to that team and every shooter listed (including subs)
// is resolved/created against the NEW team's roster — same as reassigning
// a shooter's team elsewhere in the admin panel. All old score rows for
// the round are replaced with the new set either way.
//
// Each shooter in the body may carry its own optional roundNumber (the
// admin editor's per-row "Rnd" column, same idea as New Round). Rows are
// grouped by that number: the lowest group reuses this round's existing
// id, and any additional groups become brand-new round records with the
// same date/yardage/team. This is how an admin retroactively splits a
// round that the Read Scoresheet extractor (or a combined manual entry)
// accidentally merged into one record.
router.put("/rounds/:id", async (req: Request, res: Response) => {
  const { date, yardage, roundNumber, teamId: requestedTeamId, shooters } = req.body || {};
  if (!date || !Array.isArray(shooters)) {
    return res.status(400).json({ error: "Request needs a date and a shooters array." });
  }
  const cleanYardage = yardage != null && yardage !== "" ? Number(yardage) : null;
  const defaultRoundNumber = roundNumber != null && roundNumber !== "" ? Number(roundNumber) : 1;

  const groups = new Map<number, any[]>();
  for (const shooter of shooters) {
    const rnd = shooter?.roundNumber != null && shooter.roundNumber !== "" ? Number(shooter.roundNumber) : defaultRoundNumber;
    if (!groups.has(rnd)) groups.set(rnd, []);
    groups.get(rnd)!.push(shooter);
  }
  const roundNumbers = Array.from(groups.keys()).sort((a, b) => a - b);
  if (roundNumbers.length === 0) roundNumbers.push(defaultRoundNumber);

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const roundCheck = await client.query("SELECT team_id FROM rounds WHERE id = $1", [req.params.id]);
    const currentTeamId = roundCheck.rows[0]?.team_id;
    if (!currentTeamId) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Round not found." });
    }
    const teamId = requestedTeamId ? Number(requestedTeamId) : currentTeamId;

    const firstRoundNumber = roundNumbers[0];
    await client.query("UPDATE rounds SET round_date = $1, yardage = $2, round_number = $3, team_id = $4 WHERE id = $5", [
      date,
      cleanYardage,
      firstRoundNumber,
      teamId,
      req.params.id,
    ]);
    await client.query("DELETE FROM scores WHERE round_id = $1", [req.params.id]);
    await insertScoresForShooters(client, Number(req.params.id), teamId, groups.get(firstRoundNumber) || []);

    const splitIntoRoundIds: number[] = [];
    for (const rnd of roundNumbers.slice(1)) {
      const newRoundResult = await client.query(
        "INSERT INTO rounds (team_id, round_date, yardage, round_number) VALUES ($1, $2, $3, $4) RETURNING id",
        [teamId, date, cleanYardage, rnd]
      );
      const newRoundId = newRoundResult.rows[0].id;
      splitIntoRoundIds.push(newRoundId);
      await insertScoresForShooters(client, newRoundId, teamId, groups.get(rnd) || []);
    }

    await client.query("COMMIT");
    res.json({ ok: true, splitIntoRoundIds });
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Rollback also failed:", rollbackErr);
      }
    }
    console.error(err);
    res.status(500).json({ error: "Could not update round." });
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/admin/rounds/:id - deletes any round regardless of team
// (the regular DELETE /api/rounds/:id is scoped to the caller's own team;
// this one isn't, since admins manage rounds across every team)
router.delete("/rounds/:id", async (req: Request, res: Response) => {
  try {
    const result = await pool.query("DELETE FROM rounds WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Round not found." });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete round." });
  }
});

export default router;
