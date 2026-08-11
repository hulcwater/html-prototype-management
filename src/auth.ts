// 访问鉴权：管理后台需密码登录，/preview/ 等公开路径免登录。
// 纯 Web Crypto 实现，无 Node 特有 I/O，可同时运行于 Node（本地）与 Cloudflare Workers。
import type { Context, Next } from "hono";
import type { Bindings } from "./types";

export const SESSION_COOKIE = "proto_session";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 记住我：30 天

// ── 基础工具 ─────────────────────────────────────────────────────────────────

export async function sha256(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  // 复制到独立 buffer，兼容严格的 BufferSource 类型
  const buf = new Uint8Array(data.byteLength);
  buf.set(data);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 常量时间比较，避免时序侧信道
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// ── 密码校验 ──────────────────────────────────────────────────────────────────

// 校验明文密码是否匹配存储的 SHA-256 十六进制哈希
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  const digest = await sha256(password);
  return timingSafeEqual(digest, hash.toLowerCase());
}

// ── 会话令牌（HMAC 签名，无状态） ─────────────────────────────────────────────

// 由密码哈希派生会话签名密钥（不直接暴露哈希本身）
async function deriveSecret(hash: string): Promise<Uint8Array> {
  const seed = new TextEncoder().encode("proto-session-v1:" + hash);
  const digest = await crypto.subtle.digest("SHA-256", seed);
  return new Uint8Array(digest);
}

async function hmac(secret: Uint8Array, data: string): Promise<Uint8Array> {
  const keyBytes = new Uint8Array(secret.byteLength);
  keyBytes.set(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

function randomTokenBytes(n = 32): Uint8Array {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}

// remember=true → 30 天有效；false → 仅浏览器会话内有效（关闭浏览器即失效）
export async function createSessionToken(hash: string, remember: boolean): Promise<string> {
  const secret = await deriveSecret(hash);
  const payload = JSON.stringify({
    r: remember ? 1 : 0,
    exp: remember ? Date.now() + SESSION_MAX_AGE_MS : null,
  });
  const payloadB64 = b64urlEncode(new TextEncoder().encode(payload));
  const nonce = b64urlEncode(randomTokenBytes());
  const signed = nonce + "." + payloadB64;
  const sig = b64urlEncode(await hmac(secret, signed));
  return signed + "." + sig;
}

export async function verifySessionToken(token: string | undefined, hash: string): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [nonce, payloadB64, sigB64] = parts;

  const secret = await deriveSecret(hash);
  const expectedSig = b64urlEncode(await hmac(secret, nonce + "." + payloadB64));
  if (!timingSafeEqual(sigB64, expectedSig)) return false;

  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
    if (data && typeof data.exp === "number" && data.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

// ── Cookie 构建 ───────────────────────────────────────────────────────────────

export function sessionCookieHeader(token: string, remember: boolean, secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (remember) parts.push(`Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

// ── 路径白名单 ────────────────────────────────────────────────────────────────

// 免登录路径：预览、登录页及其静态资源、登录/登出接口本身
export function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith("/preview/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/static/") ||
    pathname === "/login.html" ||
    pathname === "/health" ||
    pathname === "/favicon.ico"
  );
}

// ── 鉴权中间件 ────────────────────────────────────────────────────────────────

// 未配置 AUTH_PASSWORD_HASH 时直接放行（保持原有行为）。
// 未登录：/api/ 请求返回 401 JSON，其余页面请求 302 跳转登录页。
export async function authGate(c: Context<{ Bindings: Bindings }>, next: Next) {
  const hash = c.env.AUTH_PASSWORD_HASH;
  if (!hash) return next();

  const url = new URL(c.req.url);
  if (isPublicPath(url.pathname)) return next();

  const cookie = c.req.header("cookie") ?? "";
  const token = parseCookie(cookie)[SESSION_COOKIE];
  if (token && (await verifySessionToken(token, hash))) return next();

  if (url.pathname.startsWith("/api/")) {
    return c.json({ error: "未登录或登录已过期" }, 401);
  }
  return c.redirect("/login.html", 302);
}
