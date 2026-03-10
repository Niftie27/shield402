import express from "express";
import { handleCheckTrade } from "./routes/checkTrade";

const app = express();
const PORT = process.env.PORT || 3402;

app.use(express.json());

// --- Routes ---

app.post("/check-trade", handleCheckTrade);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "0.1.0" });
});

// --- Start ---

app.listen(PORT, () => {
  console.log(`Shield402 Lite running on port ${PORT}`);
});

export default app;
