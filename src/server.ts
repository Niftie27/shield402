import { createApp } from "./app";

const PORT = process.env.PORT || 3402;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Shield402 Lite running on port ${PORT}`);
});
