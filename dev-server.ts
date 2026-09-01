// Standalone Node.js dev server for HTML Prototype Management.
// Uses @hono/node-server (pure Node.js) — no workerd dependency.
// D1 → sql.js, R2 → local filesystem, ASSETS → public/ directory.
import { serve } from "@hono/node-server";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createD1Adapter } from "./d1-adapter";
import { R2BucketAdapter } from "./r2-adapter";
import { sha256, isPublicPath, parseCookie, verifySessionToken, SESSION_COOKIE } from "./src/auth";
import app from "./src/index";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = resolve(__dirname, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const DB_PATH = resolve(__dirname, "data.db");
const PUBLIC_DIR = resolve(__dirname, "public");
const UPLOADS_DIR = resolve(__dirname, "uploads");
const PORT = parseInt(process.env.PORT || "8787", 10);

// MIME types for static files
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
};

function getMime(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

// ── Static file server ────────────────────────────────────────────────────────

function serveStatic(reqPath: string): Response {
  // Normalize path and prevent directory traversal
  const safePath = reqPath.replace(/\.\./g, "").replace(/\/$/, "") || "/";
  let filePath = join(PUBLIC_DIR, safePath === "/" ? "index.html" : safePath);

  // If the resolved path doesn't start with PUBLIC_DIR, it's a traversal attempt
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (existsSync(filePath)) {
    return new Response(readFileSync(filePath), {
      headers: { "Content-Type": getMime(filePath) },
    });
  }

  // SPA fallback: serve index.html for HTML requests
  const indexPath = join(PUBLIC_DIR, "index.html");
  if (existsSync(indexPath)) {
    return new Response(readFileSync(indexPath), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response("Not Found", { status: 404 });
}

// ── Fake ASSETS fetcher (never matches — static files handled above) ──────────

const fakeAssets: Fetcher = {
  fetch: () => Promise.resolve(new Response("x", { status: 404 })),
};

// ── Access password ───────────────────────────────────────────────────────────

const AUTH_FILE = resolve(__dirname, ".env.auth");

function randomPassword(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

// 密码哈希加载顺序：AUTH_PASSWORD_HASH 环境变量 > AUTH_PASSWORD 明文 > .env.auth > 自动生成并保存
async function resolveAuthHash(): Promise<string> {
  if (process.env.AUTH_PASSWORD_HASH) return process.env.AUTH_PASSWORD_HASH.trim();
  if (process.env.AUTH_PASSWORD) return sha256(process.env.AUTH_PASSWORD.trim());

  if (existsSync(AUTH_FILE)) {
    const content = readFileSync(AUTH_FILE, "utf-8");
    const mHash = content.match(/^AUTH_PASSWORD_HASH=(.+)$/m);
    if (mHash && mHash[1].trim()) return mHash[1].trim();
    const mPlain = content.match(/^AUTH_PASSWORD=(.+)$/m);
    if (mPlain && mPlain[1].trim()) return sha256(mPlain[1].trim());
  }

  // 首次运行：生成随机密码，保存哈希到 .env.auth（已 gitignore）
  const password = randomPassword();
  const hash = await sha256(password);
  writeFileSync(AUTH_FILE, `AUTH_PASSWORD_HASH=${hash}\n`, "utf-8");
  console.log("");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  🔑 首次启动已生成访问密码：${password}`);
  console.log(`     （已保存至 .env.auth，可用环境变量 AUTH_PASSWORD_HASH / AUTH_PASSWORD 覆盖）`);
  console.log("════════════════════════════════════════════════════════════");
  console.log("");
  return hash;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  console.log("[dev-server] Opening database:", DB_PATH);
  const d1 = await createD1Adapter(DB_PATH);

  // Run schema migration
  const schemaPath = resolve(__dirname, "schema.sql");
  if (existsSync(schemaPath)) {
    const sql = readFileSync(schemaPath, "utf-8");
    for (const stmt of sql.split(";").map(s => s.trim()).filter(s => s.length > 0)) {
      await d1.exec(stmt + ";");
    }
    console.log("[dev-server] Schema applied");
  }

  // Data migration: add r2_key column if missing (for Flask data.db compatibility)
  const cols = (await d1.prepare("PRAGMA table_info(upload_records)").all<{ name: string }>()).results;
  if (!cols.some((c: { name: string }) => c.name === "r2_key")) {
    await d1.exec("ALTER TABLE upload_records ADD COLUMN r2_key TEXT NOT NULL DEFAULT ''");
    // Populate r2_key from file_path (strip absolute prefix, keep relative path from uploads/)
    const records = (await d1.prepare("SELECT id, file_path FROM upload_records WHERE file_path != ''").all<{ id: number; file_path: string }>()).results;
    for (const r of records) {
      const relPath = r.file_path.replace(/.*[\\\/]uploads[\\\/]/, "");
      if (relPath && relPath !== r.file_path) {
        await d1.prepare("UPDATE upload_records SET r2_key = ? WHERE id = ?").bind(relPath, r.id).run();
      }
    }
    console.log(`[dev-server] Migrated upload_records: added r2_key column (${records.length} records)`);
  }

  // Data migration: fix NULL timestamps left by older Flask schema (no DEFAULT on datetime columns)
  await d1.exec("UPDATE prototypes SET created_at = datetime('now') WHERE created_at IS NULL");
  await d1.exec("UPDATE prototypes SET updated_at = datetime('now') WHERE updated_at IS NULL");
  await d1.exec("UPDATE upload_records SET upload_time = datetime('now') WHERE upload_time IS NULL");
  console.log("[dev-server] NULL timestamp migration complete");

  const r2 = new R2BucketAdapter(UPLOADS_DIR);

  // 管理后台访问密码哈希（未配置环境变量时自动生成）
  const authHash = await resolveAuthHash();

  const bindings = {
    DB: d1,
    R2: r2,
    ASSETS: fakeAssets,
    AUTH_PASSWORD_HASH: authHash,
  };

  // Periodic DB persistence
  const saveTimer = setInterval(() => {
    try {
      d1.saveToFile(DB_PATH);
    } catch (err) {
      console.error("[dev-server] DB save error:", err);
    }
  }, 10_000);

  // Graceful shutdown
  const shutdown = () => {
    clearInterval(saveTimer);
    try {
      d1.saveToFile(DB_PATH);
      console.log("\n[dev-server] Database saved. Goodbye!");
    } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  serve(
    {
      fetch: async (request: Request) => {
        const url = new URL(request.url);

        // API and preview routes → Hono
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/preview/") || url.pathname === "/health") {
          return app.fetch(request, bindings as any);
        }

        // Static files → serve from public/, 但管理后台页面需登录（公开路径除外）
        const cookie = request.headers.get("cookie") ?? "";
        const token = parseCookie(cookie)[SESSION_COOKIE];
        const authed = token ? await verifySessionToken(token, authHash) : false;
        if (!authed && !isPublicPath(url.pathname)) {
          return Response.redirect(new URL("/login.html", url.origin), 302);
        }

        return serveStatic(url.pathname);
      },
      port: PORT,
    },
    () => {
      console.log(`\n🚀  HTML 原型管理 running at http://localhost:${PORT}`);
      console.log(`   管理后台已启用密码保护，登录地址：http://localhost:${PORT}/login.html`);
      console.log(`   预览链接（免登录）：http://localhost:${PORT}/preview/<previewId>/`);
      console.log(`   按 Ctrl+C 停止\n`);
    },
  );
}

main().catch((err) => {
  console.error("[dev-server] Fatal error:", err);
  process.exit(1);
});
