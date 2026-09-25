import { Hono } from "hono";
import * as db from "../db";
import { handleUpload, isAllowed } from "./prototypes";
import type { Bindings, Prototype, UploadRecord } from "../types";

const apiV1 = new Hono<{ Bindings: Bindings }>();
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_UPLOADER_LENGTH = 100;
const MAX_UPDATE_NOTES_LENGTH = 2_000;

type ApiErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "UPLOAD_ERROR";

function success<T>(data: T) {
  return { ok: true as const, data };
}

function failure(code: ApiErrorCode, message: string) {
  return { ok: false as const, error: { code, message } };
}

function validPositiveId(value: string | null | undefined): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function stringField(value: string | File | null, maxLength: number): string | null {
  if (value === null) return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : null;
}

function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

function recordResource(record: UploadRecord, previewId: string, origin: string, isLatest: boolean) {
  return {
    id: record.id,
    prototype_id: record.prototype_id,
    file_name: record.file_name,
    file_size: record.file_size,
    file_type: record.file_type,
    upload_time: record.upload_time,
    uploader: record.uploader,
    update_notes: record.update_notes,
    is_latest: isLatest,
    preview_url: `${origin}/preview/${previewId}/r/${record.id}/`,
    download_url: `${origin}/api/records/${record.id}/download`,
  };
}

function prototypeResource(prototype: Prototype, records: UploadRecord[], origin: string) {
  const latest = records[0] ?? null;
  return {
    id: prototype.id,
    name: prototype.name,
    description: prototype.description,
    module_id: prototype.module_id,
    module_name: prototype.module_name ?? "",
    preview_id: prototype.preview_id,
    created_at: prototype.created_at,
    updated_at: prototype.updated_at,
    has_file: Boolean(latest),
    record_count: records.length,
    preview_url: `${origin}/preview/${prototype.preview_id}/`,
    latest_record: latest ? recordResource(latest, prototype.preview_id, origin, true) : null,
  };
}

async function prototypeWithRecords(c: { env: Bindings; req: { raw: Request } }, prototypeId: number) {
  const prototype = await db.getPrototype(c.env.DB, prototypeId);
  if (!prototype) return null;
  const records = await db.listRecords(c.env.DB, prototypeId);
  return prototypeResource(prototype, records, requestOrigin(c.req.raw));
}

apiV1.get("/modules", async (c) => {
  const data = await db.listModules(c.env.DB);
  return c.json(success(data));
});

apiV1.post("/prototypes", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(failure("VALIDATION_ERROR", "请求必须使用 multipart/form-data"), 400);
  }

  const name = stringField(form.get("name"), MAX_NAME_LENGTH);
  const description = stringField(form.get("description"), MAX_DESCRIPTION_LENGTH);
  const moduleId = validPositiveId(typeof form.get("module_id") === "string" ? (form.get("module_id") as string) : null);
  const file = form.get("file");

  if (name === null || !name) return c.json(failure("VALIDATION_ERROR", "原型名称不能为空且不能超过 200 个字符"), 400);
  if (description === null) return c.json(failure("VALIDATION_ERROR", "描述不能超过 2000 个字符"), 400);
  if (!moduleId || !(await db.getModule(c.env.DB, moduleId))) {
    return c.json(failure("VALIDATION_ERROR", "请选择有效的模块"), 400);
  }
  if (!(file instanceof File)) return c.json(failure("VALIDATION_ERROR", "请上传原型文件"), 400);
  if (!isAllowed(file.name)) return c.json(failure("VALIDATION_ERROR", "仅支持 .html 文件或 .zip 压缩包"), 400);
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return c.json(failure("VALIDATION_ERROR", "文件大小必须在 1 B 到 25 MB 之间"), 400);
  }

  const previewId = crypto.randomUUID().replace(/-/g, "");
  const prototype = await db.createPrototype(c.env.DB, name, moduleId, description, previewId);
  const record = await handleUpload(c.env.R2, c.env.DB, file, prototype.id, previewId, "", "");
  if ("error" in record) {
    await db.deletePrototype(c.env.DB, prototype.id);
    return c.json(failure("UPLOAD_ERROR", record.error), 400);
  }

  const resource = await prototypeWithRecords(c, prototype.id);
  return c.json(success(resource), 201);
});

apiV1.post("/prototypes/:previewId/versions", async (c) => {
  const previewId = c.req.param("previewId").trim();
  if (!previewId) return c.json(failure("VALIDATION_ERROR", "preview_id 不能为空"), 400);

  const prototype = await db.getPrototypeByPreviewId(c.env.DB, previewId);
  if (!prototype) return c.json(failure("NOT_FOUND", "preview_id 对应的原型不存在"), 404);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(failure("VALIDATION_ERROR", "请求必须使用 multipart/form-data"), 400);
  }

  const file = form.get("file");
  const uploader = stringField(form.get("uploader"), MAX_UPLOADER_LENGTH);
  const updateNotes = stringField(form.get("update_notes"), MAX_UPDATE_NOTES_LENGTH);
  if (!(file instanceof File)) return c.json(failure("VALIDATION_ERROR", "请上传原型文件"), 400);
  if (!isAllowed(file.name)) return c.json(failure("VALIDATION_ERROR", "仅支持 .html 文件或 .zip 压缩包"), 400);
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return c.json(failure("VALIDATION_ERROR", "文件大小必须在 1 B 到 25 MB 之间"), 400);
  }
  if (uploader === null) return c.json(failure("VALIDATION_ERROR", "上传者不能超过 100 个字符"), 400);
  if (updateNotes === null) return c.json(failure("VALIDATION_ERROR", "更新说明不能超过 2000 个字符"), 400);

  const record = await handleUpload(c.env.R2, c.env.DB, file, prototype.id, prototype.preview_id, uploader, updateNotes);
  if ("error" in record) return c.json(failure("UPLOAD_ERROR", record.error), 400);

  await db.touchPrototype(c.env.DB, prototype.id);

  // 与后台上传保持一致：只保留最新 10 个版本及其源文件/预览。
  const toDelete = await db.trimRecords(c.env.DB, prototype.id, 10);
  for (const old of toDelete) {
    if (old.r2_key) await c.env.R2.delete(old.r2_key);
    const previewPrefix = `previews/${prototype.preview_id}/r/${old.id}/`;
    const oldPreviews = await c.env.R2.list({ prefix: previewPrefix });
    if (oldPreviews.objects.length > 0) {
      await c.env.R2.delete(oldPreviews.objects.map((o) => o.key));
    }
    await db.deleteRecord(c.env.DB, old.id);
  }

  const current = await prototypeWithRecords(c, prototype.id);
  return c.json(
    success({
      prototype: current,
      version: recordResource(record, prototype.preview_id, requestOrigin(c.req.raw), true),
    }),
    201
  );
});

export default apiV1;
