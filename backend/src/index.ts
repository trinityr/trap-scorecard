import "dotenv/config";
import path from "path";
import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { getSetting } from "./settings";
import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";
import teamsRouter from "./routes/teams";
import roundsRouter from "./routes/rounds";
import statsRouter from "./routes/stats";
import extractRouter from "./routes/extract";
import siteRouter from "./routes/site";

const app = express();
const port = process.env.PORT || 3000;

// Needed so express-session's "secure" cookie flag correctly trusts
// X-Forwarded-Proto from Nginx Proxy Manager (or any reverse proxy) in
// front of this container.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: (origin, callback) => {
      getSetting("cors_origin", process.env.CORS_ORIGIN || "*")
        .then((configured) => {
          if (!configured || configured === "*" || !origin) return callback(null, true);
          const allowed = configured.split(",").map((s) => s.trim());
          callback(null, allowed.includes(origin));
        })
        .catch((err) => {
          console.error("CORS setting lookup failed, falling back to env default:", err);
          const fallback = process.env.CORS_ORIGIN || "*";
          callback(null, fallback === "*" || !origin);
        });
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" })); // scoresheet photos are base64-encoded in the request body

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "change-me-set-SESSION_SECRET-in-env",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE !== "false",
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/rounds", roundsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/extract", extractRouter);
app.use("/api/site", siteRouter);

// Serve the frontend — must come after the /api routes above so those
// take priority.
app.use(express.static(path.join(__dirname, "..", "public")));

// Catch-all error handler. Without this, an unhandled error anywhere
// (a malformed JSON body, an unexpected exception, etc.) falls through to
// Express's default HTML error page — which breaks every API client that
// expects JSON back, including the frontend's own fetch wrapper. This
// guarantees every response is JSON, and logs the real error server-side
// for debugging (check `docker compose logs api`).
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return;
  res.status(err?.status || 500).json({ error: "Something went wrong on the server. Check the api container logs for details." });
});

app.listen(port, () => {
  console.log(`Trap scorecard API + frontend listening on port ${port}`);
});
