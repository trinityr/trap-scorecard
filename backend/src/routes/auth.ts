import { Router, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { pool } from "../db";
import { hashPassword, verifyPassword, requireAuth } from "../auth";
import { getSetting } from "../settings";
import { sendMail } from "../email";

const router = Router();

// Emails that team's Squad Leaders (falling back to admins if the team
// somehow has no Squad Leader yet) that someone new is waiting on their
// approval. Fire-and-forget from the caller's perspective — sendMail()
// itself never throws, so this never blocks or fails the request that
// triggered it.
async function notifyTeamOfPendingRequest(teamId: number, applicantEmail: string, applicantName: string | null): Promise<void> {
  try {
    const teamResult = await pool.query("SELECT name FROM teams WHERE id = $1", [teamId]);
    const teamName = teamResult.rows[0]?.name || "your team";

    let recipients = await pool.query(
      "SELECT email FROM users WHERE team_id = $1 AND is_squad_leader = true",
      [teamId]
    );
    if (recipients.rows.length === 0) {
      recipients = await pool.query(
        "SELECT email FROM users WHERE team_id = $1 AND is_admin = true",
        [teamId]
      );
    }
    const to = recipients.rows.map((r) => r.email).filter(Boolean);
    if (to.length === 0) return;

    const who = applicantName ? `${applicantName} (${applicantEmail})` : applicantEmail;
    await sendMail(
      to,
      `Trap Scorecard: ${who} wants to join ${teamName}`,
      `${who} just requested to join ${teamName} on Trap Scorecard and is waiting for approval.\n\nSign in and open the Team tab to approve or deny the request.`,
      `<p><b>${who}</b> just requested to join <b>${teamName}</b> on Trap Scorecard and is waiting for approval.</p><p>Sign in and open the <b>Team</b> tab to approve or deny the request.</p>`
    );
  } catch (err) {
    console.error("[email] Could not notify team about pending request:", err);
  }
}

// Shared session-shape builder so /login, /register, /google, and /team all
// produce an identical req.session.user object.
function buildSessionUser(row: any, teamName: string | undefined) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    address: row.address,
    isAdmin: row.is_admin,
    isSquadLeader: row.is_squad_leader,
    teamId: row.team_id,
    teamName,
    teamApproved: row.team_approved,
  };
}

async function lookupTeamName(teamId: number | null): Promise<string | undefined> {
  if (!teamId) return undefined;
  const t = await pool.query("SELECT name FROM teams WHERE id = $1", [teamId]);
  return t.rows[0]?.name;
}

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  const { email, password, name, teamId, newTeamName } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanName = String(name || "").trim() || null;

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const countResult = await client.query("SELECT COUNT(*)::int AS c FROM users");
    const isFirstUser = countResult.rows[0].c === 0;

    if (!isFirstUser) {
      const allowRegistration = await getSetting("allow_registration", "true");
      if (allowRegistration === "false") {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Registration is currently closed. Ask an admin to add you." });
      }
    }

    const existing = await client.query("SELECT id FROM users WHERE email = $1", [cleanEmail]);
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    let teamIdToUse: number | null = null;
    const trimmedNewTeamName = String(newTeamName || "").trim();
    const createdNewTeam = Boolean(trimmedNewTeamName);
    if (createdNewTeam) {
      const teamResult = await client.query(
        `INSERT INTO teams (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [trimmedNewTeamName]
      );
      teamIdToUse = teamResult.rows[0].id;
    } else if (teamId) {
      teamIdToUse = Number(teamId);
    }
    // teamIdToUse staying null is fine — team is optional at registration
    // now. A teamless account signs in and browses in view-only mode, with
    // a "Join a Team" tab to pick one whenever they're ready.

    // Whoever creates a brand-new team is auto-approved and becomes its
    // Squad Leader (nobody else exists yet who could approve them). Joining
    // an existing team needs a Squad Leader or admin to approve the
    // request — unless this is the very first account on the whole app,
    // which is also auto-approved for the same reason. Skipping team
    // selection entirely is also just "approved" — team_approved has no
    // real meaning without a team_id, since requireApprovedTeam blocks on
    // the missing team first either way.
    const teamApproved = isFirstUser || createdNewTeam || !teamIdToUse;
    const isSquadLeader = createdNewTeam;

    const passwordHash = await hashPassword(String(password));
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, name, is_admin, is_squad_leader, team_approved, team_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, name, phone, address, is_admin, is_squad_leader, team_approved, team_id`,
      [cleanEmail, passwordHash, cleanName, isFirstUser, isSquadLeader, teamApproved, teamIdToUse]
    );

    await client.query("COMMIT");

    const user = userResult.rows[0];
    const teamName = await lookupTeamName(user.team_id);
    req.session.user = buildSessionUser(user, teamName);
    res.status(201).json(req.session.user);

    if (teamIdToUse && !createdNewTeam && !teamApproved) {
      notifyTeamOfPendingRequest(teamIdToUse, cleanEmail, cleanName);
    }
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Rollback also failed:", rollbackErr);
      }
    }
    console.error(err);
    res.status(500).json({ error: "Could not register." });
  } finally {
    if (client) client.release();
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await pool.query(
      "SELECT id, email, password_hash, name, phone, address, is_admin, is_squad_leader, team_approved, team_id FROM users WHERE email = $1",
      [cleanEmail]
    );
    const row = result.rows[0];
    if (!row || !row.password_hash) {
      // No password on file (e.g. a Google-only account) — same generic
      // error as a wrong password, so we don't leak which accounts exist
      // or how they authenticate.
      return res.status(401).json({ error: "Invalid email or password." });
    }
    const ok = await verifyPassword(String(password), row.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const teamName = await lookupTeamName(row.team_id);
    req.session.user = buildSessionUser(row, teamName);
    res.json(req.session.user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not sign in." });
  }
});

