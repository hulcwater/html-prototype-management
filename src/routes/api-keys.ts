import { Hono } from "hono";
import { apiKeyPrefix, generateApiKey, sha256 } from "../auth";
import * as db from "../db";
import type { Bindings } from "../types";

const apiKeys = new Hono<{ Bindings: Bindings }>();

function validId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

apiKeys.get("/", async (c) => {
  return c.json({ ok: true, data: await db.listApiKeys(c.env.DB) });
});

apiKeys.post("/", async (c) => {
  let body: { name?: unknown };
  try {
    body = await c.req.json<{ name?: unknown }>();
  } catch {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "请求体必须是 JSON" } }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) {
    return c.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "Key 名称不能为空且不能超过 100 个字符" } },
      400
    );
  }

  const apiKey = generateApiKey();
  const key = await db.createApiKey(c.env.DB, name, apiKeyPrefix(apiKey), await sha256(apiKey));
  return c.json(
    {
      ok: true,
      data: {
        id: key.id,
        name: key.name,
        key_prefix: key.key_prefix,
        created_at: key.created_at,
        api_key: apiKey,
      },
    },
    201
  );
});

apiKeys.delete("/:id", async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "无效的 API Key ID" } }, 400);
  }

  if (!(await db.revokeApiKey(c.env.DB, id))) {
    return c.json({ ok: false, error: { code: "NOT_FOUND", message: "API Key 不存在或已撤销" } }, 404);
  }

  return c.json({ ok: true, data: { id, revoked: true } });
});

export default apiKeys;
