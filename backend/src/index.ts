import "dotenv/config";
import path from "path";
import express from "express";
import cors from "cors";
import roundsRouter from "./routes/rounds";
import statsRouter from "./routes/stats";
import extractRouter from "./routes/extract";
import teamsRouter from "./routes/teams";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" })); // scoresheet photos are base64-encoded in the request body

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/teams", teamsRouter);
app.use("/api/rounds", roundsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/extract", extractRouter);

// Serve the frontend — must come after the /api routes above so those
// take priority, and after express.json() so API routes still get their
// parsed body correctly.
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(port, () => {
  console.log(`Trap scorecard API + frontend listening on port ${port}`);
});