// POST /api/auth/google - sign in or register with a Google Identity
// Services ID token (the "credential" a rendered Google button hands back
// to its callback). Three outcomes for the verified Google account:
//   1. google_id already on file -> sign that account in.
//   2. No google_id match, but the verified email matches an existing
//      password account -> link this Google identity to it (auto-link),
//      then sign in. From then on that account can sign in either way.
//   3. No match at all -> create a brand-new, teamless account. The
//      frontend sees teamId: null in the response and shows the "pick your
//      team" step, same as the tail end of registration.
router.post("/google", async (req: Request, res: Response) => {
  const { credential } = req.body || {};
  if (!credential || typeof credential !== "string") {
    return res.status(400).json({ error: "Missing Google credential." });
  }

  const clientId = await getSetting("google_client_id", process.env.GOOGLE_CLIENT_ID);
  if (!clientId) {
    return res.status(500).json({ error: "Google sign-in isn't configured yet. An admin needs to set a Google Client ID in the Admin panel." });
  }

  let payload;
  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch (err) {
    console.error("Google token verification failed:", err);
    return res.status(401).json({ error: "Could not verify that Google account." });
  }

  if (!payload || !payload.email || !payload.email_verified) {
    return res.status(401).json({ error: "That Google account doesn't have a verified email." });
  }

  const googleId = payload.sub;
  const cleanEmail = payload.email.trim().toLowerCase();
  const googleName = payload.name ? String(payload.name).trim() : null;

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const byGoogleId = await client.query(
      "SELECT id, email, name, phone, address, is_admin, is_squad_leader, team_approved, team_id FROM users WHERE google_id = $1",
      [googleId]
    );
    if (byGoogleId.rows.length > 0) {
      await client.query("COMMIT");
      const user = byGoogleId.rows[0];
      const teamName = await lookupTeamName(user.team_id);
      req.session.user = buildSessionUser(user, teamName);
      return res.json(req.session.user);
    }

    const byEmail = await client.query(
      "SELECT id, email, name, phone, address, is_admin, is_squad_leader, team_approved, team_id FROM users WHERE email = $1",
      [cleanEmail]
    );
    if (byEmail.rows.length > 0) {
      // Auto-link: this email already has an account (password-based, most
      // likely). Google has verified they own this email address, so we
      // attach this Google identity to the existing account rather than
      // creating a duplicate.
      const linked = await client.query(
        "UPDATE users SET google_id = $1 WHERE id = $2 RETURNING id, email, name, phone, address, is_admin, is_squad_leader, team_approved, team_id",
        [googleId, byEmail.rows[0].id]
      );
      await client.query("COMMIT");
      const user = linked.rows[0];
      const teamName = await lookupTeamName(user.team_id);
      req.session.user = buildSessionUser(user, teamName);
      return res.json(req.session.user);
    }

    const countResult = await client.query("SELECT COUNT(*)::int AS c FROM users");
    const isFirstUser = countResult.rows[0].c === 0;
    if (!isFirstUser) {
      const allowRegistration = await getSetting("allow_registration", "true");
      if (allowRegistration === "false") {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Registration is currently closed. Ask an admin to add you." });
      }
    }

    const created = await client.query(
      `INSERT INTO users (email, google_id, name, is_admin, team_id, team_approved)
       VALUES ($1, $2, $3, $4, NULL, true)
       RETURNING id, email, name, phone, address, is_admin, is_squad_leader, team_approved, team_id`,
      [cleanEmail, googleId, googleName, isFirstUser]
    );
    await client.query("COMMIT");
    const user = created.rows[0];
    req.session.user = buildSessionUser(user, undefined);
    res.status(201).json(req.session.user);
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Rollback also failed:", rollbackErr);
      }
    }
    console.error(err);
    res.status(500).json({ error: "Could not sign in with Google." });
  } finally {
    if (client) client.release();
  }
});

