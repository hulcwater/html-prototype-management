import { Hono } from "hono";
import type { Bindings, UploadRecord } from "../types";
import { getPrototypeByPreviewId, getLatestRecord, getRecord } from "../db";
import { deployPreviewFromRecord, guessMime } from "./prototypes";

const preview = new Hono<{ Bindings: Bindings }>();

// /preview/:previewId/r/:rid/*  →  serve any asset from that record's own preview folder.
preview.get("/:previewId/r/:rid/*", async (c) => {
  const previewId = c.req.param("previewId");
  const rid = Number(c.req.param("rid"));
  const url = new URL(c.req.url);

  const proto = await getPrototypeByPreviewId(c.env.DB, previewId);
  if (!proto) return c.json({ error: "Not Found" }, 404);
  const record = await getRecord(c.env.DB, rid);
  if (!record || record.prototype_id !== proto.id) return c.json({ error: "Not Found" }, 404);

  // Extract the path after /preview/:previewId/r/:rid/
  const prefix = `/preview/${previewId}/r/${rid}/`;
  const filePath = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : "";

  // 仅当请求指向目录本身（路径为空且无尾斜杠）时补斜杠，
  // 保证 HTML 内的相对资源路径解析到本目录下；子资源文件路径不补。
  if (!filePath && !url.pathname.endsWith("/")) {
    return c.redirect(`/preview/${previewId}/r/${rid}/`, 302);
  }

  return servePreviewFile(c.env.R2, previewId, rid, record, decodeURIComponent(filePath));
});

// /preview/:previewId  →  补尾斜杠（302，不缓存），随后由 /preview/:previewId/* 内部服务。
// 不做版本重定向：URL 始终是 /preview/:previewId/，内容永远是当前最新版本，
// 这样开发复制的链接不会因后续上传而指向某个历史版本。
preview.get("/:previewId", async (c) => {
  const previewId = c.req.param("previewId");
  return c.redirect(`/preview/${previewId}/`, 302);
});

// /preview/:previewId/*  →  内部代理最新上传记录的预览目录。
// 直接返回内容，URL 保持 /preview/:previewId/... 不变。
preview.get("/:previewId/*", async (c) => {
  const previewId = c.req.param("previewId");
  const proto = await getPrototypeByPreviewId(c.env.DB, previewId);
  if (!proto) return c.json({ error: "Not Found" }, 404);

  const latest = await getLatestRecord(c.env.DB, proto.id);
  if (!latest) return c.json({ error: "Not Found" }, 404);

  // Extract the path after /preview/:previewId/
  const url = new URL(c.req.url);
  const prefix = `/preview/${previewId}/`;
  const filePath = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : "";

  return servePreviewFile(c.env.R2, previewId, latest.id, latest, decodeURIComponent(filePath));
});

async function servePreviewFile(
  r2: R2Bucket,
  previewId: string,
  rid: number,
  record: UploadRecord,
  filePath: string
) {
  // Empty path (from the trailing-slash URL) → serve index.html directly
  const resolvedPath = filePath || "index.html";
  const base = `previews/${previewId}/r/${rid}`;
  const key = `${base}/${resolvedPath}`;
  let obj = await r2.get(key);

  // Fallback: if exact path not found and no extension, try index.html
  if (!obj && !resolvedPath.includes(".")) {
    obj = await r2.get(`${base}/index.html`);
  }

  // Self-heal: records created before per-record previews have no deployed
  // folder. On first visit, deploy from the record's source file once.
  if (!obj && (resolvedPath === "index.html" || !resolvedPath.includes("."))) {
    try {
      await deployPreviewFromRecord(r2, record.r2_key, record.file_type, base);
    } catch {
      // source missing or corrupted → keep 404
    }
    obj = await r2.get(`${base}/index.html`);
  }

  if (!obj) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  if (obj.httpMetadata?.contentType) {
    headers.set("Content-Type", obj.httpMetadata.contentType);
  } else {
    headers.set("Content-Type", guessMime(resolvedPath));
  }
  // Allow preview iframes from same origin
  headers.set("X-Frame-Options", "SAMEORIGIN");

  return new Response(obj.body, { headers });
}

export default preview;
