import "dotenv/config";
import express from "express";
import cors from "cors";
import uploadRoutes from "./routes/upload";
import quizRoutes from "./routes/quiz";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "mcq-engine-api" });
});

app.use("/api/upload", uploadRoutes);
app.use("/api/quiz", quizRoutes);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MCQ Engine API running on http://127.0.0.1:${PORT}`);
});
