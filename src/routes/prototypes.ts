import { Hono } from "hono";
import { unzipSync } from "fflate";
import type { Bindings } from "../types";
import * as db from "../db";

const prototypes = new Hono<{ Bindings: Bindings }>();

function tokenUrlsafe(bytes = 8) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function formatRow(p: Record<string, unknown>, hasFile: boolean) {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    module_id: p.module_id,
    module_name: p.module_name ?? "",
    preview_id: p.preview_id,
    created_at: p.created_at,
    updated_at: p.updated_at,
    has_file: hasFile,
  };
}

// ── List ──────────────────────────────────────────────────────────────────────

prototypes.get("/", async (c) => {
  const moduleId = c.req.query("module_id") ? Number(c.req.query("module_id")) : undefined;
  const rows = await db.listPrototypes(c.env.DB, moduleId);
  return c.json(
    rows.map((p) => formatRow(p as Record<string, unknown>, (p.record_count ?? 0) > 0))
  );
});

// ── Get one ───────────────────────────────────────────────────────────────────

prototypes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const p = await db.getPrototype(c.env.DB, id);
  if (!p) return c.json({ error: "原型不存在" }, 404);
  const records = await db.listRecords(c.env.DB, id);
  const latest = records[0];
  return c.json({
    ...formatRow(p as unknown as Record<string, unknown>, !!latest),
    records,
    ...(latest ? { file_type: latest.file_type, file_name: latest.file_name } : {}),
  });
});

// ── Create ────────────────────────────────────────────────────────────────────

prototypes.post("/", async (c) => {
  const form = await c.req.formData();
  const name = (form.get("name") as string | null ?? "").trim();
  const moduleId = Number(form.get("module_id"));
  const description = (form.get("description") as string | null ?? "").trim();
  const file = form.get("file") as File | null;

  if (!name) return c.json({ error: "原型名称不能为空" }, 400);
  const mod = await db.getModule(c.env.DB, moduleId);
  if (!mod) return c.json({ error: "请选择有效的模块" }, 400);
  if (!file) return c.json({ error: "请上传原型文件" }, 400);
  if (!isAllowed(file.name)) return c.json({ error: "仅支持 .html 文件或 .zip 压缩包" }, 400);

  const previewId = tokenUrlsafe(8);
  const p = await db.createPrototype(c.env.DB, name, moduleId, description, previewId);

  const record = await handleUpload(c.env.R2, c.env.DB, file, p.id, previewId, "", "");
  if ("error" in record) {
    await db.deletePrototype(c.env.DB, p.id);
    return c.json(record, 400);
  }

  const proto = await db.getPrototype(c.env.DB, p.id);
  const records = await db.listRecords(c.env.DB, p.id);
  return c.json(
    {
      ...formatRow(proto as unknown as Record<string, unknown>, true),
      records,
      file_type: record.file_type,
      file_name: record.file_name,
    },
    201
  );
});

// ── Update metadata ───────────────────────────────────────────────────────────

prototypes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const p = await db.getPrototype(c.env.DB, id);
  if (!p) return c.json({ error: "原型不存在" }, 404);

  const body = await c.req.json<{ name?: string; description?: string; module_id?: number }>();
  const name = (body.name ?? "").trim();
  if (!name) return c.json({ error: "原型名称不能为空" }, 400);

  const moduleId = body.module_id ? Number(body.module_id) : p.module_id;
  if (body.module_id) {
    const mod = await db.getModule(c.env.DB, moduleId);
    if (!mod) return c.json({ error: "模块不存在" }, 400);
  }

  const updated = await db.updatePrototype(c.env.DB, id, name, (body.description ?? "").trim(), moduleId);
  const records = await db.listRecords(c.env.DB, id);
  const latest = records[0];
  return c.json({
    ...formatRow(updated as unknown as Record<string, unknown>, !!latest),
    records,
    ...(latest ? { file_type: latest.file_type, file_name: latest.file_name } : {}),
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

prototypes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const p = await db.getPrototype(c.env.DB, id);
  if (!p) return c.json({ error: "原型不存在" }, 404);

  // Delete all R2 objects for this prototype
  const list = await c.env.R2.list({ prefix: `previews/${p.preview_id}/` });
  if (list.objects.length > 0) await c.env.R2.delete(list.objects.map((o) => o.key));

  const records = await db.listRecords(c.env.DB, id);
  for (const r of records) {
    if (r.r2_key) await c.env.R2.delete(r.r2_key);
  }

  await db.deletePrototype(c.env.DB, id);
  return c.json({ ok: true });
});

// ── Upload new version ────────────────────────────────────────────────────────

