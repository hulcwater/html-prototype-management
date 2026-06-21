import { Hono } from "hono";
import type { Bindings } from "../types";
import { getPrototypeByPreviewId } from "../db";

const preview = new Hono<{ Bindings: Bindings }>();

// /preview/:previewId  →  serve index.html (or first .html found)
preview.get("/:previewId", async (c) => {
  const previewId = c.req.param("previewId");
  const proto = await getPrototypeByPreviewId(c.env.DB, previewId);
  if (!proto) return c.json({ error: "Not Found" }, 404);

  return servePreviewFile(c.env.R2, previewId, "index.html");
});

// /preview/:previewId/*  →  serve any asset inside the preview folder
preview.get("/:previewId/*", async (c) => {
  const previewId = c.req.param("previewId");
  const proto = await getPrototypeByPreviewId(c.env.DB, previewId);
  if (!proto) return c.json({ error: "Not Found" }, 404);

  // Extract the path after /preview/:previewId/
  const url = new URL(c.req.url);
  const prefix = `/preview/${previewId}/`;
  const filePath = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : "";

  return servePreviewFile(c.env.R2, previewId, decodeURIComponent(filePath));
});

async function servePreviewFile(r2: R2Bucket, previewId: string, filePath: string) {
  const key = `previews/${previewId}/${filePath}`;
  let obj = await r2.get(key);

  // Fallback: if exact path not found and no extension, try index.html
  if (!obj && !filePath.includes(".")) {
    obj = await r2.get(`previews/${previewId}/index.html`);
  }

  if (!obj) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  if (obj.httpMetadata?.contentType) {
    headers.set("Content-Type", obj.httpMetadata.contentType);
  } else {
    headers.set("Content-Type", guessMime(filePath));
  }
  // Allow preview iframes from same origin
  headers.set("X-Frame-Options", "SAMEORIGIN");

  return new Response(obj.body, { headers });
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
  };
  return map[ext] ?? "application/octet-stream";
}

export default preview;
