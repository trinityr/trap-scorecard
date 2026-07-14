import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();

// GET /api/teams - list all teams. Intentionally public (no auth) since
// the registration form needs to show existing teams before anyone is
// signed in. Team creation now happens either inline during registration
// or via /api/admin/teams (admin-only) — not here.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.name, t.logo_data, t.league_id, l.name AS league_name
      FROM teams t
      LEFT JOIN leagues l ON l.id = t.league_id
      ORDER BY t.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load teams." });
  }
});

// PUT /api/teams/:id/logo - set or clear a team's logo. An admin can do
// this for any team; a Squad Leader only for their own team. Body:
// { logoData: "data:image/...;base64,..." } to set, or { logoData: null }
// to clear. The image is expected to already be resized/compressed
// client-side before this is called, same as the scoresheet extractor.
router.put("/:id/logo", requireAuth, async (req: Request, res: Response) => {
  const user = req.session.user!;
  const teamId = Number(req.params.id);
  const isOwnTeam = user.teamId === teamId;
  if (!user.isAdmin && !(user.isSquadLeader && isOwnTeam)) {
    return res.status(403).json({ error: "Only that team's Squad Leader or an admin can change its logo." });
  }

  const { logoData } = req.body || {};
  if (logoData != null && (typeof logoData !== "string" || !logoData.startsWith("data:image/"))) {
    return res.status(400).json({ error: "logoData must be a data:image/... URL, or null to clear it." });
  }

  try {
    const result = await pool.query(
      "UPDATE teams SET logo_data = $1 WHERE id = $2 RETURNING id, name, logo_data",
      [logoData || null, teamId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Team not found." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update the team logo." });
  }
});

export default router;