prototypes.post("/:id/upload", async (c) => {
  const id = Number(c.req.param("id"));
  const p = await db.getPrototype(c.env.DB, id);
  if (!p) return c.json({ error: "原型不存在" }, 404);

  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  if (!file) return c.json({ error: "请上传文件" }, 400);
  if (!isAllowed(file.name)) return c.json({ error: "仅支持 .html 文件或 .zip 压缩包" }, 400);

  const uploader = (form.get("uploader") as string | null ?? "").trim();
  const updateNotes = (form.get("update_notes") as string | null ?? "").trim();

  const record = await handleUpload(c.env.R2, c.env.DB, file, p.id, p.preview_id, uploader, updateNotes);
  if ("error" in record) return c.json(record, 400);

  await db.touchPrototype(c.env.DB, id);

  // Trim old records and their R2 source files
  const toDelete = await db.trimRecords(c.env.DB, id, 10);
  for (const old of toDelete) {
    if (old.r2_key) await c.env.R2.delete(old.r2_key);
    await db.deleteRecord(c.env.DB, old.id);
  }

  const proto = await db.getPrototype(c.env.DB, id);
  const records = await db.listRecords(c.env.DB, id);
  return c.json({
    ...formatRow(proto as unknown as Record<string, unknown>, true),
    records,
    file_type: record.file_type,
    file_name: record.file_name,
  });
});

// ── Download ──────────────────────────────────────────────────────────────────

prototypes.get("/:id/download", async (c) => {
  const id = Number(c.req.param("id"));
  const p = await db.getPrototype(c.env.DB, id);
  if (!p) return c.json({ error: "原型不存在" }, 404);

  const latest = await db.getLatestRecord(c.env.DB, id);
  if (!latest) return c.json({ error: "暂无文件" }, 404);

  const obj = await c.env.R2.get(latest.r2_key);
  if (!obj) return c.json({ error: "文件不存在" }, 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(latest.file_name)}`,
    },
  });
});

// ── Download by record id ─────────────────────────────────────────────────────

export const recordDownload = new Hono<{ Bindings: Bindings }>();

recordDownload.get("/:rid/download", async (c) => {
  const rid = Number(c.req.param("rid"));
  const record = await db.getRecord(c.env.DB, rid);
  if (!record || !record.r2_key) return c.json({ error: "记录不存在" }, 404);

  const obj = await c.env.R2.get(record.r2_key);
  if (!obj) return c.json({ error: "文件不存在" }, 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(record.file_name)}`,
    },
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAllowed(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext === "html" || ext === "zip";
}

async function handleUpload(
  r2: R2Bucket,
  dbInst: D1Database,
  file: File,
  prototypeId: number,
  previewId: string,
  uploader: string,
  updateNotes: string
) {
  const originalName = file.name;
  const ext = originalName.split(".").pop()?.toLowerCase() ?? "";
  const versionId = tokenUrlsafe(8);
  const r2SourceKey = `sources/${prototypeId}/${versionId}/${originalName}`;

  const buffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(buffer);

  // Store original file in R2
  await r2.put(r2SourceKey, buffer, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  if (ext === "zip") {
    // Decompress and store each entry under previews/<previewId>/
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(uint8);
    } catch {
      await r2.delete(r2SourceKey);
      return { error: "ZIP 文件损坏或格式不正确" };
    }

    // Detect and strip single top-level folder
    const keys = Object.keys(files);
    const topDirs = new Set(keys.map((k) => k.split("/")[0]));
    const stripPrefix =
      topDirs.size === 1 && keys.every((k) => k.startsWith([...topDirs][0] + "/"))
        ? [...topDirs][0] + "/"
        : "";

    // Delete previous preview files
    const existing = await r2.list({ prefix: `previews/${previewId}/` });
    if (existing.objects.length > 0) await r2.delete(existing.objects.map((o) => o.key));

    // Upload each file
    const uploads = Object.entries(files).map(async ([path, data]) => {
      if (data.length === 0) return; // skip directories
      const relative = path.startsWith(stripPrefix) ? path.slice(stripPrefix.length) : path;
      if (!relative) return;
      const key = `previews/${previewId}/${relative}`;
      const ct = guessMime(relative);
      await r2.put(key, data, { httpMetadata: { contentType: ct } });
    });
    await Promise.all(uploads);
  } else {
    // Single HTML file → previews/<previewId>/index.html
    const existing = await r2.list({ prefix: `previews/${previewId}/` });
    if (existing.objects.length > 0) await r2.delete(existing.objects.map((o) => o.key));
    await r2.put(`previews/${previewId}/index.html`, buffer, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
    });
  }

  const record = await db.createRecord(
    dbInst,
    prototypeId,
    originalName,
    r2SourceKey,
    file.size,
    ext,
    uploader,
    updateNotes
  );
  return record;
}

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    webp: "image/webp",
    mp4: "video/mp4",
    pdf: "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

export default prototypes;
