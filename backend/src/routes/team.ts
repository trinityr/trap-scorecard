import { Router, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

function canManageTeam(req: Request): boolean {
  return Boolean(req.session.user?.isAdmin || req.session.user?.isSquadLeader);
}

// GET /api/team/pending - accounts waiting for approval to join the
// signed-in user's own team. Visible to that team's Squad Leader(s) and to
// admins (scoped to whatever team the admin themselves belongs to — an
// admin managing every team's pending requests can also just use the full
// Admin > Users table, which shows and edits everyone regardless of team).
router.get("/pending", async (req: Request, res: Response) => {
  if (!canManageTeam(req)) {
    return res.status(403).json({ error: "Only a Squad Leader or admin can view pending requests." });
  }
  const teamId = req.session.user!.teamId;
  if (!teamId) return res.json([]);
  try {
    const result = await pool.query(
      "SELECT id, email, name, phone, created_at FROM users WHERE team_id = $1 AND team_approved = false ORDER BY created_at ASC",
      [teamId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load pending requests." });
  }
});

// POST /api/team/pending/:id/approve
router.post("/pending/:id/approve", async (req: Request, res: Response) => {
  if (!canManageTeam(req)) {
    return res.status(403).json({ error: "Only a Squad Leader or admin can approve requests." });
  }
  const teamId = req.session.user!.teamId;
  try {
    const result = await pool.query(
      "UPDATE users SET team_approved = true WHERE id = $1 AND team_id = $2 RETURNING id",
      [req.params.id, teamId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "That request isn't on your team." });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not approve that request." });
  }
});

// POST /api/team/pending/:id/deny - clears the pending user's team instead
// of deleting the account, so they can pick again (or an admin can place
// them somewhere) rather than losing the account outright.
router.post("/pending/:id/deny", async (req: Request, res: Response) => {
  if (!canManageTeam(req)) {
    return res.status(403).json({ error: "Only a Squad Leader or admin can deny requests." });
  }
  const teamId = req.session.user!.teamId;
  try {
    const result = await pool.query(
      "UPDATE users SET team_id = NULL, team_approved = true WHERE id = $1 AND team_id = $2 RETURNING id",
      [req.params.id, teamId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "That request isn't on your team." });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not deny that request." });
  }
});

export default router;
