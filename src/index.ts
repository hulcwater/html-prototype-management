import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import modulesRoute from "./routes/modules";
import prototypesRoute, { recordDownload } from "./routes/prototypes";
import previewRoute from "./routes/preview";

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors());

// API routes
app.route("/api/modules", modulesRoute);
app.route("/api/prototypes", prototypesRoute);
app.route("/api/records", recordDownload);

// Preview routes
app.route("/preview", previewRoute);

// Serve frontend SPA — Cloudflare Workers Assets handles static files,
// but for any unmatched route we return the index.html so client-side
// routing (if any) works correctly.
app.get("*", async (c) => {
  // When deployed with `[assets]` in wrangler.toml, Workers Assets serves
  // static files automatically before this handler runs.
  // This fallback handles direct API 404s cleanly.
  return c.json({ error: "Not Found" }, 404);
});

export default app;
