import { Hono } from "hono";
import type { Bindings } from "../types";
import {
  verifyPassword,
  createSessionToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
} from "../auth";

const auth = new Hono<{ Bindings: Bindings }>();

// POST /api/auth/login  →  校验密码，成功则写入会话 Cookie
auth.post("/login", async (c) => {
  const hash = c.env.AUTH_PASSWORD_HASH;
  if (!hash) return c.json({ error: "未启用密码保护" }, 400);

  const body = await c.req.json<{ password?: string; remember?: boolean }>();
  const password = (body.password ?? "").trim();
  if (!password) return c.json({ error: "请输入密码" }, 400);

  if (!(await verifyPassword(password, hash))) {
    return c.json({ error: "密码错误" }, 401);
  }

  const remember = body.remember !== false;
  const token = await createSessionToken(hash, remember);
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", sessionCookieHeader(token, remember, secure));
  return c.json({ ok: true });
});

// POST /api/auth/logout  →  清除会话 Cookie
auth.post("/logout", (c) => {
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", clearSessionCookieHeader(secure));
  return c.json({ ok: true });
});

export default auth;
