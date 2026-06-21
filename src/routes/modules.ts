import { Hono } from "hono";
import type { Bindings } from "../types";
import * as db from "../db";

const modules = new Hono<{ Bindings: Bindings }>();

modules.get("/", async (c) => {
  const data = await db.listModules(c.env.DB);
  return c.json(data);
});

modules.post("/", async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = (body.name ?? "").trim();
  if (!name) return c.json({ error: "模块名称不能为空" }, 400);

  const existing = await db.getModuleByName(c.env.DB, name);
  if (existing) return c.json({ error: "模块名称已存在" }, 400);

  const module = await db.createModule(c.env.DB, name);
  return c.json({ ...module, prototype_count: 0 }, 201);
});

modules.put("/reorder", async (c) => {
  const body = await c.req.json<{ ids?: number[] }>();
  const ids = body.ids ?? [];
  await db.reorderModules(c.env.DB, ids);
  return c.json({ ok: true });
});

modules.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ name?: string }>();
  const name = (body.name ?? "").trim();
  if (!name) return c.json({ error: "模块名称不能为空" }, 400);

  const m = await db.getModule(c.env.DB, id);
  if (!m) return c.json({ error: "模块不存在" }, 404);

  const existing = await db.getModuleByName(c.env.DB, name);
  if (existing && existing.id !== id) return c.json({ error: "模块名称已存在" }, 400);

  const updated = await db.updateModule(c.env.DB, id, name);
  return c.json(updated);
});

modules.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const m = await db.getModule(c.env.DB, id);
  if (!m) return c.json({ error: "模块不存在" }, 404);

  // Cascade delete handles prototypes and records via FK; clean up R2 files
  const protos = await db.listPrototypes(c.env.DB, id);
  for (const proto of protos) {
    await cleanupPrototypeR2(c.env.R2, proto.preview_id);
  }

  await db.deleteModule(c.env.DB, id);
  return c.json({ ok: true });
});

async function cleanupPrototypeR2(r2: R2Bucket, previewId: string) {
  const list = await r2.list({ prefix: `previews/${previewId}/` });
  const keys = list.objects.map((o) => o.key);
  if (keys.length > 0) {
    await r2.delete(keys);
  }
}

export default modules;
