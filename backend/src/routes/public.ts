import { Router, Request, Response } from "express";
import { getSetting } from "../settings";

const router = Router();

// GET /api/public-settings - the small subset of admin settings the
// sign-in/register screen needs before anyone is authenticated. Currently
// just whether Google sign-in is configured (and with which Client ID —
// not secret, it's meant to be embedded in the page).
router.get("/", async (_req: Request, res: Response) => {
  try {
    const googleClientId = await getSetting("google_client_id", process.env.GOOGLE_CLIENT_ID);
    res.json({ googleClientId: googleClientId || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load settings." });
  }
});

export default router;
