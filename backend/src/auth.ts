import bcrypt from "bcryptjs";
import { Request, Response, NextFunction } from "express";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not signed in." });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not signed in." });
  }
  if (!req.session.user.isAdmin) {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

// Blocks access to team data (rounds, stats, the AI extractor) for accounts
// that haven't picked a team yet, or whose join request for an existing
// team hasn't been approved by a Squad Leader or admin yet. Sits after
// requireAuth in the routes that need it.
export function requireApprovedTeam(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not signed in." });
  }
  if (!req.session.user.teamId) {
    return res.status(403).json({ error: "Pick a team before continuing." });
  }
  if (!req.session.user.teamApproved) {
    return res.status(403).json({ error: "Your team membership is still awaiting approval from a Squad Leader or admin." });
  }
  next();
}
