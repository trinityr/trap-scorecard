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

// Without these, an unhandled promise rejection or an EventEmitter
// 'error' with no listener (which connect-pg-simple can emit on a DB
// hiccup) crashes the entire Node process by default — which looks like
// a 502 to anything proxying this app. Log instead of dying.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

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
const sessionStore = new PgSession({ pool, createTableIfMissing: true });
// connect-pg-simple's store is an EventEmitter — emitting 'error' with no
// listener attached crashes the whole process. This was the actual bug:
// a DB hiccup on the session store (most likely the createTableIfMissing
// race on a brand-new database) took down the entire server instead of
// just failing one request.
sessionStore.on("error", (err) => {
  console.error("Session store error:", err);
});

app.use(
  session({
    store: sessionStore,
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
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    console.error("Malformed request body (invalid JSON):", err.message);
    return res.status(400).json({ error: "Request body isn't valid JSON. If you're testing with curl on Windows cmd.exe, single quotes aren't stripped the way they are in bash — use double quotes and escape the inner ones instead." });
  }
  console.error("Unhandled error:", err);
  if (res.headersSent) return;
  res.status(err?.status || 500).json({ error: "Something went wrong on the server. Check the api container logs for details." });
});

app.listen(port, () => {
  console.log(`Trap scorecard API + frontend listening on port ${port}`);
});
