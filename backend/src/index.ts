import "dotenv/config";
import express from "express";
import cors from "cors";
import roundsRouter from "./routes/rounds";
import statsRouter from "./routes/stats";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/rounds", roundsRouter);
app.use("/api/stats", statsRouter);

app.listen(port, () => {
  console.log(`Trap scorecard API listening on port ${port}`);
});
