import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import modulesRoute from "./routes/modules";
import prototypesRoute, { recordDownload } from "./routes/prototypes";
import previewRoute from "./routes/preview";

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

// API routes — these take priority over static assets
app.route("/api/modules", modulesRoute);
app.route("/api/prototypes", prototypesRoute);
app.route("/api/records", recordDownload);

// Preview routes
app.route("/preview", previewRoute);

// Static files from Pages project's assets directory
app.use("*", async (c, next) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.ok) return res;
  await next();
});

// SPA fallback: serve index.html for unmatched client-side routes
app.get("*", async (c) => {
  const res = await c.env.ASSETS.fetch(new URL("/index.html", c.req.url));
  if (res.ok) return res;
  return c.json({ error: "Not Found" }, 404);
});

export default app;
