/**
 * @fileoverview BetaGo HTTP server entry point.
 *
 * This file creates the Express app via the `createApp` factory (which
 * supports dependency injection for testing) and starts the HTTP server.
 *
 * All route and middleware logic lives in `./app.js`.
 */
import { createApp } from "./app.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`betago server listening on http://${HOST}:${PORT}`);
});

export default app;
