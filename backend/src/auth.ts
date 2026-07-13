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