// POST /api/auth/team - the "pick your team" step for an account that
// doesn't have one yet (currently only reachable via a brand-new Google
// sign-in). Same approval rules as registration: creating a new team
// auto-approves you and makes you its Squad Leader; joining an existing
// team needs a Squad Leader or admin to approve you, unless you're already
// an admin (the very first account on the app, most likely).
router.post("/team", requireAuth, async (req: Request, res: Response) => {
  if (req.session.user!.teamId) {
    return res.status(400).json({ error: "You already have a team. Ask an admin if you need to switch teams." });
  }

  const { teamId, newTeamName } = req.body || {};
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    let teamIdToUse: number | null = null;
    const trimmedNewTeamName = String(newTeamName || "").trim();
    const createdNewTeam = Boolean(trimmedNewTeamName);
    if (createdNewTeam) {
      const teamResult = await client.query(
        `INSERT INTO teams (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [trimmedNewTeamName]
      );
      teamIdToUse = teamResult.rows[0].id;
    } else if (teamId) {
      teamIdToUse = Number(teamId);
    }

    if (!teamIdToUse) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Pick an existing team or create a new one." });
    }

    const teamApproved = createdNewTeam || req.session.user!.isAdmin;
    const grantSquadLeader = createdNewTeam;

    const result = await client.query(
      `UPDATE users SET team_id = $1, team_approved = $2, is_squad_leader = is_squad_leader OR $3
       WHERE id = $4
       RETURNING id, email, name, phone, address, is_admin, is_squad_leader, team_approved, team_id`,
      [teamIdToUse, teamApproved, grantSquadLeader, req.session.user!.id]
    );
    await client.query("COMMIT");

    const user = result.rows[0];
    const teamName = await lookupTeamName(user.team_id);
    req.session.user = buildSessionUser(user, teamName);
    res.json(req.session.user);

    if (!createdNewTeam && !teamApproved) {
      notifyTeamOfPendingRequest(teamIdToUse, user.email, user.name);
    }
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Rollback also failed:", rollbackErr);
      }
    }
    console.error(err);
    res.status(500).json({ error: "Could not save your team." });
  } finally {
    if (client) client.release();
  }
});

// POST /api/auth/logout
router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

// GET /api/auth/me
router.get("/me", (req: Request, res: Response) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not signed in." });
  }
  res.json(req.session.user);
});

// PUT /api/auth/me — lets a signed-in user set/change their own display
// name and basic contact info (phone, address). This is the "User Profile"
// tab in the frontend. Scoped to the current session's user only — there's
// no :id param, so there's no way to edit anyone else's profile through
// this route.
router.put("/me", requireAuth, async (req: Request, res: Response) => {
  const { name, phone, address } = req.body || {};
  const cleanName = String(name ?? "").trim();
  const cleanPhone = String(phone ?? "").trim();
  const cleanAddress = String(address ?? "").trim();

  try {
    const result = await pool.query(
      "UPDATE users SET name = $1, phone = $2, address = $3 WHERE id = $4 RETURNING id, email, name, phone, address, is_admin, is_squad_leader, team_approved, team_id",
      [cleanName || null, cleanPhone || null, cleanAddress || null, req.session.user!.id]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Account not found." });
    }

    req.session.user!.name = row.name;
    req.session.user!.phone = row.phone;
    req.session.user!.address = row.address;
    res.json(req.session.user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update your profile." });
  }
});

export default router;
