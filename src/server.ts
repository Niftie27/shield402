import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./app";
import { loadX402Config } from "./config/x402Config";

const PORT = process.env.PORT || 3402;
const x402 = loadX402Config();
const app = createApp({ x402 });

app.listen(PORT, () => {
  console.log(`Shield402 Lite running on port ${PORT}`);
  if (!x402) {
    console.log("x402 payment is disabled. Set X402_ENABLED=true in .env to enable.");
  }
});
